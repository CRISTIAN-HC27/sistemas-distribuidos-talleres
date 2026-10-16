# API Gateway

Única puerta de entrada del backend del cine. El frontend solo habla con el gateway; el gateway reenvía a **Cartelera** y **Ventas**, orquesta la compra y agrega datos de los dos servicios. No tiene base de datos propia.

- Lenguaje: Python 3 + FastAPI (asíncrono), cliente HTTP `httpx`
- Puerto: **8000**
- Llama a: Cartelera (`localhost:8001`) y Ventas (`localhost:8002`)

```
Front --REST--> Gateway (8000) --REST--> Cartelera (8001) --> MongoDB
                               --REST--> Ventas    (8002) --> PostgreSQL
```

Los servicios nunca se llaman entre sí: el gateway orquesta.

## Instalar y ejecutar

```bash
cd gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000 --reload
```

`app:app` = el objeto `app` del archivo `app.py`; `--reload` reinicia al guardar.

También se puede arrancar con `python app.py` (el bloque `if __name__ == '__main__'` llama a `uvicorn.run`).

Cartelera y Ventas deben estar corriendo (ver sus README). Para apuntar a otras direcciones:

```bash
CARTELERA_URL=http://otro:8001 VENTAS_URL=http://otro:8002 uvicorn app:app --port 8000
```

Documentación automática de FastAPI: <http://localhost:8000/docs>

## Endpoints (contrato público)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/salud` | Consulta el `/salud` de los dos servicios. Siempre 200 |
| POST | `/funciones` | Reenvía a Cartelera |
| GET | `/funciones` | Reenvía a Cartelera |
| GET | `/funciones/{id}` | Reenvía a Cartelera (200 o 404 `no_encontrado`) |
| POST | `/compras` | **Orquesta**: verifica la función en Cartelera y registra en Ventas |
| GET | `/compras?cliente={valor}` | Reenvía a Ventas |
| GET | `/funciones/{id}/disponibilidad` | **Agrega** Cartelera + Ventas |

## Cómo está construido (`app.py`)

### Cliente HTTP y timeout

Un solo `httpx.AsyncClient(timeout=2.0)` para todo el gateway: reutiliza conexiones (como un pool) y corta cualquier llamada que tarde más de **2 segundos** (lo pide el contrato).

### `llamar(servicio, metodo, ruta)`

Todas las llamadas a los servicios pasan por esta función. Si httpx lanza `httpx.RequestError` (conexión rechazada porque el servicio está apagado, timeout de 2 s u otra falla de red), la transforma en `ServicioNoDisponible(servicio)`.

Una respuesta 404 o 409 **no** es un error de red: el servicio respondió, y esa respuesta se reenvía.

### `reenviar(r)`

Devuelve la respuesta del servicio **tal cual**: mismo código de estado, mismo cuerpo y mismo `Content-Type`.

### CORS (middleware propio)

El frontend corre en `http://localhost:3000` y el gateway en `:8000`: para el navegador son orígenes distintos y bloquea la respuesta salvo que el servidor lo permita.

- Peticiones `OPTIONS` (el *preflight* que el navegador manda antes de un `POST` con JSON): se responden **204** con las cabeceras, sin pasar por ninguna ruta.
- Todas las demás respuestas (incluidos 404 y 503) reciben:

  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type
  ```

No se usa `CORSMiddleware` de FastAPI porque responde el preflight con 200 (el contrato pide 204) y solo agrega cabeceras si la petición trae `Origin`.

### `GET /salud`

Consulta los dos servicios **en paralelo** (`asyncio.gather`): si los dos están colgados tarda 2 s, no 4. Captura `ServicioNoDisponible` y marca el servicio como `"caido"`; si alguno cae, `estado` pasa a `"degradado"`. Nunca responde 503.

```json
{ "estado": "degradado", "cartelera": "ok", "ventas": "caido" }
```

### Reenvíos simples

- `POST /funciones`: el cuerpo se pasa **sin tocar** (bytes crudos). La validación es responsabilidad de Cartelera, incluso un JSON mal formado.
- `GET /funciones`, `GET /funciones/{id}`: reenvío directo.
- `GET /compras`: pasa los parámetros (`?cliente=...`) tal como llegaron.
- El id se escapa con `quote()` antes de armar la ruta interna, para que un id como `a/b` no cambie la ruta.

### `POST /compras` (orquestación)

En el orden del contrato:

1. Si el cuerpo no es un objeto JSON con `funcion_id` string → 400 `{"error":"datos_invalidos"}`.
2. `GET /funciones/{funcion_id}` a Cartelera. Si responde 404 → 404 `{"error":"funcion_no_existe"}`.
3. `POST /compras` a Ventas con el cuerpo **+ `entradas_totales` tomado de Cartelera**. Devuelve la respuesta de Ventas tal cual (201, 400 o 409).

Si el cliente manda su propio `entradas_totales`, **se sobrescribe** con el de Cartelera. Si no, cualquiera podría mandar `"entradas_totales": 999` y saltarse el límite de entradas.

### `GET /funciones/{id}/disponibilidad` (agregación)

1. `entradas_totales` desde Cartelera (404 → `funcion_no_existe`).
2. `vendidas` desde Ventas.
3. Responde:

   ```json
   { "funcion_id": "<id>", "entradas_totales": 10, "vendidas": 3, "disponibles": 7 }
   ```

Las llamadas van en secuencia: si la función no existe, no se le pregunta a Ventas.

## Manejo de errores

| Situación | Respuesta |
|---|---|
| Un servicio no responde (apagado o > 2 s) | 503 `{"error":"servicio_no_disponible","servicio":"cartelera"}` (o `"ventas"`) |
| Ruta inexistente (`/nada`) o método no definido (`DELETE /funciones`) | 404 `{"error":"ruta_no_encontrada"}` |
| `POST /compras` sin `funcion_id` string o JSON roto | 400 `{"error":"datos_invalidos"}` |
| `POST /compras` o `disponibilidad` con función inexistente | 404 `{"error":"funcion_no_existe"}` |
| Errores de los servicios (400, 404, 409) | Se reenvían tal cual |

El 503 y el 404 se generan con `@app.exception_handler(...)` (como `@ControllerAdvice` en Spring): las rutas solo llaman a `llamar(...)` y no repiten `try/except`.

## Probar con curl

```bash
curl -i localhost:8000/salud
curl -i -X OPTIONS localhost:8000/compras                     # 204 + cabeceras CORS

curl -i -X POST localhost:8000/funciones -H 'Content-Type: application/json' \
  -d '{"pelicula":"Interestelar","sala":"Sala 2","horario":"Sábado 20:00","entradas_totales":10}'

curl -i -X POST localhost:8000/compras -H 'Content-Type: application/json' \
  -d '{"cliente":"Ana","funcion_id":"<id>","cantidad":2}'     # 201

curl -i localhost:8000/funciones/<id>/disponibilidad          # 10 / 2 / 8
curl -i "localhost:8000/compras?cliente=Ana"
curl -i -X POST localhost:8000/compras -H 'Content-Type: application/json' \
  -d '{"cliente":"Ana","funcion_id":"000000000000000000000000","cantidad":1}'  # 404 funcion_no_existe
curl -i localhost:8000/nada                                   # 404 ruta_no_encontrada
```

**Caída de un servicio:** detén Ventas (Ctrl+C) y repite:

```bash
curl -i localhost:8000/salud            # 200, "degradado", ventas "caido"
curl -i "localhost:8000/compras"        # 503, servicio "ventas"
curl -i localhost:8000/funciones        # 200: Cartelera sigue funcionando
```
