# ARQUITECTURA — ISQUEMIA

Documento de arquitectura completa. Complementa `ISQUEMIA.md` (el qué) resolviendo
el cómo, y `DECISIONES.md` (el registro de por qué). Escrito antes de la Fase 1
por decisión explícita del equipo.

**Principio rector de esta arquitectura:** *nada que no se pueda ver.* Cada pieza
del stack tiene una implementación local determinista que funciona sin llaves ni
red, y una implementación remota que se activa sola cuando existe la credencial.
El demo nunca depende de que un proveedor externo responda.

---

## 1. Las cinco capas

```
┌──────────────────────────────────────────────────────────────────────────┐
│  app/            Next.js 15 · React 19 · CopilotKit v2                   │
│                  P1 Sala · P2 Referral · P3 Ruta · P4 Expediente · P5 KPI│
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  AG-UI (SSE)  ── un solo canal
┌───────────────────────────────┴──────────────────────────────────────────┐
│  agui/           IsquemiaAgent extends AbstractAgent                     │
│                  traduce el bus de eventos a STATE_SNAPSHOT/DELTA        │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────┴──────────────────────────────────────────┐
│  orquestacion/   Centinela · Despachador · MotorCarriles · Ruta ·        │
│                  Escribano · LineaBaseSerial                             │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────┴──────────────────────────────────────────┐
│  domain/         tipos · políticas · máquinas de estado · guardrails ·   │
│  sim/            puertos · reloj · mundo sintético · 40 centros          │
└───────────────────────────────┬──────────────────────────────────────────┘
┌───────────────────────────────┴──────────────────────────────────────────┐
│  adapters/       un archivo por slot [STACK], cada uno con impl          │
│                  `local` (determinista, cero llaves) y `remota`          │
└──────────────────────────────────────────────────────────────────────────┘
```

`domain/` no importa nada de las capas de arriba ni ningún SDK. Lo garantiza
`scripts/lint-capas.mjs` (nuevo) además del `lint-reloj.mjs` ya existente.

---

## 2. La decisión central: el orquestador *es* un agente AG-UI

CopilotKit v2 acepta cualquier `AbstractAgent` de `@ag-ui/client`:

```ts
const runtime = new CopilotRuntime({
  agents: {
    isquemia: new IsquemiaAgent(),   // ← nuestro orquestador completo
    copiloto: new BuiltInAgent({ model: "openai:gpt-5.4-mini" }),
  },
});
```

`IsquemiaAgent.run()` devuelve un `Observable<BaseEvent>` alimentado por el bus
de eventos del dominio. La traducción es uno a uno:

| Evento de dominio (§6.8) | Evento AG-UI emitido | Qué se ve en pantalla |
|---|---|---|
| arranque de corrida | `RUN_STARTED` + `STATE_SNAPSHOT` | el panel entero aparece poblado |
| cualquier evento del bus | `STATE_DELTA` (JSON Patch RFC 6902) | la celda del carril cambia de color sola |
| `CARRIL_CAMPO_COMPROMISO` | `STATE_DELTA` sobre `carriles[i].compromiso` | **una de las cuatro casillas se llena** |
| `EVENTO_DEGRADACION` | `CUSTOM` `degradacion` | la celda se pone crítica, "1.5 h protegidas" |
| `ALERTA_CIT` (50/75/90 %) | `CUSTOM` `alerta_cit` | el reloj de cabecera cambia de color |
| plan de transporte listo | `TOOL_CALL_*` `mostrarPlanTransporte` | **Generative UI**: tarjetas por modalidad |
| expediente AOOS listo | `TOOL_CALL_*` `mostrarExpediente` | documento navegable con cobertura |
| narración del Escribano | `TEXT_MESSAGE_*` | prosa en streaming en el sidebar |
| fin de corrida | `RUN_FINISHED` | P5 congela las nueve cifras |

**Consecuencia:** el frontend no tiene estado propio de dominio. Todo sale de
`useAgent().agent.state`. El mismo principio que el event store del §5.2: una
sola fuente de verdad, y la UI es una proyección.

### 2.1 Forma del estado compartido

```ts
interface EstadoPanel {
  corridaId: string; semilla: string;
  reloj: { t_sim: number; factor: number; congelado: boolean };
  caso: { donante: DonanteResumen; estado: EstadoCaso; criterios: CriterioDetectado[] };
  organo: { tipo: TipoOrgano; citLimite_h: number; citTranscurrido_h: number;
            fraccion: number; umbralAlcanzado: 0|0.5|0.75|0.9 };
  carriles: CarrilVista[];            // 40, ordenados por secuencia de match run
  resumen: { ofertasEmitidas: number; carrilesVivos: number;
             mejorSecuencia: number|null; citProyectadaMejor_h: number|null };
  baseline: { secuenciaActual: number; t_sim: number; cit_h: number; estado: string };
  transporte: OpcionTransporte[] | null;
  expediente: ExpedienteAOOS | null;
  metricas: NueveMetricas;
  spans: ResumenSpans;                // p50/p95, tokens, costo acumulado
  escalamientos: Escalamiento[];      // G7, pendientes de humano
}
```

`CarrilVista` lleva exactamente lo que pinta la celda: centro, secuencia, estado,
latencia, las cuatro casillas del compromiso, código de rechazo y modalidad.

---

## 3. CopilotKit — inventario de uso

No es un chatbot al lado del panel. Es el transporte del panel entero.

| Capacidad v2 | Dónde se usa en ISQUEMIA |
|---|---|
| `CopilotKitProvider` | raíz de la app, `runtimeUrl=/api/copilotkit` |
| `useAgent` | **P1–P5 completos** leen `agent.state`; un solo suscriptor con `throttleMs` para la rejilla de 40 |
| `useAgentContext` | el copiloto ve el estado del panel sin que el operador se lo cuente |
| `useFrontendTool` | `enfocarCarril`, `filtrarCarrilesPorEstado`, `cambiarFactorReloj`, `congelarReloj`, `compararConBaseline`, `abrirExpediente`, `resaltarCita` |
| `useHumanInTheLoop` | **`escalarAHumano` (G7)** y **`autorizarFueraDeSecuencia` (G4)** — el agente se detiene y espera aprobación real del operador |
| `useComponent` / `useRenderTool` | tarjetas generativas: `TarjetaTransporte`, `TarjetaCompromiso`, `TarjetaDegradacion`, `TarjetaExpediente`, `TarjetaAlertaCIT` |
| `useInterrupt` | pausa la corrida cuando el Centinela reporta `confianza < 0.8` |
| `useConfigureSuggestions` | sugerencias contextuales: "¿por qué se degradó el carril 12?", "compara con la línea base" |
| `defineToolCallRenderer` | render de cada tool call en el hilo del copiloto, con latencia y costo visibles |
| `CopilotSidebar` | copiloto de operación, siempre presente en P1 |
| `CopilotKitInspector` | solo en dev — muestra el tráfico AG-UI crudo, útil para el jurado técnico |

**Regla §12.1 respetada:** ningún componente genera HTML crudo. El agente emite
estado y tool calls tipados; el catálogo de componentes React los renderiza.

---

## 4. Ambiguous AI — inventario de uso

El workspace es donde el expediente y el escalamiento **aterrizan en manos humanas**.
Adaptador `adapters/ambiguous/` con dos implementaciones.

| App de Ambiguous | Qué escribe ISQUEMIA | Disparador |
|---|---|---|
| **Docs** | Expediente AOOS completo, navegable, con cobertura y firma de hash | fin de colocación (§8.5) |
| **Tasks** | Tarea asignada al coordinador con el paquete de escalamiento | `escalarAHumano` (G7) |
| **Chat** | Canal de operación: cada agente postea con su propia identidad y su cita | cada evento de nivel `operacion` |
| **CRM** | *No se escribe.* Los centros son sintéticos y no deben ensuciar el CRM real del equipo; la actividad queda en el espejo | — |
| **Mail** | Notificación de referral al OPO con el criterio detectado y su cita literal | `REFERRAL_EMITIDO` (reloj 1) |
| **Sheets** | Tabla de las nueve métricas por semilla, para la suite de evaluación | fin de corrida |
| **Drive** | Cadena de custodia y hashes de foto de la caja | eventos de custodia (§13.4) |
| **Identity** | Identidad por agente, cruzada con Auth0 | arranque |

**Transporte: MCP.** `https://app.ambiguous.ai/mcp`, JSON-RPC sobre HTTP
streamable con `Authorization: Bearer ak_...`. El servidor responde
`text/event-stream` incluso para respuestas unitarias, así que el cliente lee la
primera trama `data:`. Se identifica como `ambiguous-workspace 0.1.0` y expone
**856 herramientas** (~775 KB de esquemas): adjuntarlas a un modelo sería
absurdo y caro, así que `adapters/mcp-ambiguous.ts` no hace descubrimiento
dinámico — llama por nombre a las nueve que ISQUEMIA usa, con argumentos
tipados en el sitio de la llamada.

Las nueve: `create_document`, `create_task`, `list_channels`,
`chat_channel_create`, `send_message`, `send_email`, `create_sheet`,
`auth_whoami`, `users_list`.

**Identidad del agente.** La llave resuelve a un usuario de tipo `agent`:
`isquemiaAgent` · `isquemiaagent@isquemiaagent-workspace.ambi.cc`. Cada
escritura queda atribuida a él en el registro de auditoría del workspace, que
es justo lo que Auth0 hará a nivel de agente individual.

**Escritura doble, no condicional.** `WorkspaceAmbiguous` escribe **siempre**
en el espejo local primero y devuelve ese item de inmediato; la llamada remota
completa el `url` cuando vuelve. El reloj de isquemia no espera a una API
externa, el panel nunca tiene un hueco, y si la red falla la degradación se
emite como evento `DEGRADACION_PROVEEDOR` (G9) en vez de perderse. Sin
`AMBIGUOUS_API_KEY` solo queda el espejo, con el mismo contenido.

---

## 5. Mapa de slots `[STACK]` → adaptadores

Cada fila: puerto de `domain/puertos.ts`, impl local (siempre funciona), impl remota.

| Slot | Puerto | Impl local (sin llaves) | Impl remota |
|---|---|---|---|
| `LLM_NEGOCIACION` | `Llm` | `LlmGuionado` — respuestas deterministas por perfil de centro, cero costo | **OpenAI** vía capa neutral `any-llm` (Mozilla.ai) |
| `LLM_TRIAGE` | `Llm` | idem, clasificador por reglas | OpenAI barato; OpenRouter queda cableado por si aparece la llave |
| `LLM_ROUTER` | `RouterModelos` | tabla `taskKind → modelo`, reporta costo simulado | OpenAI por defecto, OpenRouter opcional; costo real por token en P5 |
| `VOZ` | `Voz` | `VozGuionada` — transcripción sintética por turnos, con temporización realista | OpenAI Realtime, K=6 carriles |
| `TELEFONIA` | `Telefonia` | simulada (§11.1.5) | — no aplica |
| `RUNTIME` | `MotorCarriles` | `MotorLocal` — `RuntimeAsync` + semáforo de 4 | **Trigger.dev**, `concurrencyLimit: 4` |
| `ALMACEN` | `AlmacenEventos` | `AlmacenMemoria` (hecho) + `AlmacenArchivo` para replay | Postgres append-only |
| `UI_TRANSPORTE` | `BusEventos` | `BusMemoria` (hecho) → `IsquemiaAgent` | CopilotKit / AG-UI sobre SSE |
| `OBSERVABILIDAD` | `Observabilidad` | `ObservabilidadMemoria` (hecho) → P5 | idem + export a Sheets |
| `COLA` | `Cola` | concurrencia nativa | Trigger.dev queues |
| `BUSQUEDA` | `Busqueda` | corpus estático de criterios OPTN y de centros, con cita y URL | **Exa** |
| `AUTH` | `IdentidadAgente` | identidades locales firmadas, `sub` por agente en cada evento | **Auth0** M2M, un client por agente |
| `WORKSPACE` | `Workspace` | `WorkspaceEspejo` (panel interno) | **Ambiguous AI** |
| `CAJA` | `CajaCustodia` | simulador de Jetson con modo sin red conmutalbe | Jetson Orin Nano por WebSocket |
| `DESPLIEGUE` | — | `next dev` | **Google Cloud Run** |

**Selección:** `adapters/registro.ts` elige impl remota si existe la variable de
entorno correspondiente, local si no. Emite un evento `ADAPTADOR_SELECCIONADO`
por cada slot, y el panel muestra una fila de insignias **local/remoto** — el
jurado ve exactamente qué es real y qué está simulado. Honestidad como feature.

---

## 6. Concurrencia: los dos niveles (§7.4)

Es el punto que un juez va a atacar, así que está explícito en la arquitectura:

- **Nivel 1 — evaluación.** 40 carriles baratos (mensajería/portal) abiertos a la vez.
  Solo contactan y reciben respuesta. Coste: una llamada de modelo barato por carril.
- **Nivel 2 — compromiso.** Máximo **4** carriles avanzan simultáneamente a
  `VERIFICANDO`. Es la política de H16 (la OPO que bajó 32 % su CIT). El resto
  espera en la cola de compromiso ordenada por secuencia de match run.

`MotorCarriles` expone `abrirEvaluacion(carril)` y `solicitarSlotCompromiso(carril)`.
El semáforo de 4 vive en el motor, no en el agente: cambiar de `MotorLocal` a
Trigger.dev no cambia la política, solo quién la ejecuta.

---

## 7. Determinismo y reproducibilidad

Requisito §0.4.7: dos corridas con la misma semilla dan el mismo resultado.

1. Toda aleatoriedad pasa por `crearAleatorio(semilla).derivar(etiqueta)`.
2. `lint-reloj.mjs` prohíbe `Date.now`, `Math.random`, `setTimeout` fuera de `adapters/`.
3. Los ids de evento son `run-<semilla>#<seq>`, no UUIDs.
4. Las salidas de modelo se **cachean por hash de entrada** en `evals/cache-llm.json`.
   En modo replay el caché es la única fuente: cero llamadas de red, cero varianza.
5. El reloj de simulación solo avanza por `advance()`; el motor de tiempo real
   (`adapters/motor-reloj.ts`) es la única pieza que lo empuja desde la hora de pared.
6. La línea base serial usa **los mismos perfiles de centro y la misma semilla**.
   El simulador no sabe quién lo está contactando — hay un test que lo verifica (§11.3).

---

## 8. Rutas de la aplicación

```
app/
  layout.tsx                      CopilotKitProvider + tema
  page.tsx                        P1 · Sala de colocación
  referral/page.tsx               P2 · Reloj 1
  transporte/page.tsx             P3 · Router multimodal
  expediente/page.tsx             P4 · AOOS navegable
  metricas/page.tsx               P5 · Las nueve cifras
  workspace/page.tsx              espejo de Ambiguous
  api/copilotkit/[[...slug]]/route.ts   CopilotRuntime + IsquemiaAgent
  api/corrida/route.ts            arrancar / semilla / factor / replay
  api/eventos/route.ts            SSE crudo del event store (para el inspector)
```

P1 a P5 son pestañas de una sola sala; el reloj de cabecera es global y **nunca
se detiene** (§12.2).

---

## 9. Orden de construcción revisado

Sustituye el orden lineal de §16 por uno que produce algo visible desde el inicio,
que es lo que pidió el equipo.

| # | Entregable | Se puede ver |
|---|---|---|
| A | Reconciliar `Cita` con §8.6, añadir puertos nuevos (`MotorCarriles`, `Workspace`, `IdentidadAgente`, `CajaCustodia`), lint de capas | tests |
| B | Simulador de mundo: 40 centros calibrados, match run, DonorNet falso, portal legacy (Fase 1) | tests + dump JSON |
| C | Motor de carriles con los dos niveles + spans (Fase 3) | tests |
| D | Agentes de dominio con `LlmGuionado` (Fase 4) + línea base serial (Fase 2) | corrida completa en consola |
| E | `IsquemiaAgent` AG-UI + Next.js + CopilotKit: **P1 vivo** | **primera vez que se levanta** |
| F | P2, P3, P4, P5 y el panel de Workspace | pantallas completas |
| G | Adaptadores remotos: OpenRouter, OpenAI Realtime, Exa, Auth0, Ambiguous, Trigger.dev | insignias local→remoto |
| H | Suite de evaluación de diez semillas, Cloud Run, caja | Fases 7–9 |

El equipo revisa a partir de **E** y las sugerencias entran en **F**.


---

## 10. Decisiones del equipo — 12 de septiembre de 2026

- **Credenciales disponibles:** OpenAI, Ambiguous AI, Exa, Auth0, Trigger.dev.
  **No hay OpenRouter**, así que el ruteo de modelos se hace sobre OpenAI y el
  adaptador de OpenRouter queda escrito pero inactivo (se enciende solo si
  aparece `OPENROUTER_API_KEY`). El costo por colocación de P5 se reporta igual.
- **Trigger.dev:** puerto `MotorCarriles` con implementación local por defecto.
  El adaptador de Trigger.dev se activa con `TRIGGER_SECRET_KEY`. La política de
  concurrencia (40 / 4) vive en el motor, así que es idéntica en las dos.
- **Estética:** clínico claro. Fondo claro tipo panel hospitalario, color
  semántico reservado para el estado de carril, acento reservado al éxito
  (§12.3). El reloj de isquemia domina la cabecera y nunca se detiene.
- **Idioma de interfaz:** inglés (§12.0, ya decidido en `DECISIONES.md`).

Las llaves no se pegan en el repositorio: van en `.env.local`, que está en
`.gitignore`. `.env.example` lista los nombres exactos.
