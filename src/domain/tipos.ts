/**
 * Tipos de dominio — §6 de ISQUEMIA.md.
 * Puro: sin SDKs de proveedor, sin hora del sistema.
 *
 * Convención de tiempo: todo `timestamp` es milisegundos de tiempo de
 * simulación (`sim.now()`), nunca hora de pared. La hora de pared solo
 * aparece en `Evento.t_wall`, que la estampa el almacén (adapters/).
 */

export type Timestamp = number;

// ---------------------------------------------------------------- donante

export type Via = "DBD" | "DCD";
export type GrupoSanguineo = "O" | "A" | "B" | "AB";
export type CausaMuerte = "trauma" | "stroke" | "anoxia" | "otro";

export interface Serologias {
  hcv: boolean;
  hbv: boolean;
  hiv: boolean;
  cmv: boolean;
}

export interface Donante {
  id: string;
  via: Via;
  edad: number;
  grupoSanguineo: GrupoSanguineo;
  peso_kg: number;
  altura_cm: number;
  causaMuerte: CausaMuerte;
  kdpi: number; // 0..1, solo riñón
  creatinina: number;
  serologias: Serologias;
  biopsiaRealizada: boolean;
  biopsiaHallazgos: string | null;
  hospitalId: string;
  t_trigger: Timestamp | null;
  t_referral: Timestamp | null;
  t_autorizacion: Timestamp | null;
  t_retiroSoporte: Timestamp | null; // solo DCD
  t_paro: Timestamp | null; // solo DCD
  t_crossClamp: Timestamp | null;
  ventanaDCD_min: number | null; // 60..120
}

// ----------------------------------------------------------------- órgano

export type TipoOrgano =
  | "rinon_izq"
  | "rinon_der"
  | "higado"
  | "corazon"
  | "pulmon_izq"
  | "pulmon_der"
  | "pancreas";

export type Perfusion = "estatico" | "hipotermica" | "normotermica";

/** §7.2 */
export type EstadoOrgano =
  | "NO_RECUPERADO"
  | "EN_ISQUEMIA_FRIO"
  | "ACEPTADO_FIRME"
  | "EN_TRANSITO"
  | "IMPLANTADO"
  | "DESCARTADO";

export interface Organo {
  id: string;
  donanteId: string;
  tipo: TipoOrgano;
  citLimite_h: number; // tabla §2.5
  perfusion: Perfusion | null;
  t_crossClamp: Timestamp | null;
  estado: EstadoOrgano;
  descartado: boolean;
  motivoDescarte: CodigoRechazo | null;
}

// ------------------------------------------------------- centro/candidato

export interface Centro {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
  volumenAnual: number;
  perfil: PerfilCentro; // §11.3
}

export interface LogNormalParams {
  mu: number;
  sigma: number;
}

/** §11.3 — cada campo anclado a un hecho de §3.1. */
export interface PerfilCentro {
  kdpiMaximo: number;
  aceptaDCD: boolean;
  citMaximaTolerada_h: number;
  requiereBiopsia: boolean;

  latenciaRespuesta_s: LogNormalParams;
  multiplicadorNocturno: number; // H37
  multiplicadorFinDeSemana: number; // H38

  pProvisionalYes: number;
  pDeclineDadoProvisional: number; // H05
  pCompromisoCompletoDadoProvisional: number;

  pCambioDeDecision: number; // H15

  distribucionRechazo: Partial<Record<CodigoRechazo, number>>;
}

export interface Candidato {
  id: string;
  centroId: string;
  grupoSanguineo: GrupoSanguineo;
  pra: number; // 0..1
  urgencia: number;
  tiempoEnLista_dias: number;
  aceptaDCD: boolean;
  kdpiMaximoAceptado: number;
  disponibleAhora: boolean;
}

export interface EntradaMatchRun {
  secuencia: number; // 1 = primero de la lista
  candidatoId: string;
  centroId: string;
}

// ------------------------------------------------------------------ carril

export type Modalidad = "voz" | "mensajeria" | "portal";

/** §7.3 */
export type EstadoCarril =
  | "ABIERTO"
  | "CONTACTANDO"
  | "ESPERANDO_RESPUESTA"
  | "PROVISIONAL"
  | "VERIFICANDO"
  | "RECHAZADO"
  | "COMPROMETIDO"
  | "DEGRADADO"
  | "ACEPTADO_DIRECTO"
  | "TIMEOUT"
  | "ABORTADO";

export const ESTADOS_TERMINALES: readonly EstadoCarril[] = [
  "RECHAZADO",
  "COMPROMETIDO",
  "DEGRADADO",
  "ACEPTADO_DIRECTO",
  "TIMEOUT",
  "ABORTADO",
];

/** Estados terminales que cuentan como completitud legítima (M5, §14.3). */
export const TERMINALES_LEGITIMOS: readonly EstadoCarril[] = [
  "RECHAZADO",
  "COMPROMETIDO",
  "DEGRADADO",
  "ACEPTADO_DIRECTO",
  "ABORTADO",
];

export interface Turno {
  t_sim: Timestamp;
  hablante: "agente" | "centro";
  texto: string;
}

/**
 * §8.6 — trazabilidad de afirmaciones. Forma canónica: toda salida de cualquier
 * agente que contenga una afirmación fáctica lleva `Cita[]`. M9 se calcula sobre
 * esto y es el sustituto medible de "no alucina".
 */
export type OrigenCita =
  | "registro_donante"
  | "respuesta_centro"
  | "politica"
  | "dato_externo";

export interface Cita {
  /** La afirmación fáctica que se está respaldando. */
  afirmacion: string;
  origen: OrigenCita;
  /** Id de evento, campo del donante, o URL. */
  referencia: string;
  /** El texto exacto de la fuente. */
  literal: string;
}

/** Los cuatro campos cuya presencia decide `completo` (§6.6). */
export const CAMPOS_COMPROMISO = [
  "cirujanoNombrado",
  "quirofanoReservado",
  "receptorConfirmadoDisponible",
  "etaEquipoRecuperacion",
] as const;

export type CampoCompromiso = (typeof CAMPOS_COMPROMISO)[number];

/** §6.6 — el objeto que distingue el producto. */
export interface CompromisoVerificado {
  cirujanoNombrado: string | null;
  quirofanoReservado: { sala: string; hora: Timestamp } | null;
  receptorConfirmadoDisponible: boolean | null;
  etaEquipoRecuperacion: Timestamp | null;
  citTotalProyectada_h: number | null;
  completo: boolean;
  t_verificado: Timestamp | null;
  /** G6: ningún campo se acepta sin su cita con origen=respuesta_centro. */
  citas: Partial<Record<CampoCompromiso, Cita>>;
}

export interface Carril {
  id: string;
  organoId: string;
  entradaMatchRun: EntradaMatchRun;
  modalidad: Modalidad;
  estado: EstadoCarril;
  t_abierto: Timestamp;
  t_primeraRespuesta: Timestamp | null;
  t_cerrado: Timestamp | null;
  respuestaCruda: string | null;
  codigoRechazo: CodigoRechazo | null;
  compromiso: CompromisoVerificado | null;
  intentos: number;
  transcripcion: Turno[];
  citas: Cita[];
}

// --------------------------------------------------------------- transporte

export type ModalidadTransporte =
  | "terrestre"
  | "comercial"
  | "helicoptero"
  | "jet"
  | "dron";

export interface Tramo {
  modalidad: ModalidadTransporte;
  desde: string;
  hasta: string;
  duracion_min: number;
  costoUSD: number;
}

export interface OpcionTransporte {
  modalidad: ModalidadTransporte;
  tramos: Tramo[];
  duracionTotal_min: number;
  citProyectada_h: number;
  costoUSD: number;
  riesgoClima: number; // 0..1
  riesgoConexion: number; // 0..1
  viable: boolean;
  motivoNoViable: string | null;
  puntaje: number; // §8.4
}

// ------------------------------------------------------------------ evento

export type Actor =
  | "centinela"
  | "despachador"
  | `carril:${string}`
  | "ruta"
  | "escribano"
  | "simulador"
  | "humano";

export interface Evento<P = Record<string, unknown>> {
  id: string;
  t_wall: Timestamp; // hora real — la estampa el almacén (adapters/)
  t_sim: Timestamp;
  actor: Actor;
  tipo: string;
  payload: P;
  semilla: string;
  corridaId: string;
}

/** Lo que emite el dominio; el almacén completa `id`, `t_wall`, `semilla`, `corridaId`. */
export interface EventoNuevo<P = Record<string, unknown>> {
  t_sim: Timestamp;
  actor: Actor;
  tipo: string;
  payload: P;
}

// -------------------------------------------------------- caso de donación

/** §7.1 */
export type EstadoCaso =
  | "DETECTADO"
  | "REFERIDO"
  | "EVALUANDO"
  | "AUTORIZADO"
  | "ASIGNANDO"
  | "RECUPERADO"
  | "EN_TRANSITO"
  | "IMPLANTADO"
  | "DESCARTADO_PRE"
  | "SOPORTE_RETIRADO"
  | "NO_TOUCH_5MIN"
  | "VENTANA_EXPIRADA"
  | "SIN_DONACION";

// -------------------------------------------------------------- centinela

/** §2.6 — criterios de disparo clínico explícitos. El Centinela detecta, no pronostica (G3). */
export type TipoCriterio =
  | "GCS_MENOR_IGUAL_5"
  | "PERDIDA_REFLEJOS_TRONCO"
  | "VENTILACION_CON_LESION_NEURO"
  | "PLAN_RETIRO_SOPORTE"
  | "FAMILIA_PREGUNTA_DONACION";

export interface CriterioDetectado {
  tipo: TipoCriterio;
  confianza: number; // G7: < 0.8 obliga a escalarAHumano
  cita: Cita;
  t_sim: Timestamp;
}

export interface Escalamiento {
  id: string;
  motivo: string;
  actor: Actor;
  t_sim: Timestamp;
  contexto: Record<string, unknown>;
  estado: "pendiente" | "resuelto" | "rechazado";
  resolucion: string | null;
}

// ------------------------------------------------------------- expediente

/** §8.5 — estructura obligatoria del expediente AOOS. */
export interface ExpedienteAOOS {
  organoId: string;
  donanteResumen: string;
  secuenciaFinal: number;
  totalOfertas: number;
  rechazos: {
    secuencia: number;
    centroId: string;
    codigo: CodigoRechazo;
    t_sim: Timestamp;
    citaLiteral: string;
  }[];
  degradaciones: {
    centroId: string;
    camposFaltantes: CampoCompromiso[];
    t_sim: Timestamp;
    horasProtegidas: number;
  }[];
  /** Prosa; cada oración enlaza al menos a un `Evento.id`. */
  justificacion: OracionJustificada[];
  citLinea: { t_sim: Timestamp; citHoras: number; evento: string }[];
  /** Proporción de oraciones con respaldo. Si < 1.0 el expediente se marca incompleto. */
  cobertura: number;
  firmaHash: string;
}

export interface OracionJustificada {
  texto: string;
  eventos: string[]; // Evento.id
  citas: Cita[];
}

// -------------------------------------------------------------- métricas

/** §14.3 — las nueve cifras. */
export interface NueveMetricas {
  M1_horasIsquemiaAhorradas: number;
  M2_tiempoPrimerCompromiso_s: number | null;
  M2_fraccionDelBaseline: number | null;
  M3_provisionalYesInterceptados: number;
  M3_provisionalYesTotales: number;
  M3_tasa: number;
  M4_ofertasPorColocacion: number;
  M4_ofertasBaseline: number;
  M5_tasaCompletitudCarril: number;
  M6_precisionUsoHerramientas: number;
  M7_latenciaCarril_p50_ms: number;
  M7_latenciaCarril_p95_ms: number;
  M8_costoPorColocacionUSD: number;
  M9_tasaCitacion: number;
}

export type { CodigoRechazo } from "./codigos-rechazo";
import type { CodigoRechazo } from "./codigos-rechazo";
