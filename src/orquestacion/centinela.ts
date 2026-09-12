/**
 * §8.1 — CENTINELA, reloj 1.
 *
 * Detecta criterios clínicos **explícitos y computables** ya escritos en el
 * expediente, con cita textual del dato que los dispara. No pronostica (G3),
 * no determina muerte (G2) y no evalúa idoneidad médica: eso lo hace el OPO.
 *
 * El detector se implementa con reglas legibles, no con un modelo: el criterio
 * de aceptación exige cita válida en el 100 % de los criterios reportados, y
 * una regla es auditable línea por línea. El modelo de triage se usa solo para
 * extraer, nunca para decidir.
 */

import type { Registrador } from "../domain/registro";
import type { Cita, CriterioDetectado, Escalamiento, TipoCriterio } from "../domain/tipos";
import type { Nota, Observacion, PacienteUci } from "../sim/generadores";
import { E } from "./eventos";

/** §2.6 — la sedación documentada invalida el Glasgow. Hay que leer la nota. */
const SEDACION = /\b(sedation|sedated|propofol|midazolam|fentanyl|paralytic)\b/i;
const NO_SEDADO = /\bno sedation\b/i;
const REFLEJOS_AUSENTES = /\b(no cough|no gag|pupils fixed|absent brainstem)\b/i;
const RETIRO_SOPORTE = /\bwithdrawal of life-sustaining\b/i;
const FAMILIA_PREGUNTA = /\bfamily asked spontaneously\b/i;
const LESION_NO_NEURO = /\b(septic encephalopathy|no neurologic injury|no intracranial pathology)\b/i;

export interface ReferralPropuesto {
  pacienteId: string;
  t_trigger: number;
  criterios: CriterioDetectado[];
  ventanaMinutos: number;
  urgencia: "estandar" | "dcd_probable";
  confianza: number;
}

export interface EvaluacionCentinela {
  pacienteId: string;
  referral: ReferralPropuesto | null;
  escalamiento: Escalamiento | null;
  confianza: number;
}

function glasgow(obs: Observacion[]): { valor: number; obs: Observacion } | null {
  for (const o of obs) {
    if (o.campo !== "glasgow") continue;
    const m = /GCS\s+(\d+)/.exec(o.valor);
    if (m) return { valor: Number(m[1]), obs: o };
  }
  return null;
}

function buscarNota(notas: Nota[], re: RegExp): Nota | null {
  return notas.find((n) => re.test(n.texto)) ?? null;
}

function citaDe(fuente: { id: string; texto?: string; valor?: string }, afirmacion: string): Cita {
  return {
    afirmacion,
    origen: "registro_donante",
    referencia: fuente.id,
    literal: fuente.texto ?? fuente.valor ?? "",
  };
}

/** §2.6 — el plazo vive en el contrato hospital-OPO; 81.8 % especifica 60 min. */
export const VENTANA_REFERRAL_MIN = 60;

export function evaluarPaciente(p: PacienteUci, t_sim: number): EvaluacionCentinela {
  const criterios: CriterioDetectado[] = [];
  const sedado = buscarNota(p.notas, SEDACION) && !buscarNota(p.notas, NO_SEDADO);
  const noNeuro = buscarNota(p.notas, LESION_NO_NEURO);

  const gcs = glasgow(p.observaciones);
  if (gcs && gcs.valor <= 5 && !sedado && !noNeuro) {
    criterios.push({
      tipo: "GCS_MENOR_IGUAL_5",
      confianza: 0.97,
      cita: citaDe(gcs.obs, `Glasgow ${gcs.valor} ≤ 5 documentado sin sedación`),
      t_sim,
    });
  }

  const reflejos = buscarNota(p.notas, REFLEJOS_AUSENTES);
  if (reflejos && !sedado) {
    criterios.push({
      tipo: "PERDIDA_REFLEJOS_TRONCO",
      confianza: 0.95,
      cita: citaDe(reflejos, "ausencia documentada de reflejos de tronco encefálico"),
      t_sim,
    });
  }

  const ventilacion = p.observaciones.find((o) => o.campo === "ventilacion");
  const lesion = p.observaciones.find((o) => o.campo === "lesion_neuro" && !/no intracranial/i.test(o.valor));
  if (ventilacion && lesion) {
    criterios.push({
      tipo: "VENTILACION_CON_LESION_NEURO",
      confianza: 0.93,
      cita: citaDe(lesion, "ventilación mecánica con lesión neurológica documentada"),
      t_sim,
    });
  }

  const retiro = buscarNota(p.notas, RETIRO_SOPORTE);
  if (retiro) {
    criterios.push({
      tipo: "PLAN_RETIRO_SOPORTE",
      confianza: 0.96,
      cita: citaDe(retiro, "orden documentada de retiro de soporte vital"),
      t_sim,
    });
  }

  const familia = buscarNota(p.notas, FAMILIA_PREGUNTA);
  if (familia) {
    criterios.push({
      tipo: "FAMILIA_PREGUNTA_DONACION",
      confianza: 0.9,
      cita: citaDe(familia, "la familia preguntó espontáneamente por donación"),
      t_sim,
    });
  }

  // Ambigüedad: Glasgow bajo-medio bajo sedación que se está retirando. El
  // criterio no se cumple hoy, pero podría mañana: eso lo juzga un humano.
  const ambiguo = Boolean(gcs && gcs.valor <= 8 && sedado && !noNeuro && criterios.length === 0);

  if (ambiguo) {
    const conf = 0.55;
    return {
      pacienteId: p.id,
      referral: null,
      confianza: conf,
      escalamiento: {
        id: `ESC-${p.id}`,
        motivo: `Glasgow ${gcs!.valor} bajo sedación documentada; el criterio no es evaluable sin juicio clínico`,
        actor: "centinela",
        t_sim,
        contexto: { pacienteId: p.id, gcs: gcs!.valor, nota: buscarNota(p.notas, SEDACION)?.texto },
        estado: "pendiente",
        resolucion: null,
      },
    };
  }

  if (criterios.length === 0) {
    return { pacienteId: p.id, referral: null, escalamiento: null, confianza: 0.98 };
  }

  const confianza = Math.min(...criterios.map((c) => c.confianza));
  // G7: por debajo de 0.8 se escala, no se refiere.
  if (confianza < 0.8) {
    return {
      pacienteId: p.id,
      referral: null,
      confianza,
      escalamiento: {
        id: `ESC-${p.id}`,
        motivo: `confianza ${confianza.toFixed(2)} < 0.8`,
        actor: "centinela",
        t_sim,
        contexto: { pacienteId: p.id, criterios: criterios.map((c) => c.tipo) },
        estado: "pendiente",
        resolucion: null,
      },
    };
  }

  const dcd = criterios.some((c) => c.tipo === "PLAN_RETIRO_SOPORTE");
  return {
    pacienteId: p.id,
    escalamiento: null,
    confianza,
    referral: {
      pacienteId: p.id,
      t_trigger: t_sim,
      criterios,
      ventanaMinutos: VENTANA_REFERRAL_MIN,
      urgencia: dcd ? "dcd_probable" : "estandar",
      confianza,
    },
  };
}

/** Corre el Centinela sobre un conjunto y emite los eventos correspondientes. */
export function vigilar(
  pacientes: PacienteUci[],
  t_sim: number,
  registro: Registrador,
): EvaluacionCentinela[] {
  return pacientes.map((p) => {
    const ev = evaluarPaciente(p, t_sim);
    for (const c of ev.referral?.criterios ?? []) {
      registro.emitir("centinela", E.CRITERIO_DETECTADO, {
        pacienteId: p.id,
        tipo: c.tipo,
        confianza: c.confianza,
        cita: c.cita,
      });
    }
    if (ev.referral) {
      registro.emitir("centinela", E.REFERRAL_EMITIDO, {
        pacienteId: p.id,
        t_trigger: ev.referral.t_trigger,
        ventanaMinutos: ev.referral.ventanaMinutos,
        urgencia: ev.referral.urgencia,
        confianza: ev.referral.confianza,
        criterios: ev.referral.criterios.map((c) => ({ tipo: c.tipo, cita: c.cita })),
      });
    }
    if (ev.escalamiento) {
      registro.emitir("centinela", E.ESCALAMIENTO_SOLICITADO, { ...ev.escalamiento });
    }
    return ev;
  });
}

/** §8.1 criterio de aceptación: ≥ 95 % de positivos, ≤ 5 % de falsos positivos. */
export interface DesempenoCentinela {
  positivosReales: number;
  detectados: number;
  sensibilidad: number;
  negativosReales: number;
  falsosPositivos: number;
  tasaFalsosPositivos: number;
  escalamientosCorrectos: number;
  limitrofesTotales: number;
  citasValidas: number;
  criteriosReportados: number;
}

export function medirDesempeno(pacientes: PacienteUci[], evaluaciones: EvaluacionCentinela[]): DesempenoCentinela {
  let positivosReales = 0, detectados = 0, negativosReales = 0, falsosPositivos = 0;
  let escalamientosCorrectos = 0, limitrofesTotales = 0, citasValidas = 0, criteriosReportados = 0;

  for (const [i, p] of pacientes.entries()) {
    const ev = evaluaciones[i]!;
    const esPositivo = p.criteriosVerdaderos.length > 0;
    const esLimitrofe = p.esperaEscalamiento;

    if (esLimitrofe) {
      limitrofesTotales++;
      if (ev.escalamiento) escalamientosCorrectos++;
    } else if (esPositivo) {
      positivosReales++;
      if (ev.referral) detectados++;
    } else {
      negativosReales++;
      if (ev.referral) falsosPositivos++;
    }

    for (const c of ev.referral?.criterios ?? []) {
      criteriosReportados++;
      if (c.cita.referencia && c.cita.literal) citasValidas++;
    }
  }

  return {
    positivosReales,
    detectados,
    sensibilidad: positivosReales ? detectados / positivosReales : 1,
    negativosReales,
    falsosPositivos,
    tasaFalsosPositivos: negativosReales ? falsosPositivos / negativosReales : 0,
    escalamientosCorrectos,
    limitrofesTotales,
    citasValidas,
    criteriosReportados,
  };
}
