# Cartelera

Servicio de funciones del cine. Guarda las funciones (película, sala, horario y entradas totales) en **MongoDB**.

- Lenguaje: Python 3 + Flask
- Base de datos: MongoDB (base `cine`, colección `funciones`)
- Puerto: **8001**

## Requisitos

- Python 3.10+
- MongoDB corriendo en `localhost:27017`. Desde la carpeta raíz del taller (`06-cine/`):

  ```bash
  docker compose up -d
  ```

## Instalar

```bash
cd cartelera
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Ejecutar

```bash
source .venv/bin/activate
python app.py
```

Por defecto se conecta a `mongodb://localhost:27017`. Para usar otra URL:

```bash
MONGO_URL=mongodb://otro-host:27017 python app.py
```

## Endpoints

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/salud` | 200 `{"estado":"ok"}` |
| POST | `/funciones` | 201 con la función creada · 400 `{"error":"datos_invalidos"}` |
| GET | `/funciones` | 200 con un arreglo, en orden de creación |
| GET | `/funciones/{id}` | 200 con la función · 404 `{"error":"no_encontrado"}` |

## Probar con curl

```bash
curl -i localhost:8001/salud

curl -i -X POST localhost:8001/funciones -H 'Content-Type: application/json' \
  -d '{"pelicula":"Interestelar","sala":"Sala 2","horario":"Sábado 20:00","entradas_totales":120}'

curl -i localhost:8001/funciones

curl -i localhost:8001/funciones/<id>
```

## Ver los datos en MongoDB

Entrar a la consola de Mongo dentro del contenedor:

```bash
docker exec -it cine-mongo mongosh cine
```

| Comando | Qué hace |
|---|---|
| `show dbs` | Lista las bases (`cine` aparece cuando tiene al menos un documento) |
| `use cine` | Cambia a la base `cine` |
| `show collections` | Lista las colecciones de la base actual |
| `db.funciones.find()` | Muestra todos los documentos |
| `db.funciones.find().sort({_id: 1})` | Los muestra en orden de creación |
| `db.funciones.countDocuments()` | Cuenta los documentos |
| `db.funciones.findOne({pelicula: "Interestelar"})` | Busca uno por un campo |
| `db.funciones.find({_id: ObjectId("<id>")})` | Busca por id (con `ObjectId(...)`, no con el string solo) |
| `db.funciones.deleteMany({})` | Borra todos los documentos de la colección |
| `exit` | Salir |

Para un vistazo rápido sin entrar a la consola:

```bash
docker exec cine-mongo mongosh cine --quiet --eval 'db.funciones.find()'
```

También puedes conectarte con una interfaz gráfica (MongoDB Compass o la extensión "MongoDB for VS Code") usando `mongodb://localhost:27017`.
