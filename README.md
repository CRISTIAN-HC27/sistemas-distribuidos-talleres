# Sistemas Distribuidos: talleres

Actividades y posibles soluciones a los talleres de la ayudantía de **Sistemas Distribuidos**.

## Contenido

| # | Taller | Temas |
|---|--------|-------|
| 06 | [Dos backends y un API Gateway (cine)](06-cine/) | API Gateway propio (FastAPI), orquestación y agregación de servicios, Cartelera con Flask + MongoDB, Ventas con Express + PostgreSQL, compra concurrente con transacción y advisory lock, CORS, 503 cuando cae un servicio, frontend React |

## Requisitos

- Docker y Docker Compose (para las bases de datos)
- Python 3.10+
- Node.js 18+

## Inicio rápido

### Taller 06

```bash
cd 06-cine
docker compose up -d                 # MongoDB + PostgreSQL

# Cartelera (8001)
cd cartelera && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python app.py

# Ventas (8002), en otra terminal
cd 06-cine/ventas && npm install && npm start

# Gateway (8000), en otra terminal
cd 06-cine/gateway && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn app:app --port 8000

# Frontend (3000), en otra terminal
cd 06-cine/frontend && npm install && npm run dev
```

Cada pieza tiene su propio README con el detalle de endpoints, decisiones y pruebas.

## Autor

**Cristian Huanca** - [CRISTIAN-HC27](https://github.com/CRISTIAN-HC27)
