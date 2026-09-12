/**
 * Match run auditable — §10.4 y G4.
 *
 * El orden sale de una función explícita y visible; no es mágico y no se
 * reordena jamás después de generarse. Un salto de secuencia solo es posible
 * marcando AOOS con justificación (§8.2).
 */

import type { Candidato, Donante, EntradaMatchRun, GrupoSanguineo, Organo } from "../domain/tipos";

/** Compatibilidad ABO donante → receptor. */
const COMPATIBLE: Record<GrupoSanguineo, GrupoSanguineo[]> = {
  O: ["O", "A", "B", "AB"],
  A: ["A", "AB"],
  B: ["B", "AB"],
  AB: ["AB"],
};

export function compatibleABO(donante: GrupoSanguineo, receptor: GrupoSanguineo): boolean {
  return COMPATIBLE[donante].includes(receptor);
}

export interface FactoresPuntaje {
  urgencia: number;
  tiempoEnLista: number;
  sensibilizacion: number;
  compatibilidadKdpi: number;
}

export const PESOS_MATCH = { urgencia: 0.40, tiempoEnLista: 0.25, sensibilizacion: 0.20, kdpi: 0.15 };

/**
 * Puntaje de asignación. Se expone entero para que el panel pueda mostrar
 * por qué un candidato está donde está: el orden tiene que ser auditable.
 */
export function puntuarCandidato(
  candidato: Candidato,
  donante: Donante,
  organo: Organo,
): { puntaje: number; factores: FactoresPuntaje } {
  const factores: FactoresPuntaje = {
    urgencia: candidato.urgencia / 6,
    tiempoEnLista: Math.min(1, candidato.tiempoEnLista_dias / 1825), // 5 años satura
    sensibilizacion: candidato.pra, // más sensibilizado, más prioridad
    compatibilidadKdpi: organo.tipo.startsWith("rinon")
      ? Math.max(0, candidato.kdpiMaximoAceptado - donante.kdpi)
      : 1,
  };
  const puntaje =
    PESOS_MATCH.urgencia * factores.urgencia +
    PESOS_MATCH.tiempoEnLista * factores.tiempoEnLista +
    PESOS_MATCH.sensibilizacion * factores.sensibilizacion +
    PESOS_MATCH.kdpi * factores.compatibilidadKdpi;
  return { puntaje, factores };
}

export interface MatchRun {
  organoId: string;
  entradas: EntradaMatchRun[];
  /** Congelado tras generarse: G4 prohíbe reordenar. */
  readonly generado: true;
}

export function generarMatchRun(
  candidatos: Candidato[],
  donante: Donante,
  organo: Organo,
  limite: number,
): MatchRun {
  const elegibles = candidatos
    .filter((c) => compatibleABO(donante.grupoSanguineo, c.grupoSanguineo))
    .filter((c) => (donante.via === "DCD" ? c.aceptaDCD : true))
    .map((c) => ({ c, ...puntuarCandidato(c, donante, organo) }));

  // Desempate estable por id: dos corridas con la misma semilla dan el mismo orden.
  elegibles.sort((x, y) => y.puntaje - x.puntaje || x.c.id.localeCompare(y.c.id));

  // Un centro aparece una sola vez en la campaña: la oferta va al centro,
  // representado por su mejor candidato.
  const vistos = new Set<string>();
  const entradas: EntradaMatchRun[] = [];
  for (const { c } of elegibles) {
    if (vistos.has(c.centroId)) continue;
    vistos.add(c.centroId);
    entradas.push({ secuencia: entradas.length + 1, candidatoId: c.id, centroId: c.centroId });
    if (entradas.length >= limite) break;
  }

  return Object.freeze({ organoId: organo.id, entradas: Object.freeze(entradas) as EntradaMatchRun[], generado: true as const });
}
