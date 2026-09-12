/**
 * Control de la corrida: arrancar, cambiar semilla, mover el reloj, replay.
 * Todo lo que la interfaz necesita y que no es estado (eso va por AG-UI).
 */

import { NextResponse } from "next/server";
import { listarSesiones, reiniciar, sesionPorDefecto } from "../../../agui/sesion";
import { proyectar } from "../../../agui/estado";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = sesionPorDefecto();
  return NextResponse.json({
    sesiones: listarSesiones(),
    estado: proyectar(s.corrida, 40),
  });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json()) as {
    accion: "arrancar" | "reiniciar" | "factor" | "congelar" | "reanudar" | "adelantar";
    semilla?: string;
    factor?: number;
    tipoOrgano?: string;
    perfusion?: string | null;
  };

  switch (cuerpo.accion) {
    // Idempotente: `Sesion.arrancar()` no hace nada si la corrida ya salió de
    // `inactiva`, así que dos pestañas abiertas no arrancan dos campañas.
    case "arrancar": {
      const s = sesionPorDefecto();
      s.arrancar();
      return NextResponse.json({ ok: true, corridaId: s.corrida.corridaId, fase: s.corrida.isquemia.fase });
    }
    case "reiniciar": {
      const s = reiniciar(cuerpo.semilla ?? "S-001", {
        tipoOrgano: cuerpo.tipoOrgano as never,
        perfusion: (cuerpo.perfusion ?? null) as never,
        factor: cuerpo.factor,
      });
      return NextResponse.json({ ok: true, corridaId: s.corrida.corridaId, semilla: s.corrida.semilla });
    }
    case "factor": {
      const s = sesionPorDefecto();
      s.setFactor(cuerpo.factor ?? 120);
      return NextResponse.json({ ok: true, factor: s.corrida.reloj.factor });
    }
    case "congelar": {
      sesionPorDefecto().congelar();
      return NextResponse.json({ ok: true, congelado: true });
    }
    case "reanudar": {
      sesionPorDefecto().reanudar();
      return NextResponse.json({ ok: true, congelado: false });
    }
    case "adelantar": {
      sesionPorDefecto().adelantarHastaElFinal();
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ ok: false, error: "acción desconocida" }, { status: 400 });
  }
}
