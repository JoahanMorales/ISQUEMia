/**
 * Aleatoriedad determinista por semilla (§5.2, principio 4).
 * Ningún componente usa `Math.random`; el lint lo prohíbe fuera de adapters/.
 */

/** Hash de string → semilla de 32 bits (xmur3). */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export interface Aleatorio {
  /** Uniforme en [0,1). */
  uniforme(): number;
  entero(minInclusive: number, maxExclusive: number): number;
  rango(min: number, max: number): number;
  bernoulli(p: number): boolean;
  normal(mu?: number, sigma?: number): number;
  logNormal(mu: number, sigma: number): number;
  /** Elige una clave según pesos; los pesos no necesitan sumar 1. */
  categorico<K extends string>(pesos: Partial<Record<K, number>>): K;
  elegir<T>(items: readonly T[]): T;
  /** Deriva un generador independiente y reproducible a partir de una etiqueta. */
  derivar(etiqueta: string): Aleatorio;
}

/** mulberry32 — rápido, suficiente, y reproducible entre corridas. */
export function crearAleatorio(semilla: string): Aleatorio {
  const sembrar = xmur3(semilla);
  let a = sembrar();
  let pendienteNormal: number | null = null;

  const uniforme = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (mu = 0, sigma = 1): number => {
    if (pendienteNormal !== null) {
      const v = pendienteNormal;
      pendienteNormal = null;
      return mu + sigma * v;
    }
    // Box–Muller
    let u = 0;
    let v = 0;
    while (u === 0) u = uniforme();
    while (v === 0) v = uniforme();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    pendienteNormal = r * Math.sin(theta);
    return mu + sigma * (r * Math.cos(theta));
  };

  const api: Aleatorio = {
    uniforme,
    entero: (min, max) => min + Math.floor(uniforme() * (max - min)),
    rango: (min, max) => min + uniforme() * (max - min),
    bernoulli: (p) => uniforme() < p,
    normal,
    logNormal: (mu, sigma) => Math.exp(normal(mu, sigma)),
    categorico: <K extends string>(pesos: Partial<Record<K, number>>): K => {
      const entradas = Object.entries(pesos) as [K, number][];
      const total = entradas.reduce((s, [, w]) => s + w, 0);
      let x = uniforme() * total;
      for (const [k, w] of entradas) {
        x -= w;
        if (x <= 0) return k;
      }
      return entradas[entradas.length - 1]![0];
    },
    elegir: <T,>(items: readonly T[]): T => items[Math.floor(uniforme() * items.length)]!,
    derivar: (etiqueta: string) => crearAleatorio(`${semilla}::${etiqueta}`),
  };
  return api;
}
