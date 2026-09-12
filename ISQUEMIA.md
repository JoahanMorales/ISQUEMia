# ISQUEMIA — Especificación de construcción

**Versión:** 1.0 · 12 de septiembre de 2026
**Destino:** hackathon "Agentes en Todas Partes"
**Naturaleza del documento:** especificación ejecutable. Está escrita para que un agente constructor pueda implementarla sin volver a investigar el dominio y sin inventar decisiones de producto.

---

## 0. Instrucciones para el agente constructor

### 0.1 Cómo leer este documento

Léelo completo antes de escribir código. Las secciones 1 a 3 te dan el dominio; sin ellas vas a tomar decisiones de modelado equivocadas porque el vocabulario médico engaña. Las secciones 5 a 12 son la especificación técnica propiamente dicha. La sección 16 es tu plan de trabajo con criterios de aceptación por fase.

### 0.2 Decisiones ya tomadas — no las vuelvas a litigar

| Decisión | Valor |
|---|---|
| El sistema **no** toma decisiones de asignación de órganos | La política de OPTN las dicta; el agente persigue, verifica y documenta |
| El sistema **no** determina muerte ni pronostica | Detecta criterios explícitos ya escritos en el expediente y notifica |
| Todos los datos son **sintéticos** | Cero PHI, cero datos de pacientes reales, en toda circunstancia |
| No se integra con DonorNet real | Se construye un simulador fiel (§11) |
| La comparación humano-serial vs. agente-paralelo usa **la misma semilla** | Si no, la demo es deshonesta y un juez lo detecta |
| El hardware (§13) es **opcional y desacoplado** | Si falla, el sistema completo sigue funcionando |
| La voz se usa en un subconjunto de carriles, no en todos | Razón en §5.3 |

### 0.3 Huecos deliberados — pregunta antes de asumir

Estos puntos están marcados `[STACK]` o `[DECIDIR]` a lo largo del documento. No los resuelvas por tu cuenta:

- Todos los slots de la sección **5.4** (modelos, telefonía, runtime, despliegue, observabilidad, almacenamiento, transporte de UI).
- El idioma de la interfaz (§12.0).
- Si la demo corre en vivo contra el simulador o con un replay grabado (§17.5).

Para todo lo demás: si el documento no lo especifica y no está marcado como hueco, **elige la opción más simple que cumpla el criterio de aceptación de la fase** y déjala anotada en un archivo `DECISIONES.md`.

### 0.4 Criterio de terminación global

El proyecto está terminado cuando, con una sola semilla fija, el sistema:

1. Detecta un criterio clínico en un flujo sintético de UCI y emite un referral con marca de tiempo.
2. Ejecuta una colocación en paralelo contra 40 centros simulados.
3. Intercepta al menos un "provisional yes" falso y lo documenta.
4. Produce un expediente de justificación de colocación fuera de secuencia.
5. Emite un plan de transporte multimodal puntuado.
6. Muestra un panel de métricas con las nueve cifras de la sección 14.3.
7. Reproduce el mismo resultado dos veces seguidas con la misma semilla.

---

## 1. Qué se construye, en un párrafo

Un sistema de agentes que acompaña un órgano de donante fallecido desde el momento en que una enfermera de UCI podría llamar al procurador hasta el momento en que la caja se abre en el quirófano del receptor. Tiene tres relojes independientes que hoy pertenecen a tres organizaciones distintas que no se ven entre sí, y el producto consiste en ser la única cosa que ve los tres. Su capacidad diferenciadora no es razonar mejor: es **estar en cuarenta lugares a la vez mientras un reloj corre**, y convertir promesas vagas en compromisos verificados.

---

## 2. El dominio en diez minutos

Esta sección existe porque el vocabulario del transplante induce errores de modelado si se lee rápido. Léela entera.

### 2.1 Los actores

| Actor | Qué es | Papel en el sistema |
|---|---|---|
| **Hospital donante** | Donde muere el paciente. Tiene UCI, expediente electrónico y enfermeras. | Origen del disparador. Obligado por ley a notificar. |
| **OPO** (*Organ Procurement Organization*) | Organización sin fines de lucro que coordina la procuración en un territorio. Hay ~58 en EE.UU. | **Es el cliente.** Corre nuestro sistema. |
| **Centro de transplante** | Hospital que implanta. Tiene lista de candidatos propia. | La contraparte a la que hay que perseguir. Acepta o rechaza ofertas. |
| **OPTN / UNOS** | El sistema nacional de asignación. Su software operativo es **DonorNet**. | Define el orden de la lista. No se toca; se opera al lado. |
| **Transportista** | Ambulancia, courier, aerolínea comercial, helicóptero, jet chárter, dron. | Ejecuta el reloj 3. |

### 2.2 Las dos vías de donación — esto cambia todo el modelo

**DBD — *Donation after Brain Death*.** El paciente es declarado con muerte encefálica pero su corazón sigue latiendo con soporte. El equipo tiene tiempo: se puede evaluar, ofertar, esperar respuestas y programar la recuperación quirúrgica. El reloj de isquemia empieza en el **cross-clamp** (el momento quirúrgico en que se detiene la circulación al órgano).

**DCD — *Donation after Circulatory Death*.** El paciente no tiene muerte encefálica, pero la familia decide retirar el soporte vital. Se retira el soporte, se espera el paro cardíaco, se observan **5 minutos de "no-touch"** obligatorios, y solo entonces se puede incidir. Dos consecuencias brutales para el diseño:

1. **Hay una ventana de 60 a 120 minutos.** Si el paciente no entra en paro dentro de ella, regresa a la unidad y **no hay donación**. Todo el montaje se pierde.
2. **El equipo, el quirófano y el receptor tienen que estar comprometidos ANTES de saber si el paciente morirá en la ventana.** Cada caso DCD es una apuesta con costo hundido.

DCD ya es el **42.9 %** de los donantes fallecidos y sigue creciendo. Es donde el sistema se rompe más y donde más valor hay. **Modela DCD como ciudadano de primera clase, no como caso especial.**

### 2.3 Cómo funciona una oferta

El *match run* produce una lista ordenada de candidatos. El OPO ofrece el órgano bajando por esa lista. Un centro puede responder:

- **Rechazo** con un código estandarizado (§3.2).
- **"Provisional yes"** — dice que está interesado o que quiere más información. **Esto es el corazón del problema:** OPTN escribió que el provisional yes se volvió *essentially meaningless*, y **~70 % de los provisional yes terminan en rechazo**. En hígado, ese rechazo tardío llega en promedio **1.5 horas antes del cross-clamp**, cuando ya no hay tiempo de reorganizar.
- **Aceptación firme.**

**Número de secuencia:** la posición del candidato en la lista ordenada. Una colocación normal cierra alrededor de la posición **9**. Una colocación fuera de secuencia (*AOOS*) cierra en una mediana de **812**.

**AOOS — *Allocation Out Of Sequence*.** El OPO salta la lista para evitar el descarte. Pasó de menos del 3 % a ~20 % de los transplantes. **HRSA ahora audita la justificación de cada AOOS.** Ese documento hoy se escribe a mano y tarde. Producirlo automáticamente es una de las salidas del sistema.

### 2.4 Refusal vs. discard — no los confundas

- **Refusal (rechazo):** un centro rechaza una oferta concreta para un candidato concreto. Ocurre **miles de veces por órgano**.
- **Discard / non-use:** el órgano nunca se transplanta. Riñón: **29.3 % en 2024**.

Un órgano puede acumular más de cien rechazos y aun así transplantarse. **Un tercio de los riñones colocados fuera de secuencia sobrevivió a más de cien rechazos en secuencia.**

### 2.5 Los relojes, con números

| Órgano | Isquemia frío tolerable (almacenamiento estático) |
|---|---|
| Corazón | 4 h |
| Pulmón | 4–6 h |
| Hígado | 8–12 h |
| Páncreas | 12–18 h |
| Riñón | 24–36 h |

Costo por hora: cada hora adicional de isquemia frío en riñón implica **HR 1.013** para fallo del injerto (≈ **1.3 % más de riesgo por hora**). Treinta horas contra seis implican ~40 % más riesgo.

La **perfusión** (TransMedics OCS, OrganOx, XVIVO, Paragonix) no duplica el reloj en general: lo **estabiliza y lo hace medible**. El salto grande es corazón, de 4 h a 9–17 h, lo que convierte un problema de helicóptero local en uno de jet nacional.

### 2.6 El disparador río arriba

**42 CFR 482.45** obliga al hospital a notificar a su OPO de toda muerte **o muerte inminente**, "de manera oportuna". **No existe una regla federal de una hora.** El plazo vive en el contrato hospital-OPO: **81.8 % de los OPOs especifican 60 minutos**; algunos permiten hasta 240.

El reloj arranca cuando se cumple un ***clinical trigger***, no cuando el paciente muere. Criterios típicos:

- Glasgow Coma Scale **≤ 5** (rango usado en la industria: 4–8; media 5.1; lo usa el 69.1 % de los OPOs)
- Pérdida de reflejos de tronco encefálico (lo usa el 54.5 %)
- Paciente en ventilación mecánica con lesión neurológica
- Plan documentado de retiro de soporte vital
- La familia pregunta espontáneamente por donación

**Ese instante lo juzga hoy una enfermera de UCI con seis pacientes más.** No hay sistema que lo detecte. Un estudio de UCI que midió el denominador real encontró que **45 % de los donantes potenciales nunca se refirió**, y que **en DCD se pierde el 60 % de los referrals**.

---

## 3. Hechos verificados y su calibración

Todo número que aparezca en la interfaz, en el pitch o en el simulador **debe** salir de esta tabla o llevar la marca `(sin verificar)`.

### 3.1 Tabla maestra de hechos

| # | Hecho | Valor | Fuente | Confianza |
|---|---|---|---|---|
| H01 | Código de rechazo #1 en riñón: *cold ischemic time too long* | 20.37 % | OPTN Data Advisory Committee, 2023 | Alta |
| H02 | CIT + WIT combinados como razón de rechazo | 23 % | ídem | Alta |
| H03 | Rechazos por logística/operativo del centro | ~4 % | ídem | Alta |
| H04 | Rechazos organ-specific / donor-specific / candidate-specific | ~46 % / ~27 % / ~3 % | ídem | Alta |
| H05 | Provisional yes que terminan en rechazo | ~70 % | UNOS / OPTN | Alta |
| H06 | OPTN describe el provisional yes como *essentially meaningless* | cita textual | OPTN public comment | Alta |
| H07 | Hígados declinados tardíamente: antelación media al cross-clamp | 1.5 h | OPTN | Alta |
| H08 | Hígados/pulmones así declinados que se reasignan a candidatos menos urgentes | 80 % / 83 % | OPTN | Alta |
| H09 | Correlación entre volumen de ofertas y transplantes post-KAS250 | r = −0.001 | PMC10527286 | Alta |
| H10 | Aumento de ofertas mensuales medianas por centro post-KAS250 | +70 % (195 vs 115) | ídem | Alta |
| H11 | Candidatos ofertados por donante post-KAS250 | 2.33× (7 vs 3) | ídem | Alta |
| H12 | Centros contactados antes de la primera aceptación | 4 vs 2 | ídem | Alta |
| H13 | Aumento de CIT post-KAS250 | +13 % (19.3 h vs 17.1 h) | ídem | Alta |
| H14 | Aumento de non-use post-KAS250 | +18 % (24.4 % vs 20.7 %) | ídem | Alta |
| H15 | Cirujanos que cambian su decisión ante oferta idéntica renombrada | ~20 % de 57 | UNOS | Alta |
| H16 | Caso OPO: reducción de CIT limitando ofertas y exigiendo respuesta final | −32 % (11.0 h → 7.5 h) | Organ Donation Alliance | Alta |
| H17 | Non-use de riñón, global 2024 | 29.3 % | SRTR 2024 ADR | Alta |
| H18 | Non-use de riñón con KDPI ≥ 85 | 69.5 % | ídem | Alta |
| H19 | Non-use de riñones biopsiados vs. no biopsiados | 40.8 % vs 6.4 % | ídem | Alta |
| H20 | Riñones con biopsia "subóptima" aún funcionales a 5 años | 73 % | Mohan et al. / CUIMC | Alta |
| H21 | Riñones descartados en EE.UU. que se habrían transplantado en Francia | 62 % (17,435 de 27,987) | Aubert, JAMA IM 2019 | Alta |
| H22 | Años de injerto perdidos, 2004–2014 | 132,445 | ídem | Alta |
| H23 | Mediana del número de secuencia del receptor AOOS vs. normal | 812 vs 9 | Clin Transplant / PMC11772121 | Alta |
| H24 | Riñones AOOS con más de 100 rechazos previos | 33 % | ídem | Alta |
| H25 | Proporción de transplantes asignados fuera de secuencia | ~20 % (rango 0–43 % entre OPOs) | ídem | Alta |
| H26 | Riesgo de fallo del injerto por hora adicional de CIT (riñón) | HR 1.013 | Debout, Kidney Int | Alta |
| H27 | Ventana contractual de referral especificada en 60 min | 81.8 % de los OPOs | Frontiers in Transplantation 2026 | Media |
| H28 | Donantes potenciales nunca referidos (estudio de UCI) | 45 % | Frontiers 2026 | Media |
| H29 | Referrals DCD perdidos en ese mismo estudio | 60 % | ídem | Media |
| H30 | Proporción de donantes fallecidos que son DCD | 42.9 % (2024) | SRTR 2024 ADR | Alta |
| H31 | Ventana DCD tras retiro de soporte | 60–120 min | Donor Alliance / LifeShare | Alta |
| H32 | Observación obligatoria "no-touch" tras el paro | 5 min | Directiva HRSA 2025 | Alta |
| H33 | Envíos de órganos con incidente de transporte | 7 % | KFF Health News | Alta |
| H34 | Órganos no transplantables por transporte, 2014–2019 | ~170 | ídem | Alta |
| H35 | Casi-pérdidas con retraso de 2+ h | ~370 | ídem | Alta |
| H36 | Non-use de corazón atribuible a tiempo | ~33 % (21.6 % en bomba + 11.4 % en hielo) | OPTN non-use codes | Alta |
| H37 | Ofertas nocturnas (18:00–06:00): mayor tasa de rechazo en riñón | OR ≈ 1.11 | Yamamoto 2022 | Alta |
| H38 | Aceptación de corazón en fin de semana / feriado / congreso | OR 0.88 / 0.81 / 0.86 | Greenberg 2023 | Alta |
| H39 | Obligación legal de notificar muerte o muerte inminente | 42 CFR 482.45(a)(1) | eCFR | Alta |
| H40 | CMS solicita comentarios sobre exigir referrals electrónicos automatizados | CMS-3409-P, enero 2026 | CMS | Alta |

### 3.2 Taxonomía de códigos de rechazo

El sistema vigente desde diciembre de 2021 tiene ~47 códigos mutuamente excluyentes en 9 categorías. Implementa estas categorías como enumeración:

```
DONOR_CANDIDATE_MATCHING   (2 códigos)
ORGAN_SPECIFIC             (8)
CANDIDATE_SPECIFIC         (9)
HISTOCOMPATIBILITY         (5)
DISEASE_TRANSMISSION_RISK  (5)
DONOR_SPECIFIC             (5)
LOGISTICS                  (6)
OTHER                      (2)
```

Los seis códigos de `LOGISTICS`, que son los que el sistema puede atacar directamente:

```
LOG_RESOURCE_TIME_CONSTRAINT    // OPO, centro o hospital donante
LOG_TEAM_OR_FACILITY_UNAVAILABLE
LOG_RECOVERY_TEAM_UNAVAILABLE
LOG_TRANSPORTATION_UNAVAILABLE
LOG_CIT_TOO_LONG                // actual o proyectado  <-- el más frecuente de todos
LOG_WIT_TOO_LONG
```

Códigos heredados del sistema anterior que conviene conocer porque aparecen en la literatura: `820` heavy workload, `823` surgeon not available, `824` distance/too far to ship, `825` operational, `830` donor age or quality.

---

## 4. Alcance

### 4.1 Se construye

- Detector de criterio clínico sobre flujo sintético de UCI, con emisión de referral y marca de tiempo.
- Orquestador de colocación paralela con N carriles concurrentes.
- Agente de carril que negocia con un centro y ejecuta el **protocolo de compromiso verificado** (§8.3).
- Generador del expediente de justificación AOOS.
- Router de transporte multimodal con puntuación.
- Simulador de mundo determinista y sembrado (§11).
- Línea base humana-serial, con la misma semilla, para comparación honesta.
- Panel de operación con interfaz generativa (§12).
- Arnés de evaluación con las nueve métricas (§14.3).
- Opcional y desacoplado: la caja física (§13).

### 4.2 No se construye

- Integración con DonorNet, UNet, ni ningún sistema real de OPTN.
- Integración con expedientes clínicos reales de cualquier tipo.
- Ningún modelo predictivo de mortalidad, de viabilidad del órgano o de resultado del injerto.
- Ninguna lógica que ordene, reordene o altere una lista de asignación.
- Ningún componente que participe en la determinación de muerte.
- Facturación, contratos, o cualquier flujo financiero.

---

## 5. Arquitectura

### 5.1 Vista general

```
                    ┌──────────────────────────────────────────┐
                    │           PANEL DE OPERACIÓN             │
                    │   (interfaz generativa, §12)             │
                    └───────────────┬──────────────────────────┘
                                    │  eventos (stream)
                    ┌───────────────┴──────────────────────────┐
                    │              BUS DE EVENTOS              │
                    └─┬──────────┬──────────┬──────────┬───────┘
                      │          │          │          │
        ┌─────────────┴──┐  ┌────┴─────┐ ┌──┴───────┐ ┌┴──────────┐
        │   CENTINELA    │  │ DESPACHA-│ │   RUTA   │ │ ESCRIBANO │
        │   (reloj 1)    │  │   DOR    │ │(reloj 3) │ │ (registro)│
        └───────┬────────┘  └────┬─────┘ └────┬─────┘ └─────┬─────┘
                │                │            │             │
                │           ┌────┴────┐       │             │
                │           │ CARRILES│       │             │
                │           │  1..N   │       │             │
                │           └────┬────┘       │             │
        ┌───────┴────────────────┴────────────┴─────────────┴─────┐
        │                 SIMULADOR DE MUNDO (§11)                │
        │  UCI sintética · DonorNet falso · 40 centros · IVR ·     │
        │  clima · vuelos · portal legacy · reloj global           │
        └─────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴──────────────┐
                    │  ALMACÉN DE EVENTOS (append) │
                    │  fuente de verdad, auditable │
                    └──────────────────────────────┘
```

### 5.2 Principios de arquitectura

1. **El almacén de eventos es la fuente de verdad.** Todo es un evento inmutable con `t_wall`, `t_sim`, `actor`, `tipo`, `payload`. El estado se deriva. Esto no es preferencia estilística: el expediente auditable de la §8.5 y el arnés de evaluación de la §14 se construyen replayando eventos, y sin esto ninguno de los dos es defendible ante un juez.
2. **El reloj de simulación es explícito y central.** Ningún componente usa la hora del sistema para lógica de dominio. Todo consulta `sim.now()`. Esto permite acelerar la demo y reproducir corridas.
3. **Los carriles son aislados y sin estado compartido.** Un carril que falla no puede tumbar a otro. Cada uno tiene timeout duro.
4. **Determinismo por semilla.** Dada una semilla, toda la corrida es reproducible, incluida la aleatoriedad del comportamiento de los centros. Los modelos de lenguaje se corren con temperatura 0 donde sea posible y sus salidas se cachean por hash de entrada para el replay.
5. **Degradación graciosa.** Si el proveedor de voz cae, los carriles de voz se convierten en carriles de mensajería y la corrida continúa, registrando la degradación como evento.

### 5.3 Topología de agentes y por qué

| Agente | Instancias | Responsabilidad |
|---|---|---|
| **Centinela** | 1 | Vigila el flujo de UCI, detecta criterio clínico, emite referral |
| **Despachador** | 1 | Ordena la lista, abre carriles, aplica política de concurrencia, decide cierre |
| **Carril** | N (por defecto 40) | Negocia con un centro, ejecuta el protocolo de compromiso verificado |
| **Ruta** | 1 | Genera y puntúa opciones de transporte multimodal |
| **Escribano** | 1 | Construye el expediente AOOS y la cadena de custodia |

**Política de modalidad de carril — regla obligatoria.** De los N carriles, solo `K` usan voz sintética en tiempo real; el resto usa mensajería y portal simulado. Por defecto `K = 6`, `N = 40`. Razones:

- El costo de voz en tiempo real es de ~0.016 a 0.05 USD por minuto y **el silencio se factura**; 40 sesiones concurrentes son insostenibles y no aportan información adicional.
- La fragilidad se multiplica con la concurrencia; seis carriles de voz bastan para que la demo se *sienta*.
- La métrica de costo por colocación (§14.3) tiene que dar una cifra defendible frente a un juez.

`K` es configurable. Si la degradación de voz se activa, `K = 0` y el sistema sigue.

### 5.4 Slots de stack — `[STACK]` PENDIENTE DE DEFINIR

No elijas estos. Cada slot define una **capacidad**, no un proveedor. Implementa cada uno detrás de una interfaz y deja una implementación falsa local para poder trabajar antes de que se decida.

| Slot | Capacidad requerida | Interfaz mínima |
|---|---|---|
| `LLM_NEGOCIACION` | Modelo fuerte, uso de herramientas, salida estructurada, temperatura 0 | `complete(messages, tools, schema) -> {content, toolCalls, usage}` |
| `LLM_TRIAGE` | Modelo barato y rápido para clasificación y extracción | misma interfaz |
| `LLM_ROUTER` | Enrutamiento entre modelos por costo/capacidad | `route(taskKind) -> modelId` |
| `VOZ` | Voz bidireccional en tiempo real o TTS+STT | `openVoiceSession(config) -> {send, onTranscript, close}` |
| `TELEFONIA` | Llamada saliente y entrante sobre red real o simulada | `dial(number, sessionHandler) -> callId` |
| `RUNTIME` | Ejecución concurrente de N tareas de larga duración | `spawn(task) -> handle` |
| `DESPLIEGUE` | URL pública, proceso siempre encendido, WebSocket | — |
| `UI_TRANSPORTE` | Transporte de eventos agente→interfaz con componentes declarativos | `emit(event)` / `subscribe()` |
| `OBSERVABILIDAD` | Traza por paso con latencia, tokens, costo y resultado | `span(name, meta)` |
| `ALMACEN` | Append-only, lectura por rango, replay | `append(event)` / `read(from, to)` |
| `COLA` | Distribución de trabajo a los carriles | `push(job)` / `consume()` |
| `AUTH` | Solo si se conecta algo externo | — |
| `BUSQUEDA` | Solo para el router de transporte, si se usan datos reales de vuelos/clima | `search(query)` |

**Requisito duro:** ningún archivo del dominio importa un SDK de proveedor directamente. Todo pasa por `adapters/`.

---

## 6. Modelo de datos

Tipos expresados de forma neutral. Traduce al lenguaje que se decida.

### 6.1 Donante

```
Donante {
  id: string
  via: "DBD" | "DCD"
  edad: int
  grupoSanguineo: "O"|"A"|"B"|"AB"
  peso_kg: float
  altura_cm: float
  causaMuerte: "trauma"|"stroke"|"anoxia"|"otro"
  kdpi: float                    // 0..1, solo riñón
  creatinina: float
  serologias: { hcv: bool, hbv: bool, hiv: bool, cmv: bool }
  biopsiaRealizada: bool
  biopsiaHallazgos: string | null
  hospitalId: string
  t_trigger: timestamp | null    // cuándo se cumplió el criterio clínico
  t_referral: timestamp | null   // cuándo se notificó al OPO
  t_autorizacion: timestamp | null
  t_retiroSoporte: timestamp | null  // solo DCD
  t_paro: timestamp | null           // solo DCD
  t_crossClamp: timestamp | null
  ventanaDCD_min: int | null         // 60..120
}
```

### 6.2 Órgano

```
Organo {
  id: string
  donanteId: string
  tipo: "rinon_izq"|"rinon_der"|"higado"|"corazon"|"pulmon_izq"|"pulmon_der"|"pancreas"
  citLimite_h: float             // de la tabla §2.5
  perfusion: "estatico"|"hipotermica"|"normotermica" | null
  t_crossClamp: timestamp | null
  estado: EstadoOrgano           // §7.2
  descartado: bool
  motivoDescarte: CodigoRechazo | null
}
```

`citTranscurrido_h` se **deriva** de `sim.now() - t_crossClamp`. No lo almacenes; calcúlalo. Almacenarlo es la fuente número uno de bugs de reloj.

### 6.3 Centro de transplante

```
Centro {
  id: string
  nombre: string
  lat, lon: float
  volumenAnual: int                    // afecta comportamiento, ver §11.3
  perfil: PerfilCentro                 // §11.3
}
```

### 6.4 Candidato y entrada del match run

```
Candidato {
  id: string
  centroId: string
  grupoSanguineo: string
  pra: float                           // panel reactive antibody, 0..1
  urgencia: int
  tiempoEnLista_dias: int
  aceptaDCD: bool
  kdpiMaximoAceptado: float
  disponibleAhora: bool
}

EntradaMatchRun {
  secuencia: int                       // 1 = primero de la lista
  candidatoId: string
  centroId: string
}
```

### 6.5 Carril de oferta — la entidad central

```
Carril {
  id: string
  organoId: string
  entradaMatchRun: EntradaMatchRun
  modalidad: "voz"|"mensajeria"|"portal"
  estado: EstadoCarril                 // §7.3
  t_abierto: timestamp
  t_primeraRespuesta: timestamp | null
  t_cerrado: timestamp | null
  respuestaCruda: string | null
  codigoRechazo: CodigoRechazo | null
  compromiso: CompromisoVerificado | null   // §8.3
  intentos: int
  transcripcion: Turno[]
  citas: Cita[]                        // §8.6, trazabilidad de afirmaciones
}
```

### 6.6 Compromiso verificado — el objeto que distingue este producto

```
CompromisoVerificado {
  cirujanoNombrado: string | null
  quirofanoReservado: { sala: string, hora: timestamp } | null
  receptorConfirmadoDisponible: bool | null
  etaEquipoRecuperacion: timestamp | null
  citTotalProyectada_h: float | null
  completo: bool          // true solo si los cuatro primeros campos están llenos
  t_verificado: timestamp | null
}
```

### 6.7 Plan de transporte

```
OpcionTransporte {
  modalidad: "terrestre"|"comercial"|"helicoptero"|"jet"|"dron"
  tramos: Tramo[]
  duracionTotal_min: int
  citProyectada_h: float
  costoUSD: float
  riesgoClima: float        // 0..1
  riesgoConexion: float     // 0..1
  viable: bool
  motivoNoViable: string | null    // p. ej. "payload 12 lb < dispositivo de perfusión"
  puntaje: float                   // §8.4
}
```

### 6.8 Evento

```
Evento {
  id: string
  t_wall: timestamp         // hora real
  t_sim: timestamp          // hora de simulación
  actor: "centinela"|"despachador"|"carril:<id>"|"ruta"|"escribano"|"simulador"|"humano"
  tipo: string
  payload: object
  semilla: string
  corridaId: string
}
```

---

## 7. Máquinas de estado

### 7.1 Caso de donación

```
DETECTADO ──> REFERIDO ──> EVALUANDO ──> AUTORIZADO ──> ASIGNANDO ──> RECUPERADO ──> EN_TRANSITO ──> IMPLANTADO
    │             │             │             │              │
    └─> DESCARTADO_PRE (en cualquier punto previo a la recuperación)

Rama DCD, entre AUTORIZADO y RECUPERADO:
AUTORIZADO ──> SOPORTE_RETIRADO ──> [paro dentro de ventana?]
                                      ├─ sí ──> NO_TOUCH_5MIN ──> RECUPERADO
                                      └─ no ──> VENTANA_EXPIRADA ──> SIN_DONACION (terminal)
```

`VENTANA_EXPIRADA` **debe** estar implementado. Es el caso que hace que la demo sea creíble ante alguien que conoce el dominio.

### 7.2 Órgano

```
NO_RECUPERADO ──> EN_ISQUEMIA_FRIO ──> ACEPTADO_FIRME ──> EN_TRANSITO ──> IMPLANTADO
                          │
                          └──> DESCARTADO   (si cit >= citLimite o no hay aceptación)
```

Regla: al entrar en `EN_ISQUEMIA_FRIO` se arma un temporizador que emite `ALERTA_CIT` al 50 %, 75 % y 90 % del límite. Estas alertas alimentan la interfaz y el arnés de evaluación.

### 7.3 Carril — la máquina más importante

```
                 ┌──────────────────────────────────────────┐
                 v                                          │
ABIERTO ──> CONTACTANDO ──> ESPERANDO_RESPUESTA ──> ┬──> RECHAZADO (terminal)
                                                     │
                                                     ├──> PROVISIONAL ──> VERIFICANDO ──┬──> COMPROMETIDO (terminal, éxito)
                                                     │                                   │
                                                     │                                   └──> DEGRADADO (terminal)
                                                     │
                                                     └──> ACEPTADO_DIRECTO (terminal, éxito)

Desde cualquier estado no terminal:
  ──> TIMEOUT (terminal)
  ──> ABORTADO (terminal, el despachador ya cerró la colocación)
```

**`PROVISIONAL ──> VERIFICANDO ──> DEGRADADO` es la transición que justifica el producto entero.** Un provisional yes que no logra llenar los cuatro campos del compromiso dentro de `T_VERIFICACION` segundos se degrada y se libera el carril. Cada degradación emite un evento con el tiempo de isquemia que se habría perdido si se hubiera esperado al rechazo tardío (usa H07: 1.5 h como valor por defecto configurable).

### 7.4 Parámetros de política

| Parámetro | Valor por defecto | Fundamento |
|---|---|---|
| `N_CARRILES` | 40 | tamaño de demo |
| `K_VOZ` | 6 | §5.3 |
| `MAX_CONCURRENTES_POLITICA` | 4 | H16 — el caso del OPO que bajó 32 % su CIT limitando a 4 |
| `T_PRIMERA_RESPUESTA` | 180 s sim | — |
| `T_VERIFICACION` | 240 s sim | — |
| `T_TIMEOUT_CARRIL` | 600 s sim | — |
| `UMBRAL_CIT_ALERTA` | 0.5, 0.75, 0.9 | — |
| `HORAS_SALVADAS_POR_DEGRADACION` | 1.5 h | H07 |

**Nota de diseño importante.** `N_CARRILES = 40` y `MAX_CONCURRENTES_POLITICA = 4` conviven: se abren 40 carriles de *evaluación* barata (mensajería/portal) pero solo 4 avanzan simultáneamente a *compromiso*. Esto replica exactamente la intervención de H16 y es lo que se defiende ante el juez que objete "ofertar a 40 a la vez es peor, no mejor" — objeción legítima dado H09 a H14. Implementa ambos niveles.

---

## 8. Los agentes, uno por uno

Para cada agente: rol, entradas, salidas, herramientas, criterios de terminación y guardrails. Los textos de sistema son especificaciones de comportamiento, no literales a copiar sin adaptar al modelo que se elija.

### 8.1 CENTINELA — reloj 1

**Rol.** Vigilar el flujo sintético de UCI y determinar si se cumple un criterio clínico de referral, con cita textual del dato que lo dispara.

**Entradas.** Stream de observaciones por paciente: Glasgow, reflejos de tronco, estado ventilatorio, notas de evolución, órdenes.

**Salidas.**
```
ReferralPropuesto {
  pacienteId, t_trigger, criterios: [{nombre, valorObservado, citaOrigen}],
  ventanaMinutos, urgencia: "estandar"|"dcd_probable", confianza: float
}
```

**Herramientas.** `leerObservaciones`, `leerNotas`, `emitirReferral`, `escalarAHumano`.

**Comportamiento.**
- Evalúa **solo criterios explícitos y computables**: Glasgow ≤ 5, ausencia documentada de reflejos de tronco, ventilación mecánica con lesión neurológica documentada, orden documentada de retiro de soporte, pregunta espontánea de la familia registrada en nota.
- Cada criterio reportado **debe** llevar `citaOrigen` apuntando al identificador de la observación o nota exacta. Sin cita, el criterio no cuenta.
- **Prohibido** pronosticar, estimar probabilidad de muerte, evaluar idoneidad médica del donante o recomendar retiro de soporte. La idoneidad la determina el OPO; el sistema solo notifica.
- Si `confianza < 0.8` o los criterios son ambiguos, emite `escalarAHumano` en lugar de referral.

**Terminación.** Emite referral o escala. Nunca queda abierto.

**Criterio de aceptación.** Sobre el conjunto sintético de §10.2, detecta ≥ 95 % de los casos positivos etiquetados y produce ≤ 5 % de falsos positivos, con cita válida en el 100 % de los criterios reportados.

### 8.2 DESPACHADOR

**Rol.** Convertir un match run en una campaña de carriles y decidir cuándo cerrar.

**Entradas.** Órgano, match run ordenado, parámetros de política (§7.4), estado del reloj de isquemia.

**Salidas.** Aperturas de carril, promociones a verificación, cierre de colocación, solicitud de expediente AOOS.

**Herramientas.** `abrirCarril`, `promoverCarril`, `cerrarCarril`, `abortarCampana`, `consultarReloj`, `solicitarPlanTransporte`, `solicitarExpediente`.

**Comportamiento.**
- Abre hasta `N_CARRILES` en modo evaluación, respetando el orden de secuencia.
- Mantiene como máximo `MAX_CONCURRENTES_POLITICA` carriles en estado `VERIFICANDO`.
- Cuando un carril entra en `DEGRADADO`, promueve inmediatamente al siguiente candidato por secuencia. **Sin esperar.** Ese es el ahorro.
- Recalcula la CIT proyectada en cada transición y, si supera `citLimite`, marca los carriles restantes como inviables por `LOG_CIT_TOO_LONG` — el sistema debe ser capaz de reproducir la razón de rechazo número uno.
- Si la mejor opción viable tiene número de secuencia por encima de un umbral configurable (por defecto 100), marca la colocación como **AOOS** y exige expediente.

**Guardrail.** No reordena el match run jamás. Solo puede saltarse posiciones marcando AOOS explícitamente, con justificación, y registrando el salto como evento auditable.

### 8.3 CARRIL — y el protocolo de compromiso verificado

**Rol.** Conducir la interacción con un centro hasta un resultado terminal.

**El protocolo, que es la contribución técnica del proyecto:**

1. **Contacto.** Presenta la oferta con los datos mínimos: tipo de órgano, vía (DBD/DCD), edad, grupo sanguíneo, KDPI si aplica, serologías, CIT actual y CIT proyectada al implante en ese centro.
2. **Respuesta.** Si es rechazo, captura el **código estandarizado** (§3.2). Si el centro da una razón en prosa, el carril la mapea a código y guarda la prosa como cita.
3. **Si es provisional yes, NO lo acepta.** Entra en `VERIFICANDO` y pregunta explícitamente por los cuatro campos:
   - ¿Qué cirujano lo hará? *(nombre)*
   - ¿Qué sala y a qué hora? *(sala + timestamp)*
   - ¿El receptor está confirmado y disponible ahora? *(sí/no)*
   - ¿A qué hora llega su equipo de recuperación? *(timestamp)*
4. **Resolución.** Si los cuatro se llenan dentro de `T_VERIFICACION`, el carril pasa a `COMPROMETIDO`. Si no, pasa a `DEGRADADO` y emite:
   ```
   EventoDegradacion {
     carrilId, centroId, camposFaltantes: [...],
     horasIsquemiaProtegidas: 1.5,     // H07
     citaRespuesta: "..."
   }
   ```
5. **Nunca** rellena un campo que el centro no dijo. Un campo inferido es un bug de seguridad clínica, no un detalle.

**Herramientas.** `enviarOferta`, `recibirRespuesta`, `preguntarCompromiso`, `mapearCodigoRechazo`, `registrarCita`, `cerrarCarril`.

**Guardrails.**
- Toda afirmación clínica en la transcripción debe existir en el registro del donante. El carril no genera datos clínicos.
- Si el centro pregunta algo que no está en el registro, la respuesta correcta es "no está en el registro, lo consulto", no una inferencia.
- Temperatura 0.

**Criterio de aceptación.** Sobre 100 corridas sembradas, el carril mapea correctamente ≥ 90 % de las razones de rechazo a su código, y **nunca** marca `compromiso.completo = true` con algún campo no dicho explícitamente por el centro (tolerancia cero).

### 8.4 RUTA — reloj 3

**Rol.** Generar y puntuar opciones de transporte.

**Entradas.** Origen (hospital donante), destino (centro), tipo de órgano, `t_crossClamp`, CIT ya transcurrida, presencia de perfusión.

**Salidas.** Lista de `OpcionTransporte` ordenada por puntaje, con las inviables incluidas y su motivo.

**Función de puntaje.**
```
margen = citLimite - citProyectada
si margen <= 0:        viable = false, motivo = "excede isquemia"
puntaje = w1*normalizar(margen)
        - w2*normalizar(costoUSD)
        - w3*riesgoClima
        - w4*riesgoConexion
por defecto: w1=0.50, w2=0.15, w3=0.15, w4=0.20
```

**Restricciones por modalidad — implementar como reglas duras:**

| Modalidad | Restricciones |
|---|---|
| `terrestre` | < 2 h de trayecto |
| `comercial` | penalización alta de `riesgoConexion`; más de la mitad de los incidentes documentados son de aerolíneas y aeropuertos (H33) |
| `helicoptero` | < 150 mi; 90–120 min de activación |
| `jet` | > 400 mi óptimo; costo alto |
| `dron` | **payload 12 lb**; si hay dispositivo de perfusión → `viable = false`, motivo `"payload insuficiente para dispositivo de perfusión"`; solo corredores predefinidos; sin regla BVLOS final → marcar `requiereExencion = true` |

**La regla del dron es un requisito de producto, no una limitación técnica.** Que el sistema muestre al dron perdiendo contra el jet en casi todos los tramos, con el motivo escrito, es una salida deseada. Demuestra que el equipo conoce los límites de su propia idea.

### 8.5 ESCRIBANO

**Rol.** Producir el expediente de justificación AOOS y la cadena de custodia.

**Salida — estructura obligatoria:**
```
ExpedienteAOOS {
  organoId, donanteResumen,
  secuenciaFinal: int,
  totalOfertas: int,
  rechazos: [{ secuencia, centroId, codigo, t_sim, citaLiteral }],
  degradaciones: [{ centroId, camposFaltantes, t_sim, horasProtegidas }],
  justificacion: string,          // prosa generada, cada afirmación con referencia a un evento
  citLinea: [{ t_sim, citHoras, evento }],
  firmaHash: string               // hash del rango de eventos que lo respalda
}
```

**Regla.** Cada oración de `justificacion` debe poder mapearse a al menos un `Evento.id`. El escribano emite además `cobertura: float` = proporción de oraciones con respaldo. Si `cobertura < 1.0`, el expediente se marca como incompleto y se muestra así en la interfaz. **No lo ocultes: mostrarlo es una fortaleza, no una debilidad.**

### 8.6 Trazabilidad de afirmaciones — transversal

```
Cita {
  afirmacion: string
  origen: "registro_donante"|"respuesta_centro"|"politica"|"dato_externo"
  referencia: string        // id de evento, campo del donante, o URL
  literal: string
}
```

Toda salida de cualquier agente que contenga una afirmación fáctica lleva `Cita[]`. La métrica `tasaDeCitacion` (§14.3) se calcula sobre esto y es el sustituto medible de "no alucina".

---

## 9. Contratos de herramientas

Esquemas JSON. Un esquema inválido es un fallo, no una advertencia — la métrica de `toolUseAccuracy` se calcula sobre validaciones.

```json
{
  "name": "emitirReferral",
  "description": "Notifica al OPO que un paciente cumple criterios de referral. No implica evaluación de idoneidad.",
  "input_schema": {
    "type": "object",
    "required": ["pacienteId", "criterios", "t_trigger"],
    "properties": {
      "pacienteId": {"type": "string"},
      "t_trigger": {"type": "string", "format": "date-time"},
      "criterios": {
        "type": "array", "minItems": 1,
        "items": {
          "type": "object",
          "required": ["nombre", "valorObservado", "citaOrigen"],
          "properties": {
            "nombre": {"type": "string",
              "enum": ["glasgow_menor_igual_5","ausencia_reflejos_tronco",
                       "ventilacion_con_lesion_neurologica","orden_retiro_soporte",
                       "pregunta_espontanea_familia"]},
            "valorObservado": {"type": "string"},
            "citaOrigen": {"type": "string", "description": "id de observación o nota"}
          }
        }
      },
      "urgencia": {"type": "string", "enum": ["estandar", "dcd_probable"]},
      "confianza": {"type": "number", "minimum": 0, "maximum": 1}
    }
  }
}
```

```json
{
  "name": "preguntarCompromiso",
  "description": "Solicita a un centro los cuatro elementos que convierten un provisional yes en compromiso verificado. No inferir ningún campo.",
  "input_schema": {
    "type": "object",
    "required": ["carrilId", "camposSolicitados"],
    "properties": {
      "carrilId": {"type": "string"},
      "camposSolicitados": {
        "type": "array",
        "items": {"type": "string",
          "enum": ["cirujanoNombrado","quirofanoReservado",
                   "receptorConfirmadoDisponible","etaEquipoRecuperacion"]}
      }
    }
  }
}
```

```json
{
  "name": "registrarCompromiso",
  "description": "Registra los campos que el centro declaró EXPLICITAMENTE. Prohibido rellenar campos no dichos.",
  "input_schema": {
    "type": "object",
    "required": ["carrilId", "campos", "citas"],
    "properties": {
      "carrilId": {"type": "string"},
      "campos": {
        "type": "object",
        "properties": {
          "cirujanoNombrado": {"type": ["string","null"]},
          "quirofanoReservado": {
            "type": ["object","null"],
            "properties": {"sala":{"type":"string"},"hora":{"type":"string","format":"date-time"}}
          },
          "receptorConfirmadoDisponible": {"type": ["boolean","null"]},
          "etaEquipoRecuperacion": {"type": ["string","null"], "format": "date-time"}
        }
      },
      "citas": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["afirmacion","origen","referencia","literal"],
          "properties": {
            "afirmacion": {"type":"string"},
            "origen": {"type":"string","enum":["registro_donante","respuesta_centro","politica","dato_externo"]},
            "referencia": {"type":"string"},
            "literal": {"type":"string"}
          }
        }
      }
    }
  }
}
```

```json
{
  "name": "mapearCodigoRechazo",
  "description": "Convierte la razón en prosa de un centro al código estandarizado de OPTN.",
  "input_schema": {
    "type": "object",
    "required": ["carrilId","prosaOriginal","categoria","codigo"],
    "properties": {
      "carrilId": {"type":"string"},
      "prosaOriginal": {"type":"string"},
      "categoria": {"type":"string",
        "enum": ["DONOR_CANDIDATE_MATCHING","ORGAN_SPECIFIC","CANDIDATE_SPECIFIC",
                 "HISTOCOMPATIBILITY","DISEASE_TRANSMISSION_RISK","DONOR_SPECIFIC",
                 "LOGISTICS","OTHER"]},
      "codigo": {"type":"string"},
      "confianza": {"type":"number","minimum":0,"maximum":1}
    }
  }
}
```

```json
{
  "name": "puntuarOpcionesTransporte",
  "description": "Genera y puntúa opciones de transporte. Debe incluir las inviables con su motivo.",
  "input_schema": {
    "type": "object",
    "required": ["organoId","origen","destino","citTranscurrida_h","citLimite_h"],
    "properties": {
      "organoId": {"type":"string"},
      "origen": {"type":"object","properties":{"lat":{"type":"number"},"lon":{"type":"number"}}},
      "destino": {"type":"object","properties":{"lat":{"type":"number"},"lon":{"type":"number"}}},
      "citTranscurrida_h": {"type":"number"},
      "citLimite_h": {"type":"number"},
      "tienePerfusion": {"type":"boolean"},
      "modalidadesPermitidas": {
        "type":"array",
        "items":{"type":"string","enum":["terrestre","comercial","helicoptero","jet","dron"]}
      }
    }
  }
}
```

---

## 10. Datos sintéticos

### 10.1 Principios

- Cero datos reales de pacientes. Nombres generados, identificadores con prefijo `SYN-`.
- Las **distribuciones** imitan la realidad usando la tabla §3.1; los **individuos** son ficticios.
- Todo generador acepta `semilla` y es determinista.
- Cada archivo generado lleva encabezado `# DATOS SINTÉTICOS — NO CLÍNICOS`.

### 10.2 Conjunto de UCI para el Centinela

Genera 200 pacientes-hora de flujo, con etiquetas de verdad:

| Clase | Cantidad | Descripción |
|---|---|---|
| `positivo_claro` | 30 | Glasgow ≤ 5 documentado + ventilador + lesión neurológica |
| `positivo_dcd` | 20 | Orden documentada de retiro de soporte |
| `positivo_limitrofe` | 15 | Glasgow 6–7, sedado, ambiguo → se espera `escalarAHumano` |
| `negativo_obvio` | 100 | Pacientes sin criterio alguno |
| `negativo_tramposo` | 35 | Glasgow bajo **por sedación documentada**, o lesión no neurológica |

Los `negativo_tramposo` existen para que el detector no aprenda "Glasgow bajo = referir". La sedación documentada invalida el criterio; el Centinela debe leer la nota.

### 10.3 Donantes

Genera 50 donantes con distribuciones ancladas:

| Atributo | Distribución | Fuente |
|---|---|---|
| vía | 43 % DCD, 57 % DBD | H30 |
| edad | lognormal, media 45, cola hasta 75 | — |
| KDPI | uniforme 0.1–0.99, con 20 % ≥ 0.85 | H18 |
| biopsia realizada | 35 % | — |
| ventanaDCD_min | uniforme 60–120 | H31 |
| causa de muerte | 35 % stroke, 30 % anoxia, 25 % trauma, 10 % otro | — |

### 10.4 Centros y candidatos

40 centros. `volumenAnual` distribuido: 5 grandes (>200), 15 medianos (50–200), 20 pequeños (<50). El tamaño importa: las colocaciones fuera de secuencia se concentran en los centros grandes (21.6 % en los once mayores vs 4.3 % en los de menos de 50 al año).

Por centro, entre 30 y 400 candidatos según volumen. El match run se ordena por una función explícita y visible de grupo sanguíneo, PRA, urgencia y tiempo en lista, para que el orden sea auditable y no mágico.

---

## 11. El simulador de mundo

**Esta es la pieza que decide si el proyecto se puede construir o no.** Sin acceso a DonorNet, el simulador *es* el mundo. Constrúyelo primero y bien.

### 11.1 Responsabilidades

1. Reloj de simulación con factor de aceleración configurable (demo: 60× a 300×).
2. Flujo de UCI sintético reproducible.
3. DonorNet falso: match run, envío de ofertas, recepción de respuestas.
4. 40 centros con comportamiento calibrado (§11.3).
5. Canal de voz simulado: un centro "habla" con guiones parametrizados por su perfil.
6. Portal legacy falso: formularios lentos, sesiones que expiran, campos mal etiquetados.
7. Clima y vuelos: tablas estáticas suficientes para el router.
8. **Ejecutor de línea base serial** (§11.4).

### 11.2 Contrato del reloj

```
sim.now() -> timestamp
sim.advance(segundos)
sim.schedule(en_segundos, callback)
sim.factor          // aceleración
sim.freeze() / sim.resume()
```

**Ningún componente de dominio llama a la hora del sistema.** Pon un lint que falle el build si alguien importa el reloj del lenguaje fuera de `adapters/`.

### 11.3 Perfil de centro — tabla de calibración

Cada centro recibe un `PerfilCentro` muestreado con estos parámetros. **Cada uno está anclado a un hecho de §3.1.** Esto es lo que hace que la simulación sea defendible y no un juguete.

```
PerfilCentro {
  // --- disposición a aceptar ---
  kdpiMaximo: float                    // muestreado 0.5..1.0
  aceptaDCD: bool                      // p = 0.70
  citMaximaTolerada_h: float           // muestreado, media = 0.7 * citLimite del órgano
  requiereBiopsia: bool                // p = 0.35

  // --- comportamiento temporal ---
  latenciaRespuesta_s: LogNormal(mu, sigma)   // mediana 120 s sim, cola larga
  multiplicadorNocturno: 1.11                 // H37, aplica 18:00-06:00
  multiplicadorFinDeSemana: 1.14              // derivado de H38 (OR 0.88 de aceptación)

  // --- el comportamiento clave ---
  pProvisionalYes: float               // 0.25..0.45
  pDeclineDadoProvisional: 0.70        // H05  <-- NO ajustar sin justificación
  pCompromisoCompletoDadoProvisional: 0.30   // complemento de H05

  // --- ruido de decisión ---
  pCambioDeDecision: 0.20              // H15, aplica si se reofertata el mismo órgano

  // --- distribución de códigos de rechazo ---
  distribucionRechazo: {
    LOG_CIT_TOO_LONG: 0.2037,          // H01
    ORGAN_SPECIFIC_TEST_RESULTS: 0.1427,
    DONOR_MEDICAL_HISTORY: 0.1227,
    ORGAN_ANATOMICAL_DEFECT: 0.1013,
    BIOPSY_UNACCEPTABLE: 0.0930,
    OTHER: 0.0738,
    DONOR_AGE: 0.0553,
    ORGAN_PRESERVATION: 0.0313,
    LOG_WIT_TOO_LONG: 0.0270,
    <resto>: distribuir hasta sumar 1.0
  }
}
```

**Regla de oro del simulador:** el comportamiento del centro **no sabe** si lo está contactando el agente o la línea base humana. Si lo supiera, la comparación sería un fraude y un juez que pregunte "¿cómo sé que no hiciste trampa?" tendría razón. Escribe un test que lo verifique.

### 11.4 Línea base serial — obligatoria

Ejecuta el mismo caso, con la misma semilla y los mismos perfiles de centro, bajo política humana:

- Un solo carril activo a la vez.
- Baja por el match run en orden estricto.
- Acepta el provisional yes al pie de la letra y **espera** el resultado (que será rechazo con p = 0.70, en promedio 1.5 h después).
- Latencia humana adicional entre carriles: 90 s sim.
- Multiplicador nocturno de la latencia del propio operador: 1.5× entre 00:00 y 06:00.

La diferencia entre esta corrida y la del agente **es el producto**, y es la única cifra que el jurado necesita creer. Que salga de la misma semilla es lo que la hace creíble.

### 11.5 Portal legacy falso

No lo hagas bonito. Tres comportamientos obligatorios: la sesión expira a los 8 minutos sim, un campo obligatorio está etiquetado de forma confusa, y la respuesta tarda entre 2 y 9 segundos. Sirve para demostrar por qué un agente y no una API — y para tener dónde enseñar `computer use` **como plan B visible, nunca en el camino crítico** (§18).

---

## 12. Interfaz

### 12.0 `[DECIDIR]` Idioma de la interfaz

Español o inglés. Decidir antes de la fase 5 y no mezclar.

### 12.1 Principio

La interfaz es la sala de operaciones, no un chat. Se opera y se escanea, no se lee. Prioridad visual: **el reloj primero**, el estado de los carriles segundo, todo lo demás después. Usa componentes declarativos a través de `UI_TRANSPORTE`; **no generes HTML crudo** — cuesta entre cinco y diez veces más en tokens y deja al operador mirando un esqueleto.

### 12.2 Pantallas

**P1 · Sala de colocación** (la pantalla principal, la que se fotografía)
- Cabecera: reloj de isquemia grande, contando. Cambia de color al 50 %, 75 % y 90 % del límite. **No se detiene nunca durante la demo.**
- Franja de resumen: ofertas emitidas, carriles vivos, mejor secuencia alcanzada, CIT proyectada de la mejor opción.
- Rejilla de 40 celdas de carril. Cada celda: nombre del centro, número de secuencia, estado con color, latencia, y —cuando aplica— las cuatro casillas del compromiso verificado llenándose una por una. **Ver esas cuatro casillas llenarse, o no llenarse, es el momento central de la demo.**
- Panel lateral: registro de eventos en vivo, filtrable por actor.
- Cintillo inferior: línea base serial corriendo en paralelo, con su propia posición y su propio reloj.

**P2 · Referral** (reloj 1)
- Paciente sintético, criterios detectados con su cita textual resaltada, cuenta regresiva de 60 minutos, botón de escalamiento a humano.

**P3 · Router de transporte** (reloj 3)
- Mapa origen-destino. Tarjetas por modalidad con duración, CIT proyectada, costo, riesgos y puntaje. **Las inviables se muestran, tachadas, con su motivo escrito.** El dron aparece casi siempre tachado con "payload insuficiente para dispositivo de perfusión" — eso es intencional.

**P4 · Expediente AOOS**
- Documento navegable. Cada oración de la justificación enlaza al evento que la respalda. Indicador de cobertura visible.

**P5 · Panel de métricas** (§14.3)
- Las nueve cifras, en vivo. Esta es la pantalla de los últimos veinte segundos del pitch.

### 12.3 Estados de carril y color

| Estado | Tratamiento |
|---|---|
| `ABIERTO` / `CONTACTANDO` | neutro, tenue |
| `ESPERANDO_RESPUESTA` | neutro con pulso |
| `PROVISIONAL` | advertencia |
| `VERIFICANDO` | advertencia con las cuatro casillas visibles |
| `DEGRADADO` | crítico, con la etiqueta "1.5 h protegidas" |
| `RECHAZADO` | apagado, con el código |
| `COMPROMETIDO` | acento, elevado |

Color semántico separado del color de acento de la marca. El acento se reserva para el éxito.

---

## 13. La caja — hardware opcional

**Plataforma:** Jetson Orin Nano Super, cámara, pantalla, servomotores.

### 13.1 Regla de acoplamiento

La caja es un **consumidor** del bus de eventos y un **productor** de eventos de custodia. Nada en el camino crítico depende de ella. Si no está conectada, el sistema no lo nota. Implementa esto como un servicio que se registra al bus y desaparece sin efecto.

### 13.2 Funciones

| Componente | Función |
|---|---|
| Pantalla | Cuenta regresiva de viabilidad, últimos eventos de custodia, última excepción. Es la cara física del agente. |
| Cámara | Lee la etiqueta del órgano; verifica el traspaso de custodia contra la credencial de quien recibe; detecta que el sello fue alterado. |
| Servo | Pestillo que solo cede tras un traspaso verificado. Cada apertura queda como evento de custodia autenticado. |
| Inferencia local | Un modelo pequeño en el dispositivo evalúa excepciones **sin red**. |

### 13.3 El argumento del modo sin red

Una bodega de carga no tiene señal, y HRSA documentó que no existe visibilidad centralizada del órgano en tránsito ni estándares de comunicación entre OPOs, centros y transportistas. El agente de a bordo, desconectado, sigue evaluando: "temperatura fuera de rango hace 11 minutos, quedan 40 de vuelo". Encola el paquete de escalamiento y lo dispara en el instante en que recupera señal.

Implementa el modo sin red como estado explícito y **demuéstralo**: corta la conexión a propósito durante la prueba y verifica que el paquete sale completo al reconectar.

### 13.4 Eventos que produce

```
CUSTODIA_TRASPASADA { deQuien, aQuien, metodoVerificacion, t_sim, fotoHash }
SELLO_ALTERADO      { t_sim, fotoHash }
TEMPERATURA_FUERA_DE_RANGO { valor, duracion_min, t_sim }
APERTURA_DENEGADA   { motivo, t_sim }
MODO_SIN_RED_ACTIVADO / DESACTIVADO { duracion_s, eventosEncolados }
```

### 13.5 Advertencia

El hardware no aparece en ninguna rúbrica de hackathon y falla en el escenario. **Úsalo en los últimos veinte segundos, nunca antes.** Si el servo muere, el pitch continúa sin mencionarlo.

---

## 14. Observabilidad y arnés de evaluación

### 14.1 Instrumentación

Cada llamada a modelo y cada llamada a herramienta produce un span con: `nombre`, `actor`, `latencia_ms`, `tokensEntrada`, `tokensSalida`, `costoUSD`, `resultado`, `validacionEsquema: bool`, `corridaId`, `semilla`.

Instrúmentalo en la fase 3, no al final. Si lo dejas para después, no se hace.

### 14.2 Por qué importa más de lo que parece

Los organizadores de hackathons de agentes dicen explícitamente que quieren puntuar *trace logs* y métricas —tasa de completitud, precisión de uso de herramientas, costo por corrida, latencia— y casi ningún equipo las lleva al escenario. Es el diferenciador más barato que existe.

### 14.3 Las nueve métricas

| # | Métrica | Definición | Meta |
|---|---|---|---|
| M1 | **Horas de isquemia ahorradas** | `cit_baseline − cit_agente`, misma semilla | > 3 h |
| M2 | **Tiempo hasta primer compromiso verificado** | desde apertura de campaña | < 25 % del baseline |
| M3 | **Provisional yes falsos interceptados** | degradaciones / provisional yes totales | > 60 % |
| M4 | **Ofertas emitidas por colocación** | total de contactos hasta cierre | ≤ baseline |
| M5 | **Tasa de completitud de carril** | carriles en estado terminal legítimo / abiertos | > 0.95 |
| M6 | **Precisión de uso de herramientas** | llamadas que validan contra esquema / total | > 0.98 |
| M7 | **Latencia por carril** | p50 y p95 | p95 < 8 s reales |
| M8 | **Costo por colocación** | suma de costo de la corrida | reportar en USD, sin meta |
| M9 | **Tasa de citación** | afirmaciones fácticas con `Cita` válida / total | 1.00 |

M9 con meta 1.00 es deliberado: es el sustituto medible de "no alucina" en un dominio clínico, y cualquier valor menor a uno debe mostrarse, no esconderse.

### 14.4 Suite de regresión

Diez semillas fijas. Cada una corre baseline y agente. El build falla si M5, M6 o M9 caen por debajo de su meta. Guarda los resultados en `evals/resultados.json` y muéstralos en P5.

---

## 15. Guardrails y seguridad clínica

Estos no son sugerencias. Impleméntalos como código que rechaza, no como instrucción en un prompt.

| # | Regla | Implementación |
|---|---|---|
| G1 | Cero datos de pacientes reales | Validador de ingesta que rechaza cualquier registro sin prefijo `SYN-` |
| G2 | El sistema no determina muerte | No existe ninguna herramienta que escriba un estado de muerte. Verificar en el registro de herramientas. |
| G3 | El sistema no pronostica | Ningún agente tiene herramienta de predicción. El Centinela solo evalúa criterios explícitos. |
| G4 | El sistema no altera el orden de asignación | El match run es inmutable tras generarse. Un salto solo es posible marcando AOOS con justificación. |
| G5 | Ningún dato clínico generado por modelo | Todo dato clínico en cualquier salida debe tener `Cita` con `origen = registro_donante`. Sin cita, se rechaza. |
| G6 | Ningún campo de compromiso inferido | `registrarCompromiso` rechaza un campo sin cita con `origen = respuesta_centro` |
| G7 | Escalamiento ante incertidumbre | `confianza < 0.8` en Centinela → `escalarAHumano` obligatorio |
| G8 | Todo es auditable | Ninguna decisión sin evento correspondiente. Test que verifica que cada transición de estado tiene su evento. |
| G9 | Degradación visible, no silenciosa | Toda degradación (voz caída, modelo caído, timeout) emite evento y se pinta en la interfaz |

---

## 16. Plan de construcción por fases

Cada fase tiene un criterio de aceptación binario. No avances sin cumplirlo.

### Fase 0 · Andamiaje (2 h)
Repositorio, estructura de carpetas con `adapters/` aislado, almacén de eventos append-only, reloj de simulación, lint que prohíbe la hora del sistema fuera de adapters.
**Aceptación:** se emite un evento, se lee de vuelta, `sim.advance(3600)` mueve el reloj y nada más lo mueve.

### Fase 1 · Simulador de mundo (5 h)
Generadores de §10, 40 centros con perfil calibrado de §11.3, DonorNet falso, match run auditable.
**Aceptación:** dos corridas con la misma semilla producen exactamente la misma secuencia de eventos. Test que verifica que el centro no sabe quién lo contacta.

### Fase 2 · Línea base serial (2 h)
Ejecutor humano-serial de §11.4.
**Aceptación:** produce una CIT final reproducible y un registro de rechazos con códigos.

### Fase 3 · Motor de carriles + observabilidad (5 h)
Orquestador concurrente con timeout, reintento y bus de eventos. Spans instrumentados desde el primer carril.
**Aceptación:** 40 carriles simulados corren en paralelo, ninguno tumba a otro, y cada uno produce spans con latencia y costo.

### Fase 4 · Agentes de dominio (6 h)
Centinela, Despachador, Carril con protocolo de compromiso verificado, Ruta, Escribano.
**Aceptación:** el protocolo de compromiso degrada correctamente un provisional yes incompleto y emite `EventoDegradacion`; el Centinela acierta ≥ 95 % en el conjunto etiquetado; M6 y M9 en meta.

### Fase 5 · Interfaz (6 h)
P1 a P5 con componentes declarativos.
**Aceptación:** las cuatro casillas del compromiso se ven llenarse en vivo; el reloj nunca se detiene; la línea base corre visible en paralelo.

### Fase 6 · Expediente y router (4 h)
Escribano con cobertura de citación; Ruta con las cinco modalidades y las reglas duras, incluida la del dron.
**Aceptación:** el expediente reporta cobertura y cada oración enlaza a un evento; el dron aparece tachado con motivo escrito cuando hay perfusión.

### Fase 7 · Despliegue y reproducibilidad (4 h)
URL pública, repositorio público, diagrama de arquitectura, `README` con instrucciones de corrida.
**Aceptación:** un tercero clona, corre una semilla y obtiene el mismo resultado.

### Fase 8 · Suite de evaluación (3 h)
Diez semillas, resultados persistidos, panel P5 en vivo.
**Aceptación:** `evals/resultados.json` existe y P5 lo muestra.

### Fase 9 · La caja (3 h, opcional, desacoplada)
Solo si las fases 0 a 8 están completas. Nunca antes.
**Aceptación:** el sistema completo corre idéntico con la caja desconectada.

### Fase 10 · Ensayo (3 h)
Cinco corridas completas de demo con cronómetro. Grabación de respaldo.
**Aceptación:** cinco de cinco sin fallo. Si falla una, quita un paso y repite.

---

## 17. Guion de demo — tres minutos

### 17.1 Regla de conteo de pasos

Con 98 % de fiabilidad por paso, veinte pasos dan 67 % de éxito y cincuenta dan 36 %. **Máximo diez acciones de agente en vivo.** Lo demás va en el registro de traza.

### 17.2 Los ocho momentos

| t | Qué pasa | Qué se dice |
|---|---|---|
| 0:00 | Arranca el reloj de isquemia en pantalla. No se detiene en todo el pitch. | "Veintisiete por ciento de los riñones donados se tira." Nada más. |
| 0:15 | UCI sintética: Glasgow de 5 en ventilador. El Centinela detecta y refiere. | "Datos sintéticos. El reloj legal es de sesenta minutos y hoy lo juzga una enfermera con seis pacientes." |
| 0:35 | Pantalla partida: humano en el centro 1, agente abre cuarenta carriles. | Silencio. La imagen habla. |
| 1:00 | **El golpe.** Un centro da provisional yes. El agente pregunta por cirujano, quirófano, receptor y ETA. No los llena. El carril se degrada. | "Setenta por ciento de los provisional yes son falsos. Ese habría rechazado hora y media antes del cross-clamp." |
| 1:30 | Cierra en secuencia 812. Aparece el expediente AOOS con cobertura de citación. | "Esto es lo que HRSA ahora audita, y hoy se escribe a mano." |
| 1:55 | Router de transporte: cinco modalidades puntuadas. El dron tachado con su motivo. | "El dron gana el tramo urbano de treinta millas y pierde todo lo demás. Part 108 no es regla final y no carga un sistema de perfusión." |
| 2:20 | La caja sobre la mesa: cuenta regresiva, custodia, el pestillo que no cede y luego sí. | "El agente también está aquí, y sigue razonando sin red." |
| 2:40 | Panel de métricas. Reloj congelado. | "Horas de isquemia ahorradas contra la misma semilla. Repositorio, URL desplegada, diagrama." Y callarse. |

### 17.3 La frase que cierra el argumento

> "Los tres relojes pertenecen a tres organizaciones que no se ven entre sí. Ese hueco es el producto."

### 17.4 Respuestas preparadas

| Pregunta | Respuesta |
|---|---|
| "¿No rechazan por calidad, no por tiempo?" | Ambas. Calidad del donante y resultados de laboratorio pesan más en agregado, pero el código individual número uno es isquemia con 20.37 %, y con warm ischemia son 23 %. Ataco la parte que el sistema se autoinflige. |
| "Ofertar a cuarenta a la vez empeora la saturación." | Correcto, y por eso hay dos niveles: cuarenta carriles de evaluación barata, máximo cuatro en compromiso simultáneo. Es exactamente la intervención que le bajó el CIT 32 % a un OPO real. |
| "Nunca tendrás DonorNet ni el expediente." | El cliente es la OPO y esto corre al lado. Y CMS está pidiendo comentarios sobre exigir referrals electrónicos automatizados mientras OPTN pilotea APIs de pacientes ventilados. |
| "¿Un agente decidiendo quién recibe un órgano?" | No decide asignación. Persigue, verifica y documenta. El cirujano acepta; el médico del hospital declara la muerte. |
| "¿Detectar el trigger no es diagnóstico?" | No. Criterios explícitos y computables, cero pronóstico, y la idoneidad la determina el OPO. Es lo que el reglamento ya obliga al hospital a hacer. |
| "¿Cómo sé que no hiciste trampa en la comparación?" | Misma semilla, mismos perfiles de centro, y el simulador no sabe quién lo contacta. Hay un test que lo verifica y está en el repositorio. |

### 17.5 `[DECIDIR]` Vivo o grabado

Decidir tras la fase 10 según el resultado de las cinco corridas. En cualquier caso, **tener la grabación lista**.

---

## 18. Riesgos y planes B

| Riesgo | Probabilidad | Plan B |
|---|---|---|
| La red del recinto se cae | Alta | Todo corre local con el simulador; la URL desplegada es para el jurado, no para la demo |
| El proveedor de voz falla | Media | `K_VOZ = 0`, los carriles pasan a mensajería, la degradación se pinta en pantalla y se menciona como característica |
| El modelo se pone lento | Media | Caché por hash de entrada precalentado con la semilla de demo |
| El servo o la cámara mueren | Media | La caja es opcional y desacoplada; se omite sin comentarlo |
| Un juez conoce el dominio a fondo | Media | §17.4 y la tabla §3.1 con fuentes; admitir lo que no se sabe |
| Se acusa de simulación complaciente | Media | Misma semilla, test de ceguera del simulador, código público |
| `computer use` falla sobre el portal | Alta si se usa en vivo | **Nunca en el camino crítico.** Es plan B visible, con API-first como ruta principal |
| Se acaba el tiempo | Alta | El orden de fases está diseñado para que cortar por la fase 6 siga dando una demo completa |

---

## 19. Glosario

| Término | Significado |
|---|---|
| **AOOS** | *Allocation Out Of Sequence*. Colocación fuera del orden de la lista. HRSA la audita. |
| **CIT** | *Cold Ischemia Time*. Tiempo de isquemia frío desde el cross-clamp. |
| **Cross-clamp** | Momento quirúrgico en que se detiene la circulación al órgano. Inicia el CIT. |
| **DBD** | *Donation after Brain Death*. Donación tras muerte encefálica. |
| **DCD** | *Donation after Circulatory Death*. Donación tras muerte circulatoria. Ventana de 60–120 min. |
| **DGF** | *Delayed Graft Function*. Función retrasada del injerto. |
| **DonorNet** | Software operativo de OPTN donde se envían y responden ofertas. |
| **Discard / non-use** | El órgano nunca se transplanta. |
| **KDPI** | *Kidney Donor Profile Index*. Índice de calidad del riñón donante, 0 a 1. Más alto es peor. |
| **Match run** | Lista ordenada de candidatos generada por la política de asignación. |
| **No-touch** | Los 5 minutos obligatorios de observación tras el paro, en DCD. |
| **OPO** | *Organ Procurement Organization*. El cliente. |
| **OPTN** | *Organ Procurement and Transplantation Network*. El sistema nacional. |
| **PRA** | *Panel Reactive Antibody*. Grado de sensibilización inmunológica del candidato. |
| **Provisional yes** | Respuesta no vinculante de un centro. ~70 % terminan en rechazo. |
| **Refusal** | Rechazo de una oferta concreta. Distinto de discard. |
| **Número de secuencia** | Posición del candidato en el match run. Normal ≈ 9; AOOS mediana 812. |
| **WIT** | *Warm Ischemia Time*. Tiempo de isquemia caliente. |

---

## 20. Fuentes

Cada hecho de §3.1 está anclado aquí. Bajar la fuente primaria antes de poner cualquier cifra en una diapositiva: un juez las busca en su teléfono mientras hablas.

- OPTN Data Advisory Committee, reporte de códigos de rechazo: `https://www.hrsa.gov/sites/default/files/hrsa/optn/data_report_dataadvisorycommittee_20230508_rpt5.pdf`
- OPTN, actualización de refusal codes (mini-brief): `https://www.hrsa.gov/sites/default/files/hrsa/optn/update_to_refusal_codes_mini-brief.pdf`
- OPTN, redefinir el provisional yes: `https://www.hrsa.gov/optn/policies-bylaws/public-comment/redefining-provisional-yes-and-the-approach-to-organ-offer-and-acceptance`
- OPTN, modificar el límite de aceptación de ofertas: `https://www.hrsa.gov/optn/policies-bylaws/public-comment/modify-organ-offer-acceptance-limit`
- SRTR, Annual Data Report 2024, riñón: `https://srtr.hrsa.gov/adr/2024/Kidney/`
- SRTR, Annual Data Report 2024, panorama: `https://srtr.hrsa.gov/adr/2024/Overview/`
- Volumen de ofertas tras KAS250: `https://pmc.ncbi.nlm.nih.gov/articles/PMC10527286/`
- Colocación fuera de secuencia: `https://pmc.ncbi.nlm.nih.gov/articles/PMC11772121/`
- HRSA, Allocation Out of Sequence: `https://www.hrsa.gov/optn/policies-bylaws/policy-issues/allocation-out-of-sequence-aoos`
- Aubert et al., JAMA Internal Medicine 2019, descarte comparado con Francia: `https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2748452`
- Mohan et al. sobre biopsia de procuración: `https://www.cuimc.columbia.edu/node/2780`
- Debout et al., Kidney International, riesgo por hora de isquemia: `https://pubmed.ncbi.nlm.nih.gov/25229341/`
- Yamamoto et al. 2022, efecto de horario y fin de semana: `https://annalsoftransplantation.com/abstract/full/idArt/937825`
- Greenberg et al. 2023, aceptación de corazón por calendario: `https://pubmed.ncbi.nlm.nih.gov/36509608/`
- UNOS, investigación sobre ofertas: `https://unos.org/news/in-focus/organ-offers/`
- Organ Donation Alliance, caso de reducción de CIT: `https://www.organdonationalliance.org/case-study/improving-kidney-allocation-through-reducing-excess-offers-and-obtaining-final-responses-prior-to-recovery/`
- 42 CFR 482.45, obligación de notificación: `https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-482/subpart-C/section-482.45`
- Frontiers in Transplantation 2026, revisión de acuerdos hospital-OPO: `https://www.frontiersin.org/journals/transplantation/articles/10.3389/frtra.2026.1701648/full`
- Frontiers in Transplantation 2026, referrals perdidos en UCI: `https://www.frontiersin.org/journals/transplantation/articles/10.3389/frtra.2026.1924053/full`
- CMS-3409-P, regla propuesta sobre OPOs: `https://www.cms.gov/newsroom/fact-sheets/organ-procurement-organizations-opos-conditions-coverage-revisions-cms-3409-p-proposed-rule`
- HRSA, reforma del sistema de transplante, julio 2025: `https://www.hhs.gov/press-room/hrsa-to-reform-organ-transplant-system.html`
- KFF Health News, órganos perdidos en tránsito: `https://kffhealthnews.org/aging/how-lifesaving-organs-for-transplant-go-missing-in-transit/`
- OPTN, frecuencia de códigos de no-uso: `https://www.hrsa.gov/sites/default/files/hrsa/optn/20230911_dac_data-report-frequency-of-organ-non-use-codes-in-optn-data-rpt1.pdf`
- HRSA, huecos en logística de transporte de órganos: `https://www.hrsa.gov/sites/default/files/hrsa/optn/vendor-summary-organ-transplant-transportation-logistics.pdf`
- Corredor de drones de Mid-America Transplant: `https://dronelife.com/2026/04/02/mid-america-transplant-opens-160-mile-drone-corridor-for-organ-donation/`
- Estado de la regla BVLOS Part 108: `https://droneauthority.org/laws/part-108`

---

## Apéndice A · Lista de verificación previa al pitch

- [ ] Dos corridas con la misma semilla dan el mismo resultado
- [ ] El test de ceguera del simulador pasa
- [ ] M5, M6 y M9 en meta sobre las diez semillas
- [ ] La línea base serial corre visible junto al agente
- [ ] El expediente AOOS reporta cobertura de citación
- [ ] El dron aparece tachado con motivo escrito
- [ ] El reloj de isquemia no se detiene durante los tres minutos
- [ ] Repositorio público, URL desplegada y diagrama de arquitectura existen
- [ ] Grabación de respaldo lista
- [ ] Cinco de cinco ensayos sin fallo
- [ ] Todos los slots `[STACK]` resueltos y anotados en `DECISIONES.md`
- [ ] Todos los `[DECIDIR]` resueltos
- [ ] Ninguna cifra en la interfaz o el pitch fuera de la tabla §3.1

---

*Fin de la especificación.*
