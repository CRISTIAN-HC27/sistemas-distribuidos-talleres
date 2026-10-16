import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

const FUNCION_VACIA = { pelicula: '', sala: '', horario: '', entradas_totales: '' }

export default function App() {
  const [salud, setSalud] = useState(null)
  const [funciones, setFunciones] = useState([])
  const [errorCartelera, setErrorCartelera] = useState('')
  const [cliente, setCliente] = useState('')
  const [compras, setCompras] = useState(null)
  const [aviso, setAviso] = useState(null)

  const avisar = (tipo, texto) => setAviso({ tipo, texto })

  const cargarSalud = useCallback(async () => {
    try {
      setSalud(await api('/salud'))
    } catch {
      setSalud(null)
    }
  }, [])

  const cargarFunciones = useCallback(async () => {
    try {
      const lista = await api('/funciones')
      // Disponibilidad de cada función (agrega Cartelera + Ventas en el gateway)
      const conDisponibilidad = await Promise.all(
        lista.map(async (f) => {
          try {
            const d = await api(`/funciones/${f.id}/disponibilidad`)
            return { ...f, disponibles: d.disponibles }
          } catch {
            return { ...f, disponibles: null }
          }
        }),
      )
      setFunciones(conDisponibilidad)
      setErrorCartelera('')
    } catch (e) {
      setErrorCartelera(e.message)
    }
  }, [])

  const cargarCompras = useCallback(async (nombre) => {
    if (!nombre.trim()) return setCompras(null)
    try {
      setCompras(await api(`/compras?cliente=${encodeURIComponent(nombre)}`))
    } catch (e) {
      avisar('error', e.message)
    }
  }, [])

  useEffect(() => {
    cargarSalud()
    cargarFunciones()
    const intervalo = setInterval(cargarSalud, 5000)
    return () => clearInterval(intervalo)
  }, [cargarSalud, cargarFunciones])

  async function comprar(funcion, cantidad) {
    if (!cliente.trim()) return avisar('error', 'Escribe tu nombre antes de comprar.')
    try {
      await api('/compras', {
        method: 'POST',
        body: { cliente, funcion_id: funcion.id, cantidad },
      })
      avisar('ok', `Compraste ${cantidad} entrada(s) para ${funcion.pelicula}.`)
      cargarFunciones()
      cargarCompras(cliente)
    } catch (e) {
      avisar('error', e.message)
    }
  }

  async function crearFuncion(datos) {
    try {
      const f = await api('/funciones', { method: 'POST', body: datos })
      avisar('ok', `Función "${f.pelicula}" creada.`)
      cargarFunciones()
      return true
    } catch (e) {
      avisar('error', e.message)
      return false
    }
  }

  const peliculaDe = (id) => funciones.find((f) => f.id === id)?.pelicula ?? id

  return (
    <main>
      <header>
        <h1>Cine</h1>
        <Salud salud={salud} />
      </header>

      {aviso && (
        <p className={`aviso ${aviso.tipo}`} onClick={() => setAviso(null)}>
          {aviso.texto}
        </p>
      )}

      <div className="columnas">
        <section>
          <div className="titulo">
            <h2>Cartelera</h2>
            <button className="secundario" onClick={cargarFunciones}>Actualizar</button>
          </div>
          {errorCartelera && <p className="vacio">{errorCartelera}</p>}
          {!errorCartelera && funciones.length === 0 && (
            <p className="vacio">No hay funciones. Crea una a la derecha.</p>
          )}
          <ul className="lista">
            {funciones.map((f) => (
              <Funcion key={f.id} funcion={f} onComprar={comprar} />
            ))}
          </ul>
        </section>

        <aside>
          <section>
            <h2>Tus compras</h2>
            <form
              className="fila"
              onSubmit={(e) => {
                e.preventDefault()
                cargarCompras(cliente)
              }}
            >
              <input
                placeholder="Tu nombre"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              />
              <button className="secundario">Ver</button>
            </form>
            {compras?.length === 0 && <p className="vacio">Sin compras todavía.</p>}
            {compras?.length > 0 && (
              <ul className="lista compacta">
                {compras.map((c) => (
                  <li key={c.id}>
                    <span>#{c.id} · {peliculaDe(c.funcion_id)}</span>
                    <span className="dato">{c.cantidad} × {c.estado}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>Nueva función</h2>
            <NuevaFuncion onCrear={crearFuncion} />
          </section>
        </aside>
      </div>
    </main>
  )
}

function Salud({ salud }) {
  if (!salud) return <span className="salud caido">gateway caído</span>
  return (
    <div className="estados">
      {['cartelera', 'ventas'].map((s) => (
        <span key={s} className={`salud ${salud[s]}`}>{s}</span>
      ))}
    </div>
  )
}

function Funcion({ funcion, onComprar }) {
  const [cantidad, setCantidad] = useState(1)
  const { pelicula, sala, horario, entradas_totales, disponibles } = funcion
  const agotada = disponibles === 0

  return (
    <li>
      <div>
        <strong>{pelicula}</strong>
        <small>{sala} · {horario}</small>
      </div>
      <div className="fila">
        <span className="dato">
          {disponibles === null ? '—' : disponibles} / {entradas_totales}
        </span>
        <select value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}
        </select>
        <button disabled={agotada} onClick={() => onComprar(funcion, cantidad)}>
          {agotada ? 'Agotada' : 'Comprar'}
        </button>
      </div>
    </li>
  )
}

function NuevaFuncion({ onCrear }) {
  const [datos, setDatos] = useState(FUNCION_VACIA)
  const cambiar = (campo) => (e) => setDatos({ ...datos, [campo]: e.target.value })

  async function enviar(e) {
    e.preventDefault()
    const creada = await onCrear({ ...datos, entradas_totales: Number(datos.entradas_totales) })
    if (creada) setDatos(FUNCION_VACIA)
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <input placeholder="Película" value={datos.pelicula} onChange={cambiar('pelicula')} />
      <input placeholder="Sala (ej. Sala 2)" value={datos.sala} onChange={cambiar('sala')} />
      <input placeholder="Horario (ej. Sábado 20:00)" value={datos.horario} onChange={cambiar('horario')} />
      <input
        type="number"
        placeholder="Entradas (1 a 300)"
        value={datos.entradas_totales}
        onChange={cambiar('entradas_totales')}
      />
      <button>Crear</button>
    </form>
  )
}
