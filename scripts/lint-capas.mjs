#!/usr/bin/env node
/**
 * Lint de arquitectura — §5.4 requisito duro y ARQUITECTURA.md §1.
 *
 * Reglas de dependencia entre capas (una capa solo importa de las de abajo):
 *
 *   app/  ──> agui/ ──> orquestacion/ ──> sim/ ──> domain/
 *                                 └──────────────> adapters/  (solo composicion.ts)
 *
 * Y la regla que cuenta ante el jurado: `domain/` no importa un SDK de proveedor.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RAIZ = process.cwd();
const SRC = join(RAIZ, "src");

/** Qué puede importar cada capa, además de módulos de node y de sí misma. */
const PERMITIDO = {
  domain: [],
  sim: ["domain"],
  orquestacion: ["domain", "sim"],
  agui: ["domain", "sim", "orquestacion", "adapters"],
  adapters: ["domain", "sim"],
  app: ["domain", "sim", "orquestacion", "agui", "adapters", "ui"],
  ui: ["domain", "agui"],
};

/** SDKs de proveedor que `domain/`, `sim/` y `orquestacion/` no pueden tocar. */
const SDKS = [
  "openai",
  "@openai/",
  "openrouter",
  "@copilotkit/",
  "@ag-ui/",
  "@trigger.dev/",
  "exa-js",
  "auth0",
  "pg",
  "next",
  "react",
];

const SIN_SDK = ["domain", "sim", "orquestacion"];
const EXT = /\.(ts|tsx)$/;

function* archivos(dir) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entradas) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* archivos(p);
    else if (EXT.test(e)) yield p;
  }
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g;
const hallazgos = [];

for (const archivo of archivos(SRC)) {
  const rel = relative(SRC, archivo);
  const capa = rel.split(sep)[0];
  // Archivos sueltos en src/ (composicion.ts) son la capa de composición: todo vale.
  if (!Object.prototype.hasOwnProperty.call(PERMITIDO, capa)) continue;

  const texto = readFileSync(archivo, "utf8");
  IMPORT.lastIndex = 0;
  let m;
  while ((m = IMPORT.exec(texto)) !== null) {
    const spec = m[1];
    const linea = texto.slice(0, m.index).split("\n").length + 1;
    const donde = `src/${rel}:${linea}`;

    if (SIN_SDK.includes(capa) && SDKS.some((s) => spec === s || spec.startsWith(s))) {
      hallazgos.push(`${donde}  la capa ${capa}/ importa el SDK "${spec}" (§5.4 requisito duro)`);
      continue;
    }
    if (!spec.startsWith(".")) continue; // paquete externo permitido para esta capa

    // Resolver la capa destino de un import relativo.
    const dirActual = join(SRC, rel, "..");
    const destino = relative(SRC, join(dirActual, spec));
    if (destino.startsWith("..")) {
      hallazgos.push(`${donde}  importa fuera de src/: "${spec}"`);
      continue;
    }
    const capaDestino = destino.split(sep)[0];
    if (capaDestino === capa) continue;
    if (!Object.prototype.hasOwnProperty.call(PERMITIDO, capaDestino)) continue; // composicion.ts
    if (!PERMITIDO[capa].includes(capaDestino)) {
      hallazgos.push(`${donde}  ${capa}/ no puede importar de ${capaDestino}/`);
    }
  }
}

if (hallazgos.length > 0) {
  console.error("lint-capas: violaciones de la arquitectura por capas.\n");
  for (const h of hallazgos) console.error("  " + h);
  console.error(`\n${hallazgos.length} violación(es).`);
  process.exit(1);
}
console.log("lint-capas: ok — dependencias entre capas correctas y domain/ libre de SDKs.");
