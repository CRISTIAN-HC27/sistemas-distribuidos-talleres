# Frontend

Interfaz mínima del cine para probar el backend. Solo habla con el **gateway** (`http://localhost:8000`), nunca con Cartelera ni Ventas.

- React 19 + Vite
- Puerto: **3000** (el que espera el CORS del contrato)

## Ejecutar

Con el gateway, Cartelera y Ventas corriendo:

```bash
cd frontend
npm install
npm run dev
```

Abrir <http://localhost:3000>.

Para usar otro gateway: `VITE_GATEWAY_URL=http://otro:8000 npm run dev`.

## Qué muestra

| Parte | Endpoint del gateway |
|---|---|
| Estado de cartelera / ventas (arriba a la derecha, cada 5 s) | `GET /salud` |
| Cartelera con disponibles / totales | `GET /funciones` + `GET /funciones/{id}/disponibilidad` |
| Botón Comprar (cantidad 1 a 6) | `POST /compras` |
| Tus compras (por nombre) | `GET /compras?cliente=...` |
| Nueva función | `POST /funciones` |

## Archivos

- `src/api.js`: única función `api()` que llama al gateway y traduce los códigos de error (`sin_entradas`, `servicio_no_disponible`, etc.) a mensajes.
- `src/App.jsx`: la pantalla y sus componentes (`Salud`, `Funcion`, `NuevaFuncion`).
- `src/index.css`: estilos (claro/oscuro según el sistema).

## Probar las caídas

- Detén **Ventas**: el indicador "ventas" se pone rojo, la cartelera se sigue viendo pero los disponibles muestran "—" y comprar avisa "El servicio ventas no está disponible".
- Detén **Cartelera**: la cartelera muestra "El servicio cartelera no está disponible".
- Detén el **gateway**: aparece "gateway caído".
