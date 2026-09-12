/**
 * Resultados de la suite de regresión de diez semillas (§14.4), para P5.
 *
 * El archivo lo escribe `npm run evals` y se lee de disco en caliente: así el
 * panel muestra la última corrida de la suite sin que haya que reconstruir la
 * aplicación, y si nadie la ha corrido lo dice en vez de inventarse cifras.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ruta = join(process.cwd(), "evals", "resultados.json");
    const crudo = await readFile(ruta, "utf8");
    return NextResponse.json({ ok: true, resultados: JSON.parse(crudo) });
  } catch {
    return NextResponse.json(
      { ok: false, error: "No hay resultados todavía. Corre `npm run evals`." },
      { status: 404 },
    );
  }
}
