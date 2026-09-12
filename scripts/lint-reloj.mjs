#!/usr/bin/env node
/**
 * Lint de §11.2 / §5.2 principio 2 y principio 4.
 *
 * Falla el build si un archivo fuera de `src/adapters/` usa la hora del
 * sistema o aleatoriedad no sembrada. Sin esto, la reproducibilidad por
 * semilla (§0.4 criterio 7) se rompe en silencio.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RAIZ = process.cwd();
const DIRS = ["src", "tests", "scripts"];
const EXENTOS = [join("src", "adapters") + sep];
const EXT = /\.(ts|tsx|mts|cts|js|mjs|jsx)$/;

const PROHIBIDO = [
  { patron: /\bDate\.now\s*\(/g, que: "Date.now()" },
  { patron: /\bnew\s+Date\s*\(/g, que: "new Date()" },
  { patron: /\bperformance\.now\s*\(/g, que: "performance.now()" },
  { patron: /\bMath\.random\s*\(/g, que: "Math.random()" },
  { patron: /\bsetTimeout\s*\(/g, que: "setTimeout()" },
  { patron: /\bsetInterval\s*\(/g, que: "setInterval()" },
];

/** Permite excepciones puntuales con `// lint-reloj: permitido <razón>`. */
const PERMISO = /lint-reloj:\s*permitido/;

function* archivos(dir) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entradas) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* archivos(p);
    else if (EXT.test(e)) yield p;
  }
}

const hallazgos = [];
for (const dir of DIRS) {
  for (const archivo of archivos(join(RAIZ, dir))) {
    const rel = relative(RAIZ, archivo);
    if (EXENTOS.some((x) => rel.startsWith(x))) continue;
    if (rel === join("scripts", "lint-reloj.mjs")) continue;
    const lineas = readFileSync(archivo, "utf8").split("\n");
    lineas.forEach((linea, i) => {
      if (PERMISO.test(linea)) return;
      for (const { patron, que } of PROHIBIDO) {
        patron.lastIndex = 0;
        if (patron.test(linea)) {
          hallazgos.push(`${rel}:${i + 1}  usa ${que} fuera de src/adapters/`);
        }
      }
    });
  }
}

if (hallazgos.length > 0) {
  console.error("lint-reloj: el dominio no puede leer la hora del sistema ni azar sin semilla.");
  console.error("Usa sim.now() / sim.schedule() y el generador sembrado de domain/aleatorio.ts.\n");
  for (const h of hallazgos) console.error("  " + h);
  console.error(`\n${hallazgos.length} violación(es).`);
  process.exit(1);
}

console.log("lint-reloj: ok — ningún uso de hora de sistema o azar sin semilla fuera de adapters/.");
