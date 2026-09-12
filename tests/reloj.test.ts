/**
 * Fase 0 · aceptación: `sim.advance(3600)` mueve el reloj y nada más lo mueve.
 */
import { describe, expect, it, vi } from "vitest";
import { RelojSimulacion } from "../src/sim/reloj";

describe("reloj de simulación (§11.2)", () => {
  it("arranca en t0 y solo avanza con advance()", async () => {
    const sim = new RelojSimulacion({ t0: 0 });
    expect(sim.now()).toBe(0);

    // Espera real: el reloj de simulación no se mueve con el tiempo de pared.
    await new Promise((r) => globalThis.setTimeout(r, 20)); // lint-reloj: permitido — prueba explícita
    expect(sim.now()).toBe(0);

    sim.advance(3600);
    expect(sim.now()).toBe(3_600_000);
  });

  it("dispara lo agendado en orden y en el instante correcto", () => {
    const sim = new RelojSimulacion();
    const vistos: [string, number][] = [];
    sim.schedule(30, () => vistos.push(["b", sim.now()]));
    sim.schedule(10, () => vistos.push(["a", sim.now()]));
    sim.schedule(30, () => vistos.push(["c", sim.now()])); // empate: gana el agendado antes

    sim.advance(60);
    expect(vistos).toEqual([
      ["a", 10_000],
      ["b", 30_000],
      ["c", 30_000],
    ]);
    expect(sim.now()).toBe(60_000);
  });

  it("no dispara lo que queda más allá del destino", () => {
    const sim = new RelojSimulacion();
    const fn = vi.fn();
    sim.schedule(120, fn);
    sim.advance(60);
    expect(fn).not.toHaveBeenCalled();
    sim.advance(60);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("permite cancelar y respeta freeze/resume", () => {
    const sim = new RelojSimulacion();
    const fn = vi.fn();
    const cancelar = sim.schedule(10, fn);
    cancelar();
    sim.advance(60);
    expect(fn).not.toHaveBeenCalled();

    sim.freeze();
    sim.advance(60);
    expect(sim.now()).toBe(60_000);
    sim.resume();
    sim.advance(60);
    expect(sim.now()).toBe(120_000);
  });

  it("un callback agendado que reagenda se ejecuta dentro del mismo advance", () => {
    const sim = new RelojSimulacion();
    const t: number[] = [];
    const paso = () => {
      t.push(sim.now());
      if (t.length < 3) sim.schedule(10, paso);
    };
    sim.schedule(10, paso);
    sim.advance(60);
    expect(t).toEqual([10_000, 20_000, 30_000]);
  });

  it("rechaza retroceder y rechaza advance() reentrante", () => {
    const sim = new RelojSimulacion();
    expect(() => sim.advance(-1)).toThrow(/no retrocede/);
    sim.schedule(1, () => sim.advance(10));
    expect(() => sim.advance(5)).toThrow(/reentrante/);
  });

  it("correrHastaVacio agota la agenda", () => {
    const sim = new RelojSimulacion();
    const fn = vi.fn();
    sim.schedule(5, fn);
    sim.schedule(500, fn);
    sim.correrHastaVacio();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sim.pendientes).toBe(0);
  });
});
