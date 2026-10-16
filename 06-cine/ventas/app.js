import express from "express";
import { pool , crearTablas} from "./db.js";

const app = express();

// Middleware
app.use(express.json());

// Crear tablas al iniciar la aplicación
await crearTablas();

// Validación de la compra
function validarCompra(compra) {
    if (typeof compra !== 'object' || compra === null || Array.isArray(compra)) return null;

    const { cliente, funcion_id, cantidad, entradas_totales } = compra;

    if (typeof cliente !== "string" || cliente.trim() === "") return null;
    if (typeof funcion_id !== "string" || funcion_id.trim() === "") return null;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 6) return null;
    if (!Number.isInteger(entradas_totales) || entradas_totales < 1) return null;

    return { cliente, funcion_id, cantidad, entradas_totales };
}

// Routes
app.get("/salud", (_req, res) => {
    res.json({ estado: "ok" });
});

app.get("/compras", async (req, res) => {
    const { cliente } = req.query;

    const columnas = "id, cliente, funcion_id, cantidad, estado";

    const result = cliente == undefined
        ? await pool.query(`SELECT ${columnas} FROM compras ORDER BY id`)
        : await pool.query(`SELECT ${columnas} FROM compras WHERE cliente = $1 ORDER BY id`, [cliente]);

    res.json(result.rows);
});

app.get("/funciones/:id/vendidas", async (req, res) => {
    const { id } = req.params;

    const result = await pool.query(
        "SELECT COALESCE(SUM(cantidad), 0)::int AS vendidas FROM compras WHERE funcion_id = $1",
        [id]
    );

    res.json({ funcion_id: id, vendidas: result.rows[0].vendidas });
});

app.post("/compras", async (req, res) => {
    const compra = validarCompra(req.body);

    if (compra == null) return res.status(400).json({ error : "datos_invalidos"});

    const conexion = await pool.connect();

    try {
        await conexion.query("BEGIN");

        await conexion.query("SELECT pg_advisory_xact_lock(hashtext($1))", [compra.funcion_id]);

        const vendidas = await conexion.query(
            "SELECT COALESCE(SUM(cantidad), 0)::int AS vendidas FROM compras WHERE funcion_id = $1",
            [compra.funcion_id]
        );
        const quedan = compra.entradas_totales - vendidas.rows[0].vendidas;
        if (compra.cantidad > quedan) {
            await conexion.query("ROLLBACK");
            return res.status(409).json({ error: "sin_entradas" });
        }

        const result = await conexion.query(
            `INSERT INTO compras (cliente, funcion_id, cantidad) VALUES ($1, $2, $3)
             RETURNING id, cliente, funcion_id, cantidad, estado`,
            [compra.cliente, compra.funcion_id, compra.cantidad]
        );
        await conexion.query("COMMIT");

        res.status(201).json(result.rows[0]);
    } catch (err) {
        await conexion.query("ROLLBACK");
        throw err; // lo recibe el manejador de errores de abajo (500)
    } finally {
        conexion.release();
    }
});

// Manejador de errores: va despues de las rutas para recibir los errores de todas
app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "datos_invalidos" });
    }
    console.error(err);
    res.status(500).json({ error: "error_interno" });
});

app.listen(8002, () => {
    console.log("Ventas service running on port 8002");
});