/**
 * Fase 0 · aceptación: se emite un evento y se lee de vuelta.
 */
import { describe, expect, it } from "vitest";
import { crearCorrida } from "../src/composicion";
import { E } from "../src/orquestacion/eventos";

/** La composición emite una insignia por slot al arrancar; aquí estorban. */
const sinInsignias = <T extends { tipo: string }>(xs: T[]) => xs.filter((e) => e.tipo !== E.ADAPTADOR_SELECCIONADO);

describe("almacén de eventos append-only (§5.4 ALMACEN)", () => {
  it("emite y lee de vuelta con t_sim del reloj", async () => {
    const c = crearCorrida({ semilla: "S-001" });
    c.reloj.advance(120);
    const ev = c.registro.emitir("centinela", "CRITERIO_DETECTADO", { gcs: 4 });

    expect(ev.t_sim).toBe(120_000);
    expect(ev.semilla).toBe("S-001");
    expect(ev.corridaId).toBe("run-S-001");

    const leidos = sinInsignias(c.almacen.todos());
    expect(leidos).toHaveLength(1);
    expect(leidos[0]).toEqual(ev);
  });

  it("es append-only: los eventos escritos son inmutables", async () => {
    const c = crearCorrida({ semilla: "S-001" });
    const ev = c.registro.emitir("simulador", "X", { a: 1 });
    expect(() => {
      (ev as { tipo: string }).tipo = "Y";
    }).toThrow();
    expect(Object.isFrozen(ev.payload)).toBe(true);
  });

  it("lee por rango de t_sim", async () => {
    const c = crearCorrida({ semilla: "S-001" });
    c.registro.emitir("simulador", "A");
    c.reloj.advance(60);
    c.registro.emitir("simulador", "B");
    c.reloj.advance(60);
    c.registro.emitir("simulador", "C");

    const medio = sinInsignias(c.almacen.read(60_000, 60_000));
    expect(medio.map((e) => e.tipo)).toEqual(["B"]);
    expect(sinInsignias(c.almacen.read(60_000)).map((e) => e.tipo)).toEqual(["B", "C"]);
    expect(sinInsignias(c.almacen.read(undefined, 60_000)).map((e) => e.tipo)).toEqual(["A", "B"]);
  });

  it("retransmite al bus lo que se registra", async () => {
    const c = crearCorrida({ semilla: "S-001" });
    const vistos: string[] = [];
    const desuscribir = c.bus.subscribe((e) => vistos.push(e.tipo));
    c.registro.emitir("despachador", "CAMPANA_ABIERTA");
    desuscribir();
    c.registro.emitir("despachador", "CAMPANA_CERRADA");
    expect(vistos).toEqual(["CAMPANA_ABIERTA"]);
  });

  it("ids deterministas: misma semilla, misma secuencia de ids", async () => {
    const c0 = crearCorrida({ semilla: "S-042" }).almacen.todos().length;
    const ids = () => {
      const c = crearCorrida({ semilla: "S-042" });
      for (const t of ["A", "B", "C"]) c.registro.emitir("simulador", t);
      return sinInsignias(c.almacen.todos()).map((e) => e.id);
    };
    expect(ids()).toEqual(ids());
    expect(ids()[0]).toBe(`run-S-042#${String(c0).padStart(6, "0")}`);
  });
});
