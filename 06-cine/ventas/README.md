# Ventas

Servicio de compras de entradas del cine. Registra las compras y controla que no se vendan más entradas de las que tiene cada función. Guarda los datos en **PostgreSQL**.

- Lenguaje: Node.js + Express 5
- Base de datos: PostgreSQL (base `cine`, tabla `compras`)
- Puerto: **8002**

## Requisitos

- Node.js 18+ (se usó Node 22)
- PostgreSQL corriendo en `localhost:5432`. Desde la carpeta raíz del taller (`06-cine/`):

  ```bash
  docker compose up -d
  ```

## Instalar y ejecutar

```bash
cd ventas
npm install
npm start          # o: npm run dev (se reinicia solo al guardar)
```

Por defecto se conecta a `postgresql://cine:cine@localhost:5432/cine`. Para usar otra URL:

```bash
DATABASE_URL=postgresql://usuario:clave@host:5432/base npm start
```

## Archivos

| Archivo | Qué contiene |
|---|---|
| `db.js` | La conexión a Postgres (pool) y la creación de la tabla |
| `app.js` | La validación, los endpoints y el manejador de errores |

## Conexión y tabla (`db.js`)

**Pool de conexiones.** `new Pool({ connectionString })` mantiene un conjunto de conexiones abiertas que se reutilizan entre peticiones (como HikariCP en Spring). La URL sale de la variable `DATABASE_URL` o, si no existe, de las credenciales del `docker-compose.yml`.

**Tabla.** Al arrancar, `app.js` ejecuta `await crearTablas()` **antes** de `app.listen`, así el servicio no atiende peticiones sin tener dónde guardar:

```sql
CREATE TABLE IF NOT EXISTS compras (
    id          SERIAL PRIMARY KEY,
    cliente     TEXT    NOT NULL,
    funcion_id  TEXT    NOT NULL,
    cantidad    INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 6),
    estado      TEXT    NOT NULL DEFAULT 'confirmada'
)
```

| Columna | Por qué |
|---|---|
| `id SERIAL PRIMARY KEY` | Postgres genera 1, 2, 3… (el contrato pide un entero que parta en 1) |
| `funcion_id TEXT` | Guarda el ObjectId de Mongo como texto. Ventas **no** verifica que exista: eso lo hace el gateway |
| `CHECK (cantidad BETWEEN 1 AND 6)` | La base también rechaza cantidades fuera de rango (segunda barrera además de la validación en código) |
| `DEFAULT 'confirmada'` | El estado se completa solo |

`IF NOT EXISTS` evita que falle (o que se borre la tabla) al reiniciar: los datos sobreviven a un reinicio.

A diferencia de Mongo (Cartelera), aquí la tabla se crea explícitamente y la base valida tipos y reglas.

## Endpoints (`app.js`)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/salud` | 200 `{"estado":"ok"}` |
| POST | `/compras` | 201 con la compra · 400 `datos_invalidos` · 409 `sin_entradas` |
| GET | `/compras?cliente={valor}` | 200 con un arreglo, en orden de creación (sin parámetro: todas) |
| GET | `/funciones/{id}/vendidas` | 200 `{"funcion_id":"<id>","vendidas":3}` |

### `GET /compras`

- Lee el filtro desde `req.query.cliente`. Si no viene, devuelve todas.
- Consulta **parametrizada** (`WHERE cliente = $1`): el valor viaja aparte del SQL, así no hay inyección SQL.
- `ORDER BY id`: sin `ORDER BY` Postgres no garantiza orden; como `id` es `SERIAL`, da el orden de creación.
- Selecciona solo las columnas del contrato (`id, cliente, funcion_id, cantidad, estado`), no `SELECT *`.

### `GET /funciones/{id}/vendidas`

```sql
SELECT COALESCE(SUM(cantidad), 0)::int AS vendidas FROM compras WHERE funcion_id = $1
```

- `COALESCE(..., 0)`: `SUM` de cero filas es `NULL`, no 0.
- `::int`: `SUM` devuelve `bigint` y el driver `pg` entrega los `bigint` como **string** (`"3"`). El cast lo deja como número.
- Si la función no tiene compras (o no existe), responde `vendidas: 0`. No responde 404: Ventas no conoce Cartelera.

### `POST /compras`

**1. Validación** (`validarCompra`): el cuerpo debe ser un objeto con:

| Campo | Regla |
|---|---|
| `cliente` | string no vacío |
| `funcion_id` | string no vacío |
| `cantidad` | entero entre 1 y 6 (`Number.isInteger` rechaza `true`, `"2"`, `1.5`) |
| `entradas_totales` | entero ≥ 1 (lo agrega el gateway con el total de Cartelera) |

Si algo no cumple: 400 `{"error":"datos_invalidos"}`. Solo se usan esos 4 campos; lo demás se ignora.

**2. Transacción con candado (evita vender de más).**

Sin protección, dos compras simultáneas pueden leer el mismo "quedan 2", pasar las dos la validación e insertar las dos (se venden 4). Es una **condición de carrera**. Por eso los pasos se hacen dentro de una transacción en **una misma conexión** (`pool.connect()`):

```
BEGIN
SELECT pg_advisory_xact_lock(hashtext(funcion_id))   ← candado por función
SELECT COALESCE(SUM(cantidad), 0) ...                ← vendidas
si cantidad > entradas_totales - vendidas  →  ROLLBACK + 409 sin_entradas
INSERT ... RETURNING id, cliente, funcion_id, cantidad, estado
COMMIT  →  201 con la fila insertada
```

- `pg_advisory_xact_lock`: candado de Postgres identificado por un número (el hash del `funcion_id`). Una segunda compra de la **misma** función espera hasta el `COMMIT`/`ROLLBACK` de la primera; funciones distintas no se bloquean entre sí. Se libera solo al terminar la transacción.
- Se usa en vez de `SELECT ... FOR UPDATE` porque en Ventas no hay una fila por función que bloquear (la función vive en Mongo).
- `RETURNING`: el `INSERT` devuelve la fila con el `id` y el `estado` generados por la base, sin otra consulta.
- `finally { conexion.release() }`: la conexión vuelve al pool siempre (también en el 409 y en errores). Sin esto, el pool (10 conexiones) se agotaría y el servicio dejaría de responder.

## Manejo de errores

| Situación | Respuesta | Cómo |
|---|---|---|
| Cuerpo inválido | 400 `datos_invalidos` | `validarCompra` devuelve `null` |
| JSON mal formado (`{roto`) | 400 `datos_invalidos` | El manejador de errores detecta `err.type === "entity.parse.failed"` (lo lanza `express.json()`) |
| No quedan entradas | 409 `sin_entradas` | Comparación dentro de la transacción |
| Error inesperado (ej. falla de la base) | 500 `error_interno` | El `catch` hace `ROLLBACK` y **relanza** (`throw err`); Express 5 pasa el error de la ruta `async` al manejador |

El manejador de errores es el `app.use((err, req, res, next) => ...)` con **4 parámetros** y está **después de todas las rutas**: Express solo entrega un error a los manejadores registrados después de donde ocurrió. Sin él, Express responde los errores en HTML con el stack trace.

Por qué importa el `throw err`: si el error se tragara, la petición quedaría sin respuesta y el gateway, después de 2 s, informaría `servicio_no_disponible` aunque Ventas estuviera arriba.

## Probar con curl

```bash
curl -i localhost:8002/salud

curl -i -X POST localhost:8002/compras -H 'Content-Type: application/json' \
  -d '{"cliente":"Ana","funcion_id":"f1","cantidad":2,"entradas_totales":5}'      # 201

curl -i -X POST localhost:8002/compras -H 'Content-Type: application/json' \
  -d '{"cliente":"Ana","funcion_id":"f1","cantidad":4,"entradas_totales":5}'      # 409

curl -i localhost:8002/compras
curl -i "localhost:8002/compras?cliente=Ana"
curl -i localhost:8002/funciones/f1/vendidas
```

**Prueba de concurrencia:** 10 compras simultáneas de 1 entrada para una función con 5. Debe dar exactamente 5 × 201 y 5 × 409:

```bash
for i in $(seq 10); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8002/compras \
    -H 'Content-Type: application/json' \
    -d '{"cliente":"Carrera","funcion_id":"carrera","cantidad":1,"entradas_totales":5}' &
done | sort | uniq -c

curl -s localhost:8002/funciones/carrera/vendidas    # vendidas: 5
```

## Ver los datos en PostgreSQL

Entrar a la consola de Postgres dentro del contenedor:

```bash
docker exec -it cine-postgres psql -U cine -d cine
```

| Comando | Qué hace |
|---|---|
| `\l` | Lista las bases |
| `\dt` | Lista las tablas |
| `\d compras` | Columnas, tipos, default y el `CHECK` de la tabla |
| `SELECT * FROM compras ORDER BY id;` | Todas las compras |
| `SELECT * FROM compras WHERE cliente = 'Ana';` | Compras de una persona |
| `SELECT funcion_id, SUM(cantidad) FROM compras GROUP BY funcion_id;` | Vendidas por función |
| `TRUNCATE compras RESTART IDENTITY;` | Borra todo y el `id` vuelve a partir en 1 |
| `\q` | Salir |

Para un vistazo rápido sin entrar a la consola:

```bash
docker exec cine-postgres psql -U cine -d cine -c 'SELECT * FROM compras ORDER BY id'
```

También puedes conectarte con una interfaz gráfica (DBeaver, pgAdmin o la extensión de PostgreSQL de VS Code) con host `localhost`, puerto `5432`, usuario `cine`, clave `cine`, base `cine`.
