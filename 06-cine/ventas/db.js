import pg from 'pg';

const { Pool } = pg;

// conexión a la base de datos
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://cine:cine@localhost:5432/cine',
});

// crear la tabla compras si no existe
export async function crearTablas() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS compras (
            id          SERIAL PRIMARY KEY,
            cliente     TEXT    NOT NULL,
            funcion_id  TEXT    NOT NULL,
            cantidad    INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 6),
            estado      TEXT    NOT NULL DEFAULT 'confirmada'
        )
    `);
}