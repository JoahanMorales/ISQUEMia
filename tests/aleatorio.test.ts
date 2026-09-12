/**
 * §5.2 principio 4 — determinismo por semilla.
 */
import { describe, expect, it } from "vitest";
import { crearAleatorio } from "../src/domain/aleatorio";

describe("generador sembrado", () => {
  it("misma semilla, misma secuencia", () => {
    const a = crearAleatorio("S-001");
    const b = crearAleatorio("S-001");
    const c = crearAleatorio("S-002");
    const sa = Array.from({ length: 8 }, () => a.uniforme());
    const sb = Array.from({ length: 8 }, () => b.uniforme());
    const sc = Array.from({ length: 8 }, () => c.uniforme());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it("las derivaciones son independientes y reproducibles", () => {
    const raiz = () => crearAleatorio("S-001");
    expect(raiz().derivar("centros").uniforme()).toBe(raiz().derivar("centros").uniforme());
    expect(raiz().derivar("centros").uniforme()).not.toBe(raiz().derivar("uci").uniforme());
  });

  it("categorico respeta los pesos dentro de una tolerancia", () => {
    const a = crearAleatorio("S-pesos");
    const conteo: Record<string, number> = { x: 0, y: 0 };
    for (let i = 0; i < 20_000; i++) conteo[a.categorico({ x: 0.8, y: 0.2 })]!++;
    expect(conteo.x! / 20_000).toBeGreaterThan(0.78);
    expect(conteo.x! / 20_000).toBeLessThan(0.82);
  });

  it("bernoulli respeta p", () => {
    const a = crearAleatorio("S-h05");
    let n = 0;
    for (let i = 0; i < 20_000; i++) if (a.bernoulli(0.7)) n++;
    expect(n / 20_000).toBeCloseTo(0.7, 2);
  });
});
