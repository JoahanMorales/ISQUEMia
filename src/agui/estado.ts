/**
 * Proyección del estado del panel — ARQUITECTURA.md §2.1.
 *
 * El frontend no tiene estado de dominio propio: todo sale de aquí, igual que
 * el expediente sale del event store. Una sola fuente de verdad, dos lectores.
 */

import type { Corrida } from "../composicion";
import { camposFaltantes, etiquetaOrgano } from "../orquestacion/carril";
import { evaluarMetas } from "../orquestacion/metricas";
import type { OpcionTransporteExt } from "../orquestacion/ruta";

/** Re-exportado para que la capa `ui/` no dependa de `orquestacion/`. */
export type { OpcionTransporteExt };
import type { FaseCorrida } from "../orquestacion/corrida";
import type {
  CampoCompromiso,
  Cita,
  Escalamiento,
  EstadoCarril,
  EstadoCaso,
  Evento,
  ExpedienteAOOS,
  NueveMetricas,
  TipoCriterio,
} from "../domain/tipos";
import type { ItemWorkspace, SeleccionAdaptadores } from "../domain/puertos";

export interface CasillaCompromiso {
  campo: CampoCompromiso;
  etiqueta: string;
  llena: boolean;
  valor: string | null;
  literal: string | null;
}

export interface CarrilVista {
  id: string;
  secuencia: number;
  centroId: string;
  centroNombre: string;
  volumenAnual: number;
  modalidad: "voz" | "mensajeria" | "portal";
  estado: EstadoCarril;
  latencia_s: number | null;
  codigoRechazo: string | null;
  literalRechazo: string | null;
  casillas: CasillaCompromiso[];
  camposFaltantes: CampoCompromiso[];
  horasProtegidas: number | null;
  transcripcion: { hablante: string; texto: string; t_sim: number }[];
  citas: Cita[];
}

export interface EventoVista {
  id: string;
  t_sim: number;
  actor: string;
  tipo: string;
  resumen: string;
  payload: Record<string, unknown>;
}

export interface EstadoPanel {
  corridaId: string;
  semilla: string;
  fase: FaseCorrida;
  reloj: { t_sim: number; factor: number; congelado: boolean; corriendo: boolean };
  caso: {
    estado: EstadoCaso;
    donanteId: string;
    via: string;
    edad: number;
    grupoSanguineo: string;
    kdpi: number;
    hospitalId: string;
    pacienteId: string | null;
    criterios: { tipo: TipoCriterio; confianza: number; literal: string; referencia: string }[];
    ventanaMinutos: number;
    t_trigger: number | null;
    t_referral: number | null;
  };
  organo: {
    id: string;
    tipo: string;
    etiqueta: string;
    perfusion: string | null;
    citLimite_h: number;
    citTranscurrido_h: number;
    fraccion: number;
    umbralAlcanzado: number;
    estado: string;
  };
  carriles: CarrilVista[];
  resumen: {
    ofertasEmitidas: number;
    carrilesVivos: number;
    mejorSecuencia: number | null;
    citProyectadaMejor_h: number | null;
    degradaciones: number;
    provisionalYes: number;
    horasProtegidas: number;
    verificandoAhora: number;
    enColaDeCompromiso: number;
    maxConcurrentes: number;
  };
  baseline: {
    secuenciaActual: number;
    estado: string;
    ofertas: number;
    cit_h: number;
    secuenciaFinal: number | null;
    rechazosTardios: number;
  };
  transporte: OpcionTransporteExt[] | null;
  expediente: ExpedienteAOOS | null;
  metricas: (NueveMetricas & { evaluacion: ReturnType<typeof evaluarMetas> }) | null;
  centinela: {
    sensibilidad: number;
    tasaFalsosPositivos: number;
    escalamientosCorrectos: number;
    limitrofesTotales: number;
    citasValidas: number;
    criteriosReportados: number;
  } | null;
  escalamientos: Escalamiento[];
  workspace: ItemWorkspace[];
  adaptadores: SeleccionAdaptadores[];
  eventos: EventoVista[];
  spans: { total: number; costoUSD: number; p50_ms: number; p95_ms: number; validados: number; conEsquema: number };
}

const ETIQUETA_CAMPO: Record<CampoCompromiso, string> = {
  cirujanoNombrado: "Surgeon named",
  quirofanoReservado: "OR held",
  receptorConfirmadoDisponible: "Recipient available",
  etaEquipoRecuperacion: "Recovery team ETA",
};

const CAMPOS: CampoCompromiso[] = [
  "cirujanoNombrado",
  "quirofanoReservado",
  "receptorConfirmadoDisponible",
  "etaEquipoRecuperacion",
];

function valorDeCampo(comp: NonNullable<CarrilVista["casillas"]> extends never ? never : any, campo: CampoCompromiso): string | null {
  if (!comp) return null;
  switch (campo) {
    case "cirujanoNombrado":
      return comp.cirujanoNombrado;
    case "quirofanoReservado":
      return comp.quirofanoReservado ? `${comp.quirofanoReservado.sala}` : null;
    case "receptorConfirmadoDisponible":
      return comp.receptorConfirmadoDisponible === null ? null : String(comp.receptorConfirmadoDisponible);
    case "etaEquipoRecuperacion":
      return comp.etaEquipoRecuperacion === null ? null : new Date(comp.etaEquipoRecuperacion).toISOString().slice(11, 16); // lint-reloj: permitido — formato de un instante sim, no lectura de reloj
  }
}

const RESUMEN: Record<string, (p: Record<string, unknown>) => string> = {
  CARRIL_ABIERTO: (p) => `lane ${p.carrilId} opened · ${p.centroNombre} · #${p.secuencia} · ${p.modalidad}`,
  CARRIL_OFERTA_ENVIADA: (p) => `offer sent to ${p.centroId}`,
  CARRIL_RESPUESTA_RECIBIDA: (p) => `${p.centroId} responded: ${p.decision}`,
  CARRIL_ESTADO: (p) => `lane ${p.carrilId} ${p.anterior} → ${p.estado}`,
  CARRIL_VERIFICACION_INICIADA: (p) => `verifying commitment with ${p.centroId}`,
  CARRIL_CAMPO_COMPROMISO: (p) => `${p.centroId} confirmed ${p.campo}`,
  CARRIL_COMPROMETIDO: (p) => `COMMITTED at #${p.secuencia} · ${p.centroId}`,
  CARRIL_DEGRADADO: (p) => `downgraded ${p.centroNombre} — missing ${(p.camposFaltantes as string[]).join(", ")} · ${p.horasIsquemiaProtegidas} h protected`,
  CARRIL_RECHAZADO: (p) => `#${p.secuencia} declined · ${p.codigo}`,
  CARRIL_TIMEOUT: (p) => `lane ${p.carrilId} timed out in ${p.estadoAlExpirar}`,
  CARRIL_ABORTADO: (p) => `lane ${p.carrilId} aborted — ${p.motivo}`,
  ALERTA_CIT: (p) => `cold ischemia at ${Number(p.umbral) * 100}% of limit (${Number(p.cit_h).toFixed(1)} h)`,
  CRITERIO_DETECTADO: (p) => `criterion ${p.tipo} (confidence ${p.confianza})`,
  REFERRAL_EMITIDO: (p) => `referral issued · ${p.urgencia} · ${p.ventanaMinutos} min window`,
  ESCALAMIENTO_SOLICITADO: (p) => `escalated to human — ${p.motivo}`,
  CAMPANA_ABIERTA: (p) => `campaign opened · ${p.nCarriles} lanes · max ${p.maxConcurrentesCompromiso} verifying`,
  CAMPANA_CERRADA: (p) => `campaign closed — ${p.motivo}`,
  CROSS_CLAMP: () => `cross clamp — cold ischemia clock started`,
  VENTANA_DCD_EXPIRADA: (p) => `DCD window expired — ${p.motivo}`,
  BASELINE_CARRIL_CERRADO: (p) => `baseline #${p.secuencia}: ${p.resultado}`,
  PLAN_TRANSPORTE_LISTO: (p) => `transport plan ready — best: ${p.mejor}`,
  EXPEDIENTE_LISTO: (p) => `AOOS file ready — coverage ${(Number(p.cobertura) * 100).toFixed(0)}%`,
  ADAPTADOR_SELECCIONADO: (p) => `${p.slot} → ${p.implementacion}${p.remoto ? " (remote)" : ""}`,
  DEGRADACION_PROVEEDOR: (p) => `provider degraded: ${p.slot} — ${p.motivo}`,
  WORKSPACE_ESCRITO: (p) => `workspace ${p.app}: ${p.titulo}`,
};

export function resumirEvento(e: Evento): string {
  const f = RESUMEN[e.tipo];
  return f ? f(e.payload as Record<string, unknown>) : e.tipo.toLowerCase().replace(/_/g, " ");
}

export function proyectar(c: Corrida, limiteEventos = 300): EstadoPanel {
  const iso = c.isquemia;
  const eventos = c.almacen.todos();
  const spans = c.obs.spans();
  const latencias = spans.filter((s) => s.nombre === "carril").map((s) => s.latencia_ms).sort((a, b) => a - b);
  const pct = (p: number) => (latencias.length ? Number(latencias[Math.min(latencias.length - 1, Math.ceil((p / 100) * latencias.length) - 1)]!.toFixed(1)) : 0);
  const conEsquema = spans.filter((s) => s.validacionEsquema !== undefined);

  const carriles: CarrilVista[] = iso.carriles.map((carril) => {
    const centro = c.mundo.centro(carril.entradaMatchRun.centroId);
    const comp = carril.compromiso;
    return {
      id: carril.id,
      secuencia: carril.entradaMatchRun.secuencia,
      centroId: centro.id,
      centroNombre: centro.nombre,
      volumenAnual: centro.volumenAnual,
      modalidad: carril.modalidad,
      estado: carril.estado,
      latencia_s: carril.t_primeraRespuesta !== null ? (carril.t_primeraRespuesta - carril.t_abierto) / 1000 : null,
      codigoRechazo: carril.codigoRechazo,
      literalRechazo: carril.respuestaCruda,
      casillas: CAMPOS.map((campo) => ({
        campo,
        etiqueta: ETIQUETA_CAMPO[campo],
        llena: Boolean(comp?.citas[campo]),
        valor: valorDeCampo(comp, campo),
        literal: comp?.citas[campo]?.literal ?? null,
      })),
      camposFaltantes: comp ? camposFaltantes(comp) : [],
      horasProtegidas: carril.estado === "DEGRADADO" ? c.politica.HORAS_SALVADAS_POR_DEGRADACION : null,
      transcripcion: carril.transcripcion.map((t) => ({ hablante: t.hablante, texto: t.texto, t_sim: t.t_sim })),
      citas: carril.citas,
    };
  });

  const comprometidos = carriles.filter((x) => x.estado === "COMPROMETIDO" || x.estado === "ACEPTADO_DIRECTO");
  const mejor = comprometidos.length ? Math.min(...comprometidos.map((x) => x.secuencia)) : null;
  const b = iso.estadoBaseline;

  return {
    corridaId: c.corridaId,
    semilla: c.semilla,
    fase: iso.fase,
    reloj: {
      t_sim: c.reloj.now(),
      factor: c.reloj.factor,
      congelado: c.reloj.congelado,
      corriendo: iso.fase !== "inactiva" && iso.fase !== "terminada",
    },
    caso: {
      estado: iso.estadoCaso,
      donanteId: c.mundo.donante.id,
      via: c.mundo.donante.via,
      edad: c.mundo.donante.edad,
      grupoSanguineo: c.mundo.donante.grupoSanguineo,
      kdpi: c.mundo.donante.kdpi,
      hospitalId: c.mundo.donante.hospitalId,
      pacienteId: iso.pacienteProtagonista?.id ?? null,
      criterios: iso.criterios.map((x) => ({
        tipo: x.tipo,
        confianza: x.confianza,
        literal: x.cita.literal,
        referencia: x.cita.referencia,
      })),
      ventanaMinutos: 60,
      t_trigger: c.mundo.donante.t_trigger,
      t_referral: c.mundo.donante.t_referral,
    },
    organo: {
      id: c.mundo.organo.id,
      tipo: c.mundo.organo.tipo,
      etiqueta: etiquetaOrgano(c.mundo.organo.tipo),
      perfusion: c.mundo.organo.perfusion,
      citLimite_h: c.mundo.citLimite_h(),
      citTranscurrido_h: iso.cit_h(),
      fraccion: iso.citFraccion(),
      umbralAlcanzado: iso.umbralCitAlcanzado,
      estado: c.mundo.organo.estado,
    },
    carriles,
    resumen: {
      ofertasEmitidas: carriles.filter((x) => x.estado !== "ABIERTO").length,
      carrilesVivos: carriles.filter((x) => !["RECHAZADO", "COMPROMETIDO", "DEGRADADO", "ACEPTADO_DIRECTO", "TIMEOUT", "ABORTADO"].includes(x.estado)).length,
      mejorSecuencia: mejor,
      citProyectadaMejor_h: iso.resultadoCampana?.citFinal_h ?? null,
      degradaciones: carriles.filter((x) => x.estado === "DEGRADADO").length,
      provisionalYes: iso.resultadoCampana?.provisionalYesTotales ?? 0,
      horasProtegidas: carriles.filter((x) => x.estado === "DEGRADADO").length * c.politica.HORAS_SALVADAS_POR_DEGRADACION,
      verificandoAhora: carriles.filter((x) => x.estado === "VERIFICANDO").length,
      enColaDeCompromiso: c.motor.enColaDeCompromiso,
      maxConcurrentes: c.politica.MAX_CONCURRENTES_POLITICA,
    },
    baseline: {
      secuenciaActual: b.secuenciaActual,
      estado: b.estado,
      ofertas: b.ofertas,
      cit_h: b.cit_h,
      secuenciaFinal: iso.resultadoBaseline?.secuenciaFinal ?? null,
      rechazosTardios: iso.resultadoBaseline?.rechazosTardios ?? 0,
    },
    transporte: iso.transporte,
    expediente: iso.expediente,
    metricas: iso.metricas ? { ...iso.metricas, evaluacion: evaluarMetas(iso.metricas) } : null,
    centinela: iso.desempenoCentinela
      ? {
          sensibilidad: iso.desempenoCentinela.sensibilidad,
          tasaFalsosPositivos: iso.desempenoCentinela.tasaFalsosPositivos,
          escalamientosCorrectos: iso.desempenoCentinela.escalamientosCorrectos,
          limitrofesTotales: iso.desempenoCentinela.limitrofesTotales,
          citasValidas: iso.desempenoCentinela.citasValidas,
          criteriosReportados: iso.desempenoCentinela.criteriosReportados,
        }
      : null,
    escalamientos: iso.escalamientos,
    workspace: c.workspace.items(),
    adaptadores: c.adaptadores,
    eventos: eventos.slice(-limiteEventos).map((e) => ({
      id: e.id,
      t_sim: e.t_sim,
      actor: e.actor,
      tipo: e.tipo,
      resumen: resumirEvento(e),
      payload: e.payload as Record<string, unknown>,
    })),
    spans: {
      total: spans.length,
      costoUSD: Number(spans.reduce((s, x) => s + (x.costoUSD ?? 0), 0).toFixed(5)),
      p50_ms: pct(50),
      p95_ms: pct(95),
      validados: conEsquema.filter((s) => s.validacionEsquema).length,
      conEsquema: conEsquema.length,
    },
  };
}
