import asyncio
import os
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

app = FastAPI()

URLS = {
    'cartelera': os.getenv('CARTELERA_URL', 'http://localhost:8001'),
    'ventas': os.getenv('VENTAS_URL', 'http://localhost:8002'),
}

# Un solo cliente para todo el gateway: reutiliza conexiones. Si un servicio tarda mas de 2 s, se corta
http = httpx.AsyncClient(timeout=2.0)

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}


# ---------- CORS ----------

@app.middleware('http')
async def cors(request: Request, call_next):
    # El navegador manda un OPTIONS (preflight) antes del POST para pedir permiso
    if request.method == 'OPTIONS':
        return Response(status_code=204, headers=CORS)
    response = await call_next(request)
    response.headers.update(CORS)
    return response


# ---------- Errores ----------

class ServicioNoDisponible(Exception):
    def __init__(self, servicio):
        self.servicio = servicio


@app.exception_handler(ServicioNoDisponible)
async def servicio_no_disponible(_request: Request, exc: ServicioNoDisponible):
    return JSONResponse(
        {'error': 'servicio_no_disponible', 'servicio': exc.servicio},
        status_code=503,
    )


@app.exception_handler(StarletteHTTPException)
async def ruta_no_encontrada(_request: Request, exc: StarletteHTTPException):
    # 404 (ruta inexistente) y 405 (ruta que existe pero no con ese metodo): para el
    # contrato los dos son "esa ruta no existe"
    if exc.status_code in (404, 405):
        return JSONResponse({'error': 'ruta_no_encontrada'}, status_code=404)
    return JSONResponse({'error': 'error_interno'}, status_code=exc.status_code)


# ---------- Llamadas a los servicios ----------

async def llamar(servicio, metodo, ruta, **kwargs):
    """Llama a un servicio interno. Si no responde, lanza ServicioNoDisponible."""
    try:
        return await http.request(metodo, URLS[servicio] + ruta, **kwargs)
    except httpx.RequestError:
        # Conexion rechazada (servicio apagado), timeout de 2 s u otra falla de red
        raise ServicioNoDisponible(servicio)


def reenviar(r: httpx.Response):
    """Devuelve la respuesta del servicio tal cual: mismo codigo y mismo cuerpo."""
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type=r.headers.get('content-type', 'application/json'),
    )


def ruta_funcion(funcion_id):
    # quote() escapa caracteres raros del id (ej. "a/b") para que no cambien la ruta interna
    return '/funciones/' + quote(funcion_id, safe='')


# ---------- Salud ----------

async def estado_de(servicio):
    try:
        r = await llamar(servicio, 'GET', '/salud')
        return 'ok' if r.status_code == 200 else 'caido'
    except ServicioNoDisponible:
        return 'caido'


@app.get('/salud')
async def salud():
    # Consulta los dos servicios en paralelo, no uno despues del otro
    cartelera, ventas = await asyncio.gather(estado_de('cartelera'), estado_de('ventas'))
    estado = 'ok' if cartelera == 'ok' and ventas == 'ok' else 'degradado'
    return {'estado': estado, 'cartelera': cartelera, 'ventas': ventas}


# ---------- Reenvios simples ----------

@app.post('/funciones')
async def crear_funcion(request: Request):
    # El cuerpo se pasa sin tocar: la validacion es responsabilidad de Cartelera
    r = await llamar('cartelera', 'POST', '/funciones',
                     content=await request.body(),
                     headers={'Content-Type': 'application/json'})
    return reenviar(r)


@app.get('/funciones')
async def obtener_funciones():
    return reenviar(await llamar('cartelera', 'GET', '/funciones'))


@app.get('/funciones/{funcion_id}')
async def obtener_funcion(funcion_id: str):
    return reenviar(await llamar('cartelera', 'GET', ruta_funcion(funcion_id)))


@app.get('/compras')
async def obtener_compras(request: Request):
    # Pasa ?cliente=... (o nada) tal como llego
    r = await llamar('ventas', 'GET', '/compras', params=request.query_params.multi_items())
    return reenviar(r)


# ---------- Orquestacion ----------

@app.post('/compras')
async def crear_compra(request: Request):
    # (1) El cuerpo debe ser un objeto JSON con funcion_id string
    try:
        datos = await request.json()
    except ValueError:
        datos = None
    if not isinstance(datos, dict) or not isinstance(datos.get('funcion_id'), str):
        return JSONResponse({'error': 'datos_invalidos'}, status_code=400)

    # (2) La funcion tiene que existir en Cartelera
    r = await llamar('cartelera', 'GET', ruta_funcion(datos['funcion_id']))
    if r.status_code == 404:
        return JSONResponse({'error': 'funcion_no_existe'}, status_code=404)
    if r.status_code != 200:
        return reenviar(r)

    # (3) Se registra en Ventas con el total que dice Cartelera. Se sobrescribe cualquier
    # entradas_totales que haya mandado el cliente: el dato confiable es el de Cartelera
    cuerpo = {**datos, 'entradas_totales': r.json()['entradas_totales']}
    return reenviar(await llamar('ventas', 'POST', '/compras', json=cuerpo))


# ---------- Agregacion ----------

@app.get('/funciones/{funcion_id}/disponibilidad')
async def disponibilidad(funcion_id: str):
    r = await llamar('cartelera', 'GET', ruta_funcion(funcion_id))
    if r.status_code == 404:
        return JSONResponse({'error': 'funcion_no_existe'}, status_code=404)
    if r.status_code != 200:
        return reenviar(r)
    entradas_totales = r.json()['entradas_totales']

    r = await llamar('ventas', 'GET', ruta_funcion(funcion_id) + '/vendidas')
    if r.status_code != 200:
        return reenviar(r)
    vendidas = r.json()['vendidas']

    return {
        'funcion_id': funcion_id,
        'entradas_totales': entradas_totales,
        'vendidas': vendidas,
        'disponibles': entradas_totales - vendidas,
    }


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app:app', port=8000, reload=True)