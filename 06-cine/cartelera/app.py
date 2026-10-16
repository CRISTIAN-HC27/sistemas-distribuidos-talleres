import os

from flask import Flask, request
from pymongo import MongoClient
from dtos import FuncionDTO, CrearFuncionDTO

from bson import ObjectId
from bson.errors import InvalidId

app = Flask(__name__)

# MongoDB connection
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))

# MongoDB collection (table)
funciones = client['cine']['funciones']

# Endpoints
@app.route('/salud')
def salud():
    return {"estado": "ok"}

@app.route('/funciones', methods=['GET'])
def obtener_funciones():
    docs = funciones.find().sort('_id', 1)
    return [FuncionDTO.from_document(doc).to_json() for doc in docs]


@app.route('/funciones/<id>', methods=['GET'])
def obtener_funcion(id):
    try:
        oid = ObjectId(id)
    except InvalidId:
        return {"error": "no_encontrado"}, 404

    doc = funciones.find_one({"_id": oid})

    if doc is None:
        return {"error": "no_encontrado"}, 404

    return FuncionDTO.from_document(doc).to_json()

@app.route('/funciones', methods=['POST'])
def crear_funcion():
    dto = CrearFuncionDTO.from_json(request.get_json(silent=True))

    if dto is None:
        return {"error": "datos_invalidos"}, 400

    doc = dto.to_document()
    funciones.insert_one(doc)

    return FuncionDTO.from_document(doc).to_json(), 201

if __name__ == '__main__':
    app.run(debug=True, port=8001)
