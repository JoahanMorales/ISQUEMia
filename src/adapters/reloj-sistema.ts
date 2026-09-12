/**
 * ADAPTER — único lugar del repositorio autorizado a leer la hora del sistema.
 * El lint `scripts/lint-reloj.mjs` falla el build si `Date.now`, `new Date()`,
 * `performance.now` o `Math.random` aparecen fuera de `src/adapters/`.
 */

/** Hora de pared en ms. Solo para `Evento.t_wall` y para medir latencia real. */
export function horaDePared(): number {
  return Date.now();
}

/** Reloj monótono en ms, para latencias de span (§14.1). */
export function monotono(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** ISO-8601 de un instante de pared. */
export function isoDePared(ms: number): string {
  return new Date(ms).toISOString();
}
