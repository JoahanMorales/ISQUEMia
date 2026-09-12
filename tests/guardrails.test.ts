/**
 * §15 — guardrails estructurales disponibles desde la fase 0.
 */
import { describe, expect, it } from "vitest";
import {
  ViolacionGuardrail,
  compromisoCompleto,
  exigirCitaCompromiso,
  validarSintetico,
} from "../src/domain/guardrails";
import type { CompromisoVerificado } from "../src/domain/tipos";

describe("guardrails", () => {
  it("G1 rechaza cualquier id sin prefijo SYN-", () => {
    expect(validarSintetico("SYN-DON-001")).toBe("SYN-DON-001");
    expect(() => validarSintetico("DON-001")).toThrow(ViolacionGuardrail);
    expect(() => validarSintetico("DON-001")).toThrow(/G1/);
  });

  it("G6 rechaza un campo de compromiso sin cita del centro", () => {
    expect(() => exigirCitaCompromiso({}, "cirujanoNombrado")).toThrow(/G6/);
    expect(() =>
      exigirCitaCompromiso(
        {
          cirujanoNombrado: {
            afirmacion: "el cirujano es Dr. A",
            origen: "registro_donante",
            referencia: "donante.x",
            literal: "Dr. A",
          },
        },
        "cirujanoNombrado",
      ),
    ).toThrow(/G6/);
    expect(
      exigirCitaCompromiso(
        {
          cirujanoNombrado: {
            afirmacion: "el cirujano es Dr. A",
            origen: "respuesta_centro",
            referencia: "run-x#000012",
            literal: "Dr. A will do the recovery",
          },
        },
        "cirujanoNombrado",
      ).literal,
    ).toBe("Dr. A will do the recovery");
  });

  it("§6.6 completo exige los cuatro campos", () => {
    const base: CompromisoVerificado = {
      cirujanoNombrado: "Dr. A",
      quirofanoReservado: { sala: "OR-3", hora: 1000 },
      receptorConfirmadoDisponible: true,
      etaEquipoRecuperacion: 2000,
      citTotalProyectada_h: 12,
      completo: false,
      t_verificado: null,
      citas: {},
    };
    expect(compromisoCompleto(base)).toBe(true);
    expect(compromisoCompleto({ ...base, etaEquipoRecuperacion: null })).toBe(false);
    expect(compromisoCompleto({ ...base, receptorConfirmadoDisponible: null })).toBe(false);
  });
});
