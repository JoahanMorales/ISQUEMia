/**
 * Precalienta la caché del modelo real.
 *
 * El bucle de simulación llama al modelo desde callbacks del reloj, donde una
 * promesa rompería el orden de eventos, así que el camino síncrono solo puede
 * leer de caché (§5.2 principio 4). Este script hace el trabajo asíncrono una
 * vez: corre la campaña, recoge cada entrada que el modelo habría recibido, se
 * las pide de verdad al proveedor y guarda las respuestas.
 *
 * A partir de ahí, esa semilla corre con respuestas reales del modelo —con sus
 * tokens y su costo reales en M8— y sigue siendo reproducible.
 *
 *   npx tsx scripts/precalentar.ts S-001 S-002
 */

import { cargarEnvLocal } from "./cargar-env";
import { ESQUEMA_CODIGO_RECHAZO, MODELO_POR_TAREA } from "../src/adapters/llm-guionado";
import { CacheLlm, LlmRemoto } from "../src/adapters/llm-remoto";
import { leerEntorno } from "../src/adapters/seleccion";
import { crearCorrida } from "../src/composicion";
import type { Mensaje } from "../src/domain/puertos";

cargarEnvLocal();

const semillas = process.argv.slice(2).length ? process.argv.slice(2) : ["S-001"];
const entorno = leerEntorno();
const apiKey = entorno.OPENAI_API_KEY ?? entorno.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("No hay OPENAI_API_KEY ni OPENROUTER_API_KEY en el entorno: no hay nada que precalentar.");
  process.exit(1);
}

const baseUrl = entorno.OPENAI_API_KEY ? undefined : "https://openrouter.ai/api/v1";
const cache = new CacheLlm();

interface Faltante {
  modelo: string;
  messages: Mensaje[];
  schema?: Record<string, unknown>;
}

const faltantes = new Map<string, Faltante>();

for (const semilla of semillas) {
  const c = crearCorrida({ semilla, cacheLlm: cache });
  c.isquemia.iniciar(() => {});
  c.reloj.correrHastaVacio(72 * 3600);

  for (const f of recogerDeEventos(c)) {
    faltantes.set(CacheLlm.clave(f.modelo, f.messages, f.schema), f);
  }
  console.log(`${semilla}: ${c.almacen.todos().length} eventos`);
}

/**
 * Las entradas que el modelo de triage recibe son deterministas y están en el
 * registro: cada `CARRIL_RESPUESTA_RECIBIDA` lleva la prosa que se le pasa.
 * Reconstruirlas desde el event store es más honesto que instrumentar el
 * adaptador: si mañana cambia el prompt, este script deja de acertar y se ve.
 */
function recogerDeEventos(c: ReturnType<typeof crearCorrida>): Faltante[] {
  const fuera: Faltante[] = [];
  for (const e of c.almacen.todos()) {
    if (e.tipo !== "CARRIL_RESPUESTA_RECIBIDA") continue;
    const prosa = (e.payload as { prosa?: string }).prosa;
    if (!prosa) continue;
    fuera.push({
      modelo: MODELO_POR_TAREA.triage,
      messages: [
        { rol: "system", contenido: "Map the transplant center's refusal prose to exactly one OPTN refusal code." },
        { rol: "user", contenido: prosa },
      ],
      schema: ESQUEMA_CODIGO_RECHAZO as unknown as Record<string, unknown>,
    });
  }
  return fuera;
}

const pendientes = [...faltantes.values()].filter(
  (f) => !cache.get(CacheLlm.clave(f.modelo, f.messages, f.schema)),
);

console.log(`\n${faltantes.size} entradas distintas · ${pendientes.length} sin caché\n`);

let ok = 0;
let fallos = 0;
for (const [i, f] of pendientes.entries()) {
  const llm = new LlmRemoto({ modelo: f.modelo, apiKey: apiKey!, baseUrl, cache });
  try {
    const r = await llm.complete(f.messages, undefined, f.schema);
    ok++;
    process.stdout.write(
      `  [${i + 1}/${pendientes.length}] ${f.modelo}  ${r.usage.entrada}+${r.usage.salida} tok  ${r.content.slice(0, 60).replace(/\n/g, " ")}\n`,
    );
  } catch (e) {
    fallos++;
    console.error(`  [${i + 1}/${pendientes.length}] falló: ${e instanceof Error ? e.message : String(e)}`);
  }
}

cache.guardar();
console.log(`\nCaché: ${cache.tamano} entradas · ${ok} nuevas · ${fallos} fallos`);
if (fallos > 0) process.exitCode = 1;
