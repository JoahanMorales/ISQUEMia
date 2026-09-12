/**
 * §7.4 — parámetros de política. Puro y configurable.
 * Todos los tiempos en segundos de simulación salvo indicación contraria.
 */

import type { TipoOrgano } from "./tipos";

export interface Politica {
  N_CARRILES: number;
  K_VOZ: number;
  MAX_CONCURRENTES_POLITICA: number;
  T_PRIMERA_RESPUESTA_s: number;
  T_VERIFICACION_s: number;
  T_TIMEOUT_CARRIL_s: number;
  UMBRAL_CIT_ALERTA: readonly number[];
  HORAS_SALVADAS_POR_DEGRADACION: number;
  /** §11.4 — latencia humana entre carriles en la línea base serial. */
  BASELINE_LATENCIA_ENTRE_CARRILES_s: number;
  BASELINE_MULTIPLICADOR_NOCTURNO: number;
  /** H05/H07 — retraso medio del rechazo tardío tras un provisional yes. */
  RETRASO_RECHAZO_TARDIO_s: number;
  /** §8.2 — por encima de esta secuencia, la colocación se marca AOOS. */
  UMBRAL_SECUENCIA_AOOS: number;
}

export const POLITICA_POR_DEFECTO: Politica = {
  N_CARRILES: 40,
  K_VOZ: 6, // §5.3
  MAX_CONCURRENTES_POLITICA: 4, // H16
  T_PRIMERA_RESPUESTA_s: 180,
  T_VERIFICACION_s: 240,
  T_TIMEOUT_CARRIL_s: 600,
  UMBRAL_CIT_ALERTA: [0.5, 0.75, 0.9],
  HORAS_SALVADAS_POR_DEGRADACION: 1.5, // H07
  BASELINE_LATENCIA_ENTRE_CARRILES_s: 90,
  BASELINE_MULTIPLICADOR_NOCTURNO: 1.5,
  RETRASO_RECHAZO_TARDIO_s: 1.5 * 3600,
  UMBRAL_SECUENCIA_AOOS: 100,
};

/** §2.5 — isquemia frío tolerable con almacenamiento estático, en horas. */
export const CIT_LIMITE_H: Record<TipoOrgano, number> = {
  corazon: 4,
  pulmon_izq: 5,
  pulmon_der: 5,
  higado: 10,
  pancreas: 15,
  rinon_izq: 30,
  rinon_der: 30,
};

/**
 * §2.5 — la perfusión estabiliza el reloj; el salto grande es corazón
 * (4 h → 9–17 h). Multiplicadores sobre el límite estático.
 */
export const MULTIPLICADOR_PERFUSION: Record<
  NonNullable<import("./tipos").Perfusion>,
  Partial<Record<TipoOrgano, number>>
> = {
  estatico: {},
  hipotermica: { rinon_izq: 1.2, rinon_der: 1.2, higado: 1.2 },
  normotermica: { corazon: 3.0, higado: 1.5, pulmon_izq: 1.5, pulmon_der: 1.5 },
};

export function citLimiteEfectivo_h(
  tipo: TipoOrgano,
  perfusion: import("./tipos").Perfusion | null,
): number {
  const base = CIT_LIMITE_H[tipo];
  if (!perfusion) return base;
  return base * (MULTIPLICADOR_PERFUSION[perfusion][tipo] ?? 1);
}
