/**
 * Suite de regresión — §14.4.
 *
 * Diez semillas fijas. Cada una corre la campaña del agente y la línea base
 * serial sobre el mismo mundo, y el resultado se guarda en
 * `evals/resultados.json`, que P5 lee.
 *
 * El proceso sale con código 1 si M5, M6 o M9 caen bajo su meta en cualquier
 * semilla: son las tres que miden que el sistema no se rompe y no inventa, así
 * que un incumplimiento tiene que tumbar el build, no aparecer en una nota.
 *
 *   npx tsx scripts/evals.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cargarEnvLocal } from "./cargar-env";
import { crearCorrida } from "../src/composicion";
import { METAS, evaluarMetas } from "../src/orquestacion/metricas";
import type { ResultadoCorrida } from "../src/orquestacion/corrida";
import type { NueveMetricas } from "../src/domain/tipos";

cargarEnvLocal();

/** Las diez semillas de la suite. Fijas: cambiarlas es cambiar la medición. */
export const SEMILLAS = [
  "S-001", "S-002", "S-003", "S-004", "S-005",
  "S-006", "S-007", "S-008", "S-009", "S-010",
] as const;

/** Las tres que bloquean el build (§14.4). */
const BLOQUEANTES = ["M5", "M6", "M9"] as const;

export interface FilaEval {
  semilla: string;
  corridaId: string;
  organo: string;
  via: string;
  fase: string;
  secuenciaAgente: number | null;
  secuenciaBaseline: number | null;
  ofertasAgente: number;
  ofertasBaseline: number;
  citAgente_h: number | null;
  citBaseline_h: number | null;
  degradaciones: number;
  provisionalYes: number;
  horasProtegidas: number;
  eventos: number;
  metricas: NueveMetricas;
  metas: { metrica: string; cumple: boolean; valor: number | null; meta: string }[];
  bloqueantesEnMeta: boolean;
  ms: number;
}

export interface ResultadosEval {
  generado: string;
  semillas: number;
  bloqueantes: readonly string[];
  metas: typeof METAS;
  aprobado: boolean;
  agregado: {
    /** Media de M1 solo sobre las semillas donde la comparación existe. */
    M1_medio_comparables: number;
    M1_comparables: number;
    M3_medio: number;
    M5_min: number;
    M6_min: number;
    M9_min: number;
    M8_total: number;
    colocadas: number;
    baselineColoco: number;
    /** El agente colocó y la línea base perdió el órgano. */
    organosSalvados: number;
    mejorQueBaseline: number;
  };
  filas: FilaEval[];
}

/**
 * La suite mide el núcleo determinista, así que corre siempre con los
 * adaptadores locales aunque haya credenciales en el entorno. Un modelo remoto
 * con la caché fría degradaría a reglas (G9) y hundiría M6 sin que nada esté
 * roto: el arnés de regresión dejaría de medir el sistema y pasaría a medir el
 * estado de una caché. La ruta remota se ejercita en la corrida en vivo y en
 * `scripts/precalentar.ts`.
 */
const ENTORNO_DETERMINISTA = {} as const;

function correrSemilla(semilla: string): FilaEval {
  // lint-reloj: permitido — el arnés mide tiempo de pared para reportar cuánto
  // tarda la suite; el mundo simulado sigue moviéndose solo con el reloj sembrado.
  const t0 = Date.now(); // lint-reloj: permitido — duración real de la suite
  const c = crearCorrida({ semilla, entorno: ENTORNO_DETERMINISTA });

  let resultado: ResultadoCorrida | null = null;
  c.isquemia.iniciar((r) => (resultado = r));
  // 72 h de simulación agotan campaña y línea base en cualquier semilla.
  c.reloj.correrHastaVacio(72 * 3600);

  if (!resultado) throw new Error(`semilla ${semilla}: la corrida no terminó en la ventana de 72 h`);
  const r = resultado as ResultadoCorrida;

  const metas = evaluarMetas(r.metricas);
  const bloqueantesEnMeta = metas
    .filter((m) => (BLOQUEANTES as readonly string[]).includes(m.metrica))
    .every((m) => m.cumple);

  return {
    semilla,
    corridaId: c.corridaId,
    organo: c.mundo.organo.tipo,
    via: c.mundo.donante.via,
    fase: c.isquemia.fase,
    secuenciaAgente: r.campana.secuenciaFinal,
    secuenciaBaseline: r.baseline.secuenciaFinal,
    ofertasAgente: r.campana.ofertasEmitidas,
    ofertasBaseline: r.baseline.ofertasEmitidas,
    citAgente_h: r.campana.citFinal_h ?? null,
    citBaseline_h: r.baseline.cit_h,
    degradaciones: r.campana.degradaciones,
    provisionalYes: r.campana.provisionalYesTotales,
    horasProtegidas: Number(r.campana.horasProtegidas.toFixed(2)),
    eventos: c.almacen.todos().length,
    metricas: r.metricas,
    metas,
    bloqueantesEnMeta,
    ms: Date.now() - t0, // lint-reloj: permitido — duración real de la corrida
  };
}

function media(xs: number[]): number {
  return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : 0;
}

export function correrSuite(semillas: readonly string[] = SEMILLAS): ResultadosEval {
  const filas = semillas.map(correrSemilla);
  const comparables = filas.filter((f) => f.secuenciaAgente !== null && f.secuenciaBaseline !== null);
  return {
    generado: new Date().toISOString(), // lint-reloj: permitido — sello del informe
    semillas: filas.length,
    bloqueantes: BLOQUEANTES,
    metas: METAS,
    aprobado: filas.every((f) => f.bloqueantesEnMeta),
    agregado: {
      // Promediar M1 sobre las diez escondería el resultado: cuando la línea
      // base no coloca no hay horas que comparar, y contar ese caso como cero
      // haría parecer que el agente no ganó nada justo donde ganó el órgano
      // entero. Se promedia sobre las comparables y el resto se cuenta aparte.
      M1_medio_comparables: media(comparables.map((f) => f.metricas.M1_horasIsquemiaAhorradas)),
      M1_comparables: comparables.length,
      M3_medio: media(filas.map((f) => f.metricas.M3_tasa)),
      M5_min: Math.min(...filas.map((f) => f.metricas.M5_tasaCompletitudCarril)),
      M6_min: Math.min(...filas.map((f) => f.metricas.M6_precisionUsoHerramientas)),
      M9_min: Math.min(...filas.map((f) => f.metricas.M9_tasaCitacion)),
      M8_total: Number(filas.reduce((s, f) => s + f.metricas.M8_costoPorColocacionUSD, 0).toFixed(4)),
      colocadas: filas.filter((f) => f.secuenciaAgente !== null).length,
      baselineColoco: filas.filter((f) => f.secuenciaBaseline !== null).length,
      organosSalvados: filas.filter((f) => f.secuenciaAgente !== null && f.secuenciaBaseline === null).length,
      mejorQueBaseline: filas.filter(
        (f) => f.citAgente_h !== null && f.citBaseline_h !== null && f.citAgente_h < f.citBaseline_h,
      ).length,
    },
    filas,
  };
}

export const RUTA_RESULTADOS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "evals",
  "resultados.json",
);

function principal(): void {
  const r = correrSuite();

  mkdirSync(dirname(RUTA_RESULTADOS), { recursive: true });
  writeFileSync(RUTA_RESULTADOS, JSON.stringify(r, null, 2) + "\n", "utf8");

  const anchoM = 6;
  console.log(`\n═══ Suite de regresión · ${r.semillas} semillas (§14.4) ═══\n`);
  console.log(
    ["semilla", "órgano".padEnd(8), "seq", "base", "M1".padStart(anchoM), "M3".padStart(anchoM),
     "M5".padStart(anchoM), "M6".padStart(anchoM), "M9".padStart(anchoM), ""].join("  "),
  );
  for (const f of r.filas) {
    const m = f.metricas;
    console.log(
      [
        f.semilla,
        f.organo.padEnd(8),
        String(f.secuenciaAgente ?? "—").padStart(3),
        String(f.secuenciaBaseline ?? "—").padStart(4),
        m.M1_horasIsquemiaAhorradas.toFixed(2).padStart(anchoM),
        m.M3_tasa.toFixed(2).padStart(anchoM),
        m.M5_tasaCompletitudCarril.toFixed(3).padStart(anchoM),
        m.M6_precisionUsoHerramientas.toFixed(3).padStart(anchoM),
        m.M9_tasaCitacion.toFixed(3).padStart(anchoM),
        f.bloqueantesEnMeta ? "✓" : "✗ M5/M6/M9 fuera de meta",
      ].join("  "),
    );
  }

  const a = r.agregado;
  console.log(`\nColocadas ${a.colocadas}/${r.semillas} · la línea base colocó ${a.baselineColoco}/${r.semillas}`);
  console.log(`Órganos que la línea base perdió y el agente colocó: ${a.organosSalvados}/${r.semillas}`);
  console.log(`M1 medio ${a.M1_medio_comparables} h sobre ${a.M1_comparables} semillas comparables · M3 medio ${a.M3_medio} · costo total $${a.M8_total}`);
  console.log(`Mínimos bloqueantes — M5 ${a.M5_min} (> ${METAS.M5_minimo}) · M6 ${a.M6_min} (> ${METAS.M6_minimo}) · M9 ${a.M9_min} (= ${METAS.M9_minimo})`);
  console.log(`\nEscrito en evals/resultados.json`);

  if (!r.aprobado) {
    console.error(`\n✗ La suite no pasa: M5, M6 o M9 por debajo de meta en al menos una semilla.`);
    process.exit(1);
  }
  console.log(`✓ Suite aprobada.\n`);
}

// Solo corre si se invoca como script, no al importarlo desde un test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
