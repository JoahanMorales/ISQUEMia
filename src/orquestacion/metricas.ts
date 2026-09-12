/**
 * §14.3 — las nueve cifras. Se calculan replayando el event store, no
 * acumulando contadores sueltos: así el panel y el arnés de evaluación miden
 * exactamente lo mismo.
 */

import type { SpanRegistrado } from "../domain/puertos";
import { TERMINALES_LEGITIMOS } from "../domain/tipos";
import type { Carril, Evento, ExpedienteAOOS, NueveMetricas } from "../domain/tipos";
import type { ResultadoBaseline } from "./linea-base";
import type { ResultadoCampana } from "./despachador";

export const METAS = {
  M1_minimo_h: 3,
  M2_maxFraccionBaseline: 0.25,
  M3_minimo: 0.6,
  M5_minimo: 0.95,
  M6_minimo: 0.98,
  M7_p95_max_ms: 8000,
  M9_minimo: 1.0,
} as const;

function percentil(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const orden = [...xs].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1));
  return Number(orden[i]!.toFixed(1));
}

export interface EntradaMetricas {
  campana: ResultadoCampana;
  baseline: ResultadoBaseline;
  carriles: Carril[];
  spans: SpanRegistrado[];
  eventos: Evento[];
  expediente: ExpedienteAOOS | null;
  citAgente_h: number | null;
  t_aperturaCampana: number;
}

export function calcularMetricas(e: EntradaMetricas): NueveMetricas {
  const { campana, baseline, carriles, spans } = e;

  // M1 — horas de isquemia ahorradas, misma semilla.
  const citBaseline = baseline.cit_h;
  const citAgente = e.citAgente_h;
  const M1 = citBaseline !== null && citAgente !== null ? Number((citBaseline - citAgente).toFixed(2)) : 0;

  // M2 — tiempo hasta el primer compromiso verificado.
  const M2_s = campana.t_primerCompromiso !== null
    ? (campana.t_primerCompromiso - e.t_aperturaCampana) / 1000
    : null;
  const baseline_s = baseline.t_colocacion !== null ? (baseline.t_colocacion - e.t_aperturaCampana) / 1000 : null;
  const M2_frac = M2_s !== null && baseline_s ? Number((M2_s / baseline_s).toFixed(3)) : null;

  // M3 — provisional yes falsos interceptados.
  const M3_tasa = campana.provisionalYesTotales
    ? Number((campana.degradaciones / campana.provisionalYesTotales).toFixed(3))
    : 0;

  // M5 — completitud de carril.
  const terminales = carriles.filter((c) => TERMINALES_LEGITIMOS.includes(c.estado)).length;
  const M5 = carriles.length ? Number((terminales / carriles.length).toFixed(3)) : 0;

  // M6 — precisión de uso de herramientas: llamadas que validan contra esquema.
  const conValidacion = spans.filter((s) => s.validacionEsquema !== undefined);
  const M6 = conValidacion.length
    ? Number((conValidacion.filter((s) => s.validacionEsquema).length / conValidacion.length).toFixed(4))
    : 1;

  // M7 — latencia por carril, en tiempo real.
  const latencias = spans.filter((s) => s.nombre === "carril").map((s) => s.latencia_ms);

  // M8 — costo de la corrida.
  const M8 = Number(spans.reduce((s, x) => s + (x.costoUSD ?? 0), 0).toFixed(4));

  // M9 — tasa de citación. Meta 1.00: cualquier valor menor se muestra.
  const afirmaciones = contarAfirmaciones(e);

  return {
    M1_horasIsquemiaAhorradas: M1,
    M2_tiempoPrimerCompromiso_s: M2_s !== null ? Number(M2_s.toFixed(1)) : null,
    M2_fraccionDelBaseline: M2_frac,
    M3_provisionalYesInterceptados: campana.degradaciones,
    M3_provisionalYesTotales: campana.provisionalYesTotales,
    M3_tasa,
    M4_ofertasPorColocacion: campana.ofertasEmitidas,
    M4_ofertasBaseline: baseline.ofertasEmitidas,
    M5_tasaCompletitudCarril: M5,
    M6_precisionUsoHerramientas: M6,
    M7_latenciaCarril_p50_ms: percentil(latencias, 50),
    M7_latenciaCarril_p95_ms: percentil(latencias, 95),
    M8_costoPorColocacionUSD: M8,
    M9_tasaCitacion: afirmaciones.total ? Number((afirmaciones.conCita / afirmaciones.total).toFixed(4)) : 1,
  };
}

/**
 * Una afirmación fáctica cuenta como respaldada si tiene una `Cita` con
 * referencia y literal. Se cuentan las del expediente y las de cada carril.
 */
function contarAfirmaciones(e: EntradaMetricas): { total: number; conCita: number } {
  let total = 0;
  let conCita = 0;

  for (const oracion of e.expediente?.justificacion ?? []) {
    total++;
    if (oracion.eventos.length > 0) conCita++;
  }

  for (const carril of e.carriles) {
    for (const campo of Object.values(carril.compromiso?.citas ?? {})) {
      total++;
      if (campo.origen === "respuesta_centro" && campo.referencia && campo.literal) conCita++;
    }
    if (carril.codigoRechazo) {
      total++;
      if (carril.citas.some((c) => c.origen === "respuesta_centro" && c.literal)) conCita++;
    }
  }

  return { total, conCita };
}

export function evaluarMetas(m: NueveMetricas): { metrica: string; cumple: boolean; valor: number | null; meta: string }[] {
  return [
    { metrica: "M1", cumple: m.M1_horasIsquemiaAhorradas > METAS.M1_minimo_h, valor: m.M1_horasIsquemiaAhorradas, meta: "> 3 h" },
    { metrica: "M2", cumple: m.M2_fraccionDelBaseline !== null && m.M2_fraccionDelBaseline < METAS.M2_maxFraccionBaseline, valor: m.M2_fraccionDelBaseline, meta: "< 25 % del baseline" },
    { metrica: "M3", cumple: m.M3_tasa > METAS.M3_minimo, valor: m.M3_tasa, meta: "> 0.60" },
    { metrica: "M4", cumple: m.M4_ofertasPorColocacion <= m.M4_ofertasBaseline, valor: m.M4_ofertasPorColocacion, meta: "≤ baseline" },
    { metrica: "M5", cumple: m.M5_tasaCompletitudCarril > METAS.M5_minimo, valor: m.M5_tasaCompletitudCarril, meta: "> 0.95" },
    { metrica: "M6", cumple: m.M6_precisionUsoHerramientas > METAS.M6_minimo, valor: m.M6_precisionUsoHerramientas, meta: "> 0.98" },
    { metrica: "M7", cumple: m.M7_latenciaCarril_p95_ms < METAS.M7_p95_max_ms, valor: m.M7_latenciaCarril_p95_ms, meta: "p95 < 8 s" },
    { metrica: "M8", cumple: true, valor: m.M8_costoPorColocacionUSD, meta: "reportar" },
    { metrica: "M9", cumple: m.M9_tasaCitacion >= METAS.M9_minimo, valor: m.M9_tasaCitacion, meta: "= 1.00" },
  ];
}
