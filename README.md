# ISQUEMIA

Sistema de agentes que acompaña un órgano de donante fallecido desde que una
enfermera de UCI podría llamar al procurador hasta que la caja se abre en el
quirófano del receptor. Tres relojes que hoy pertenecen a tres organizaciones
que no se ven entre sí; el producto es ser lo único que ve los tres.

> **Datos sintéticos, no clínicos.** El sistema no decide asignación de órganos,
> no determina muerte y no pronostica. Persigue, verifica y documenta.

## Documentos

| Documento | Qué contiene |
|---|---|
| [`ISQUEMIA.md`](ISQUEMIA.md) | La especificación: el dominio, los hechos verificados con fuente, y el criterio de aceptación de cada fase |
| [`ARQUITECTURA.md`](ARQUITECTURA.md) | Las cinco capas, los slots de stack y cómo se elige local o remoto |
| [`DECISIONES.md`](DECISIONES.md) | Registro de las decisiones que la especificación dejó abiertas |
| [`docs/CABLEADO.md`](docs/CABLEADO.md) | Cómo se conecta cada componente del dispositivo físico |

## Las dos mitades

**El sistema** — Next.js 15, React 19 y CopilotKit sobre un bus de eventos, con
los agentes corriendo server-side. Centinela, Despachador, Carriles, Ruta y
Escribano. Ver `ARQUITECTURA.md`.

```bash
npm install
npm run dev
```

**La caja** — el dispositivo de a bordo, sobre una Jetson Orin Nano Super:
monitorea el órgano en tránsito, lo muestra en una LCD 1602A, y al llegar
identifica al receptor con la cámara antes de liberar el pestillo. Es la
sección 13 de la especificación. Ver [`caja/README.md`](caja/README.md).

```bash
python3 scripts/diagnostico.py
python3 -m caja.app --organo rinon_izq --llegada 25
```

Las dos mitades aún no están conectadas: la arquitectura define el slot `CAJA`
con una implementación local simulada y la Jetson real por WebSocket, y ese
puente está pendiente de construir.
