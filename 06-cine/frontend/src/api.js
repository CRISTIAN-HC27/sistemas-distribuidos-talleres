// El frontend solo habla con el gateway, nunca con los servicios
const GATEWAY = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8000'

const MENSAJES = {
  datos_invalidos: 'Revisa los datos: hay campos vacíos o fuera de rango.',
  no_encontrado: 'La función no existe.',
  funcion_no_existe: 'La función no existe.',
  sin_entradas: 'No quedan suficientes entradas para esa cantidad.',
  ruta_no_encontrada: 'Ruta no encontrada en el gateway.',
  gateway_no_disponible: 'No se pudo conectar con el gateway (localhost:8000).',
}

export class ErrorApi extends Error {
  constructor(codigo, servicio) {
    super(
      codigo === 'servicio_no_disponible'
        ? `El servicio ${servicio} no está disponible.`
        : MENSAJES[codigo] ?? `Error inesperado (${codigo}).`,
    )
    this.codigo = codigo
    this.servicio = servicio
  }
}

export async function api(ruta, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(GATEWAY + ruta, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // fetch solo falla así si no hubo respuesta: gateway apagado o CORS bloqueado
    throw new ErrorApi('gateway_no_disponible')
  }
  const datos = await res.json().catch(() => null)
  if (!res.ok) throw new ErrorApi(datos?.error ?? `http_${res.status}`, datos?.servicio)
  return datos
}
