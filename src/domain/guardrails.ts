/**
 * §15 — guardrails implementados como código que rechaza, no como prompt.
 * Aquí viven los que son puramente estructurales; el resto se aplica en el
 * registro de herramientas (§9) y en los agentes (§8).
 */

import type { CampoCompromiso, Cita, CompromisoVerificado } from "./tipos";

export class ViolacionGuardrail extends Error {
  constructor(
    readonly regla: string,
    mensaje: string,
  ) {
    super(`[${regla}] ${mensaje}`);
    this.name = "ViolacionGuardrail";
  }
}

/** G1 — cero datos de pacientes reales: todo id clínico lleva prefijo `SYN-`. */
export function validarSintetico(id: string, campo = "id"): string {
  if (!id.startsWith("SYN-")) {
    throw new ViolacionGuardrail(
      "G1",
      `${campo}="${id}" no tiene prefijo SYN-; se rechaza la ingesta`,
    );
  }
  return id;
}

export function esSintetico(id: string): boolean {
  return id.startsWith("SYN-");
}

/** G5 — ningún dato clínico generado por modelo: exige cita de registro_donante. */
export function exigirCitaClinica(citas: Cita[], referencia: string): Cita {
  const cita = citas.find((c) => c.referencia === referencia && c.origen === "registro_donante");
  if (!cita) {
    throw new ViolacionGuardrail(
      "G5",
      `el dato clínico "${referencia}" no tiene Cita con origen=registro_donante`,
    );
  }
  return cita;
}

/** G6 — ningún campo de compromiso inferido: exige cita de respuesta_centro. */
export function exigirCitaCompromiso(
  citas: Partial<Record<CampoCompromiso, Cita>>,
  campo: CampoCompromiso,
): Cita {
  const cita = citas[campo];
  if (!cita || cita.origen !== "respuesta_centro") {
    throw new ViolacionGuardrail(
      "G6",
      `el campo de compromiso "${campo}" no tiene Cita con origen=respuesta_centro`,
    );
  }
  return cita;
}

/** §6.6 — `completo` solo si los cuatro primeros campos están llenos. */
export function compromisoCompleto(c: CompromisoVerificado): boolean {
  return (
    c.cirujanoNombrado !== null &&
    c.quirofanoReservado !== null &&
    c.receptorConfirmadoDisponible === true &&
    c.etaEquipoRecuperacion !== null
  );
}
