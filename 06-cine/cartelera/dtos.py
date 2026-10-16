from dataclasses import asdict, dataclass

@dataclass
class FuncionDTO:
    # Atributos de la función
    id: str
    pelicula: str
    sala: str
    horario: str
    entradas_totales: int

    @classmethod
    def from_document(cls, doc):
        
        return cls(
            id = str(doc['_id']),
            pelicula = doc['pelicula'],
            sala = doc['sala'],
            horario = doc['horario'],
            entradas_totales = doc['entradas_totales']
        )

    def to_json(self):
        return asdict(self)



@dataclass
class CrearFuncionDTO:
    pelicula: str
    sala: str
    horario: str
    entradas_totales: int

    @classmethod
    def from_json(cls, data):
        if not isinstance(data, dict):
            return None

        for field in ['pelicula', 'sala', 'horario']:
            value = data.get(field)

            if not isinstance(value,str) or not value.strip():
                return None

        total = data.get('entradas_totales')
        if not isinstance(total, int) or isinstance(total, bool):
            return None

        if not (1 <= total <= 300):
            return None

        return cls(
            data['pelicula'],
            data['sala'],
            data['horario'],
            total
        )

    def to_document(self):
        return asdict(self)

