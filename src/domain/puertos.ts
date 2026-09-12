/**
 * Puertos — una interfaz por slot `[STACK]` de §5.4.
 * Requisito duro: ningún archivo de dominio importa un SDK de proveedor.
 * Las implementaciones viven en `adapters/`.
 */

import type {
  Actor,
  Carril,
  Cita,
  Evento,
  EventoNuevo,
  ExpedienteAOOS,
  Timestamp,
} from "./tipos";

// ---------------------------------------------------------------- reloj

/** §11.2 — contrato del reloj. */
export interface Reloj {
  /** Tiempo de simulación en ms. */
  now(): Timestamp;
  /** Avanza el reloj N segundos sim, disparando lo agendado en orden. */
  advance(segundos: number): void;
  /** Agenda un callback; devuelve una función para cancelarlo. */
  schedule(enSegundos: number, callback: () => void): () => void;
  /** Factor de aceleración para el modo tiempo real (demo: 60×–300×). */
  readonly factor: number;
  freeze(): void;
  resume(): void;
  readonly congelado: boolean;
}

// -------------------------------------------------------------- almacén

/**
 * Slot `ALMACEN` — append-only, lectura por rango, replay.
 *
 * Es **síncrono a propósito**: los agentes escriben desde callbacks agendados
 * en el reloj de simulación, y una promesa ahí dentro reordenaría los eventos
 * entre corridas, rompiendo el determinismo por semilla (§0.4.7). Un adaptador
 * persistente (Postgres) escribe detrás con `flush()`, sin bloquear el dominio.
 */
export interface AlmacenEventos {
  append(evento: EventoNuevo): Evento;
  /** Rango sobre `t_sim`, ambos inclusivos; `undefined` = sin límite. */
  read(desde?: Timestamp, hasta?: Timestamp): Evento[];
  /** Todos los eventos de la corrida, en orden de escritura. */
  todos(): Evento[];
  /** Vacía el buffer hacia el almacenamiento durable, si lo hay. */
  flush(): Promise<void>;
  readonly corridaId: string;
  readonly semilla: string;
}

// ------------------------------------------------------------------ bus

/** Slot `UI_TRANSPORTE` — transporte de eventos agente→interfaz. */
export interface BusEventos {
  emit(evento: Evento): void;
  subscribe(handler: (evento: Evento) => void): () => void;
}

// ------------------------------------------------------------------ LLM

export interface Mensaje {
  rol: "system" | "user" | "assistant" | "tool";
  contenido: string;
  toolCallId?: string;
}

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  esquema: Record<string, unknown>; // JSON Schema
}

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
}

export interface UsoTokens {
  entrada: number;
  salida: number;
  costoUSD: number;
}

export interface RespuestaLlm {
  content: string;
  toolCalls: LlamadaHerramienta[];
  usage: UsoTokens;
}

/** Slots `LLM_NEGOCIACION` y `LLM_TRIAGE`. */
export interface Llm {
  complete(
    messages: Mensaje[],
    tools?: DefinicionHerramienta[],
    schema?: Record<string, unknown>,
  ): Promise<RespuestaLlm>;
  /**
   * Ruta síncrona para el bucle de simulación.
   *
   * Los agentes escriben desde callbacks agendados en el reloj; una promesa
   * ahí dentro reordenaría los eventos y rompería el determinismo por semilla.
   * El adaptador local responde siempre; el remoto responde desde el caché por
   * hash de entrada (§5.2 principio 4) y devuelve `null` en fallo de caché,
   * lo que obliga al llamante a degradar de forma visible (G9, §5.2.5).
   */
  completeSync(
    messages: Mensaje[],
    tools?: DefinicionHerramienta[],
    schema?: Record<string, unknown>,
  ): RespuestaLlm | null;
  readonly modelo: string;
}

export type TipoTarea = "negociacion" | "triage" | "redaccion" | "ruta";

/** Slot `LLM_ROUTER`. */
export interface RouterModelos {
  route(taskKind: TipoTarea): string;
  para(taskKind: TipoTarea): Llm;
}

// ------------------------------------------------------------------ voz

export interface SesionVoz {
  send(texto: string): void;
  onTranscript(handler: (texto: string, hablante: "agente" | "centro") => void): void;
  close(): Promise<void>;
}

/** Slot `VOZ`. */
export interface Voz {
  openVoiceSession(config: { carrilId: string; centroId: string }): Promise<SesionVoz>;
  readonly disponible: boolean;
}

/** Slot `TELEFONIA`. */
export interface Telefonia {
  dial(numero: string, handler: (sesion: SesionVoz) => void): Promise<string>;
}

// -------------------------------------------------------------- runtime

export interface Manija<T> {
  readonly id: string;
  promesa: Promise<T>;
  cancelar(): void;
}

/** Slot `RUNTIME` — ejecución concurrente de N tareas de larga duración. */
export interface Runtime {
  spawn<T>(id: string, tarea: (señal: AbortSignal) => Promise<T>): Manija<T>;
}

// -------------------------------------------------------- observabilidad

export interface MetaSpan {
  actor: Actor;
  tokensEntrada?: number;
  tokensSalida?: number;
  costoUSD?: number;
  resultado?: "ok" | "error" | "timeout";
  validacionEsquema?: boolean;
  [k: string]: unknown;
}

export interface Span {
  fin(meta?: Partial<MetaSpan>): void;
}

/** Slot `OBSERVABILIDAD` — §14.1. */
export interface Observabilidad {
  span(nombre: string, meta: MetaSpan): Span;
  spans(): SpanRegistrado[];
}

export interface SpanRegistrado extends MetaSpan {
  nombre: string;
  latencia_ms: number;
  t_sim: Timestamp;
  corridaId: string;
  semilla: string;
}

// ----------------------------------------------------------------- cola

/** Slot `COLA`. */
export interface Cola<T> {
  push(job: T): void;
  consume(): Promise<T | null>;
  readonly pendientes: number;
}

// -------------------------------------------------------------- búsqueda

/** Slot `BUSQUEDA` — solo para el router de transporte. */
export interface Busqueda {
  search(query: string): Promise<{ titulo: string; url: string; extracto: string }[]>;
}

// ----------------------------------------------------------- motor de carriles

/**
 * Slot `RUNTIME` a nivel de dominio: los dos niveles de concurrencia de §7.4.
 * `MotorLocal` usa un semáforo; el adaptador de Trigger.dev usa
 * `concurrencyLimit`. La política es la misma en ambos.
 */
export interface MotorCarriles {
  /**
   * Nivel 1 — evaluación. Hasta `N_CARRILES` carriles baratos a la vez.
   * `arrancar` corre en tiempo de simulación, no en tiempo de pared: así la
   * corrida es reproducible y el reloj de la demo es el único motor.
   */
  abrirEvaluacion(carrilId: string, arrancar: () => void): void;
  /**
   * Nivel 2 — compromiso. Como máximo `MAX_CONCURRENTES_POLITICA` carriles en
   * `VERIFICANDO` simultáneamente (H16). La cola se atiende por orden de
   * secuencia del match run, nunca por orden de llegada: G4.
   */
  solicitarSlotCompromiso(carrilId: string, secuencia: number, alObtener: () => void): void;
  /** Devuelve el slot y admite al siguiente de la cola. Idempotente. */
  liberarSlotCompromiso(carrilId: string): void;
  /** Saca de la cola a un carril que ya no lo necesita (abortado, timeout). */
  cancelar(carrilId: string): void;
  cancelarTodo(): void;
  readonly evaluacionesVivas: number;
  readonly compromisosVivos: number;
  readonly enColaDeCompromiso: number;
  readonly nombre: string;
}

// -------------------------------------------------------------- workspace

export type AppWorkspace = "docs" | "tasks" | "chat" | "crm" | "mail" | "sheets" | "drive";

export interface ItemWorkspace {
  id: string;
  app: AppWorkspace;
  titulo: string;
  cuerpo: string;
  /** Enlace al recurso real cuando el adaptador es remoto. */
  url: string | null;
  t_sim: Timestamp;
  autor: Actor;
  meta: Record<string, unknown>;
}

/** Slot `WORKSPACE` — Ambiguous AI, o su espejo local. */
export interface Workspace {
  publicarExpediente(expediente: ExpedienteAOOS, autor: Actor): Promise<ItemWorkspace>;
  crearTarea(entrada: {
    titulo: string;
    cuerpo: string;
    asignadoA: string;
    prioridad: "baja" | "media" | "alta" | "critica";
    autor: Actor;
  }): Promise<ItemWorkspace>;
  publicarEnCanal(entrada: { canal: string; texto: string; autor: Actor; citas?: Cita[] }): Promise<ItemWorkspace>;
  registrarActividadCrm(entrada: {
    centroId: string;
    centroNombre: string;
    resumen: string;
    carril: Pick<Carril, "id" | "estado" | "codigoRechazo">;
    autor: Actor;
  }): Promise<ItemWorkspace>;
  enviarCorreo(entrada: { para: string; asunto: string; cuerpo: string; autor: Actor }): Promise<ItemWorkspace>;
  escribirHoja(entrada: { hoja: string; filas: Record<string, unknown>[]; autor: Actor }): Promise<ItemWorkspace>;
  subirArchivo(entrada: { nombre: string; contenido: string; autor: Actor }): Promise<ItemWorkspace>;
  /** Todo lo escrito en esta corrida, para pintar el panel espejo. */
  items(): ItemWorkspace[];
  readonly nombre: string;
  readonly remoto: boolean;
}

// -------------------------------------------------------------- identidad

export interface IdentidadAgente {
  /** `sub` estable por agente; se estampa en cada evento para la auditoría. */
  sub(actor: Actor): string;
  /** Token de servicio del agente, si el proveedor lo emite. */
  token(actor: Actor): Promise<string | null>;
  readonly nombre: string;
  readonly remoto: boolean;
}

// ----------------------------------------------------------------- caja

/** §13 — la caja es un consumidor del bus y un productor de eventos de custodia. */
export interface CajaCustodia {
  conectar(): void;
  desconectar(): void;
  cortarRed(): void;
  restaurarRed(): void;
  readonly conectada: boolean;
  readonly sinRed: boolean;
  readonly eventosEncolados: number;
}

// ------------------------------------------------------ contenedor de puertos

export interface Puertos {
  reloj: Reloj;
  almacen: AlmacenEventos;
  bus: BusEventos;
  modelos: RouterModelos;
  voz: Voz;
  runtime: Runtime;
  motor: MotorCarriles;
  obs: Observabilidad;
  workspace: Workspace;
  identidad: IdentidadAgente;
  busqueda: Busqueda;
}

/** Qué slots corren local y cuáles remotos — se pinta como insignias en el panel. */
export interface SeleccionAdaptadores {
  slot: string;
  implementacion: string;
  remoto: boolean;
  motivo: string;
}
