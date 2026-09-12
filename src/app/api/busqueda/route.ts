/**
 * Corroboración de la ruta de transporte con fuentes reales (slot `BUSQUEDA`).
 *
 * Vive fuera del reloj de simulación a propósito: el plan ya está decidido y es
 * determinista; esto solo le pone fuentes al lado. Ver `adapters/busqueda-exa.ts`.
 */

import { NextResponse } from "next/server";
import { BusquedaExa, BusquedaVacia } from "../../../adapters/busqueda-exa";
import { leerEntorno } from "../../../adapters/seleccion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { consulta } = (await request.json()) as { consulta?: string };
  if (!consulta || consulta.trim().length < 3) {
    return NextResponse.json({ ok: false, error: "consulta vacía" }, { status: 400 });
  }

  const entorno = leerEntorno();
  const remoto = Boolean(entorno.EXA_API_KEY);
  const busqueda = remoto ? new BusquedaExa({ apiKey: entorno.EXA_API_KEY! }) : new BusquedaVacia();

  try {
    const resultados = await busqueda.search(consulta);
    return NextResponse.json({ ok: true, remoto, impl: busqueda.nombre, resultados });
  } catch (e) {
    // G9: una degradación de proveedor se cuenta, no se disfraza de resultado.
    return NextResponse.json(
      { ok: false, remoto, impl: busqueda.nombre, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
