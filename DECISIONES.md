# DECISIONES.md

Registro de decisiones de stack y producto no especificadas en `ISQUEMIA.md`, tomadas por el agente constructor o confirmadas con el equipo, según lo exige §0.3.

## Huecos `[DECIDIR]` resueltos con el equipo

| Hueco | Decisión | Razón |
|---|---|---|
| §12.0 Idioma de interfaz | **Inglés** | Confirmado con el equipo |
| Estructura de repo | **Monorepo** — un solo proyecto Next.js, backend de agentes corre server-side dentro del mismo repo (route handlers / server actions) | Menos piezas que desplegar bajo el reloj del hackathon; un solo servicio en Cloud Run |
| Uso de Ambiguous AI | **Sí** — se usa como capa de workspace: el expediente AOOS (§8.5) se materializa como documento navegable ahí, y `escalarAHumano` (§8.1, G7) crea una tarea en su CRM/tasks | Aprovecha el sponsor tal como lo exige el reto, y le da un consumidor real al evento de escalamiento |
| §17.5 Vivo o grabado | **Pendiente** — se decide tras Fase 10 según el resultado de los cinco ensayos, como indica la spec | No se puede decidir antes de tener el sistema corriendo |

## Slots `[STACK]` (§5.4) resueltos

| Slot | Elección | Notas |
|---|---|---|
| `UI_TRANSPORTE` | CopilotKit (`@copilotkit/react-core`, `@copilotkit/react-ui`) sobre AG-UI protocol | Generative UI: el agente emite estado, la UI declarativa se renderiza sola. Cumple "no generar HTML crudo" (§12.1) |
| Orquestación de agentes | OpenAI Agents SDK (TS), server-side en Next.js | Vía Agents Everywhere starter kit; da tools, handoffs, structured output |
| `LLM_NEGOCIACION`, `LLM_TRIAGE` | OpenRouter | Un solo API para modelo fuerte (Carril/Escribano) y modelo barato (Centinela). Temperatura 0 en Carril |
| `LLM_ROUTER` | Selección manual por `taskKind` sobre catálogo de OpenRouter | No se justifica un router dedicado a esta escala |
| `VOZ`, `TELEFONIA` | OpenAI Voice/Realtime Agents SDK, solo para K=6 carriles | Telefonía real no aplica — todo simulado (§11.1.5) |
| `RUNTIME`, `DESPLIEGUE` | Google Cloud Run | Proceso siempre encendido + WebSocket para el bus de eventos |
| `ALMACEN` | Postgres (append-only, event store) | No ligado a sponsor; cualquier Postgres gestionado sirve |
| `COLA` | Concurrencia nativa del runtime (async), sin cola distribuida | 40 carriles no la justifican |
| `BUSQUEDA` | Exa (opcional, solo si Ruta usa datos reales de vuelos/clima en vez de tablas estáticas) | §11.1.7 permite tablas estáticas; Exa queda como mejora, no bloqueante |
| `AUTH` | Auth0 (solo si el panel se expone más allá del jurado) | No bloqueante para el demo local |
| `OBSERVABILIDAD` | Spans custom (§14.1) alimentando el panel P5 | — |
| Workspace / documentos | Ambiguous AI | Expediente AOOS + escalamiento a humano |

## Requisito duro que aplica a todo lo anterior

Ningún archivo de dominio (`domain/`) importa un SDK de proveedor directamente (OpenAI, OpenRouter, CopilotKit runtime, Ambiguous AI, etc.). Todo pasa por `adapters/`, según §5.4.


## Arquitectura completa — 12 de septiembre de 2026

Definida en `ARQUITECTURA.md` antes de la Fase 1, por decisión del equipo.
Resumen de lo que se resolvió ahí y no estaba en `ISQUEMIA.md`:

| Decisión | Valor | Razón |
|---|---|---|
| El orquestador es un agente AG-UI | `IsquemiaAgent extends AbstractAgent`, registrado en `CopilotRuntime.agents` | CopilotKit v2 acepta cualquier `AbstractAgent`; así el panel entero se alimenta de `useAgent().state` y CopilotKit deja de ser decorativo |
| Versión de CopilotKit | v2 (`@copilotkit/react-core/v2`, paquete 1.71.x) | Es la API vigente: `useFrontendTool`, `useHumanInTheLoop`, `useAgent`, `useComponent` |
| Todo slot tiene impl local determinista | `local` sin llaves + `remota` con llave | Requisito del equipo: nada que no se pueda visualizar. El demo no depende de un proveedor externo |
| Insignias local/remoto visibles | Evento `ADAPTADOR_SELECCIONADO` por slot, pintado en el panel | Honestidad ante el jurado sobre qué es real y qué está simulado |
| Trigger.dev | Puerto `MotorCarriles`, local por defecto | Confirmado con el equipo |
| Sin OpenRouter | Adaptador escrito, inactivo sin llave | El equipo no tiene credencial |
| Estética | Clínico claro, inglés | Confirmado con el equipo |
| Tiempo de simulación | Milisegundos enteros; empates de `schedule` por orden de inserción | Reproducibilidad por semilla (§0.4.7) |
| `corridaId` | Derivado de la semilla, no de la hora | Misma razón |
| Forma canónica de `Cita` | La de §8.6 (`afirmacion`, `origen`, `referencia`, `literal`) | §6.5 y §8.6 la definían distinto; gana §8.6 por ser la que mide M9 |


## Ambiguous AI — cableado real, 12 de septiembre de 2026

| Decisión | Valor | Razón |
|---|---|---|
| Transporte | MCP en `https://app.ambiguous.ai/mcp`, JSON-RPC sobre HTTP streamable, `Bearer ak_...` | Es lo que expone el servicio; el REST directo también existe pero MCP cubre las 856 herramientas con un solo contrato |
| Cliente | Propio, ~120 líneas, sin SDK ni descubrimiento dinámico | 856 herramientas son ~775 KB de esquema. ISQUEMIA usa nueve y las llama por nombre; adjuntar el catálogo a un modelo sería caro y no aporta nada |
| Estrategia de escritura | Doble: espejo local **siempre**, remoto en paralelo rellenando el enlace | El reloj de isquemia no espera a una API externa y el panel nunca queda vacío. Un fallo remoto emite `DEGRADACION_PROVEEDOR` (G9) |
| CRM | No se escribe | Los centros de transplante son sintéticos; meterlos como contactos reales ensucia el CRM del equipo sin aportar al pitch |
| Drive | Se publica como documento en vez de subir archivo | La subida real necesita `drive_file_upload_init` + confirmación contra GCS; la cadena de custodia se lee mejor como documento y no está en el camino crítico |
| Identidad | La llave resuelve a un usuario `agent`: `isquemiaAgent` | Cada escritura queda atribuida en el registro de auditoría del workspace — la misma propiedad que Auth0 dará por agente individual |
| Credenciales | En `.env.local`, cubierto por `.gitignore` | Nunca en el repositorio |

Las escrituras verificadas contra el workspace real en una corrida completa
(semilla `S-001`): correo de referral al coordinador con la cita del criterio,
canal `#isquemia-ops` creado con tres mensajes de hito, tres tareas de
escalamiento G7, el expediente AOOS como documento, y la hoja de las nueve
métricas. Nueve de nueve remotas, cero degradaciones.


## Arreglos y cierre de fases — 12 de septiembre de 2026 (tarde)

Encontrados al levantar la aplicación de verdad, no leyendo el código.

| Problema | Causa | Arreglo |
|---|---|---|
| El panel se quedaba en «Connecting to the placement agent…» para siempre | El hilo AG-UI de una corrida vive minutos. Con el `InMemoryAgentRunner` por defecto (`onConcurrentRun: "throw"`), cualquier remontaje —StrictMode en desarrollo, un refresco, una segunda pestaña— chocaba con el run vivo (`Thread already running`) y el cliente nunca recibía el `STATE_SNAPSHOT` | Runner con `onConcurrentRun: "supersede"`, y el arranque del cliente protegido con un `ref` en vez de un `useState`, que el doble montaje de StrictMode se salta |
| La corrida ya estaba terminada al abrir el panel | `sesionPorDefecto()` arrancaba la campaña al levantarse el proceso de Next, así que el reloj de isquemia corría sin nadie mirando | La sesión se crea perezosa y **sin arrancar**; la consola la arranca con `POST /api/corrida {accion:"arrancar"}`, que es idempotente |
| Un stream caído dejaba la sala en blanco | No había más camino que AG-UI | Respaldo por `GET /api/corrida`, misma función `proyectar` y mismo servidor. Se apaga solo en cuanto llega el snapshot del agente, y la insignia de cabecera distingue `streaming` de respaldo |
| M5 fuera de meta en 2 de 10 semillas | El timeout duro del carril (`T_TIMEOUT_CARRIL`, contado desde que se abre) mataba verificaciones en curso: `T_VERIFICACION` se cuenta desde que empieza a verificar, así que un centro que contestaba tarde entraba a verificar con el timeout duro casi vencido. El carril moría en `TIMEOUT` en vez de resolverse en `COMPROMETIDO` o `DEGRADADO` — se perdía justo la transición que justifica el producto | El timeout duro cubre solo el tramo sin respuesta; en cuanto hay una con la que trabajar, cede el mando al plazo de verificación (y, en cola, al cierre de campaña, que aborta). M5 = 1.000 en las diez, y S-006 pasó de perder el órgano a colocarlo en #29 |

**M1 no se promedia sobre las diez.** La línea base serial pierde el órgano en 7 de 10 semillas: agota el match run con rechazos por restricción de tiempo, que es exactamente el efecto que el producto ataca. Contar esas semillas como «0 horas ahorradas» haría parecer que el agente no ganó nada justo donde ganó el órgano entero. La suite reporta dos cifras separadas: M1 medio sobre las semillas comparables (4.64 h sobre 3) y órganos que la línea base perdió y el agente colocó (7 de 10).

| Entregable cerrado | Dónde |
|---|---|
| Suite de regresión de diez semillas (Fase 8) | `scripts/evals.ts` → `evals/resultados.json`; `npm run evals`, encadenado en `npm run check` y dentro del `Dockerfile`: si M5, M6 o M9 caen de meta, no hay imagen |
| P5 muestra la suite | `src/ui/pantallas/metricas.tsx` vía `GET /api/evals` |
| SSE crudo del event store | `GET /api/eventos` — histórico y cola en vivo, para el inspector y para auditar con `curl` |
| Cloud Run (Fase 7) | `Dockerfile` (standalone) + `scripts/desplegar.sh`. Una sola instancia y sin estrangular CPU: la corrida vive en memoria y el stream dura minutos |
