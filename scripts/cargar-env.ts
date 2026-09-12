/**
 * Carga `.env.local` para los scripts de consola.
 *
 * Next.js lo hace solo cuando sirve la aplicación; `tsx scripts/...` no, así
 * que sin esto el arnés cree que no hay credenciales y corre todo en local.
 * Nunca sobrescribe una variable que ya venga del entorno: lo que exportes en
 * la terminal manda.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function cargarEnvLocal(archivo = join(process.cwd(), ".env.local")): void {
  if (!existsSync(archivo)) return;
  for (const linea of readFileSync(archivo, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const i = limpia.indexOf("=");
    if (i < 1) continue;
    const clave = limpia.slice(0, i).trim();
    let valor = limpia.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}
