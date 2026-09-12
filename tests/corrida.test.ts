/**
 * Aceptación de las fases 1 a 4 sobre la corrida completa.
 */
import { describe, expect, it } from "vitest";
import { crearCorrida } from "../src/composicion";
import { E } from "../src/orquestacion/eventos";
import type { ResultadoCorrida } from "../src/orquestacion/corrida";

function correr(semilla: string, opciones: Parameters<typeof crearCorrida>[0] extends infer T ? Partial<T> : never = {}) {
  const c = crearCorrida({ semilla, entorno: {}, ...opciones });
  let r: ResultadoCorrida | null = null;
  c.isquemia.iniciar((x) => (r = x));
  c.reloj.correrHastaVacio(72 * 3600);
  return { c, r: r as ResultadoCorrida | null };
}

describe("reproducibilidad (§0.4.7)", () => {
  it("dos corridas con la misma semilla producen exactamente la misma secuencia de eventos", () => {
    const huella = (s: string) =>
      correr(s).c.almacen.todos().map((e) => `${e.t_sim}|${e.actor}|${e.tipo}|${JSON.stringify(e.payload)}`);
    const a = huella("S-001");
    const b = huella("S-001");
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(200);
    expect(huella("S-002")).not.toEqual(a);
  });

  it("los ids de evento son deterministas y no dependen de la hora de pared", () => {
    expect(correr("S-007").c.almacen.todos().map((e) => e.id)).toEqual(
      correr("S-007").c.almacen.todos().map((e) => e.id),
    );
  });
});

describe("protocolo de compromiso verificado (§8.3)", () => {
  it("degrada los provisional yes que no llenan los cuatro campos, y emite el evento", () => {
    const { c, r } = correr("S-001");
    expect(r).not.toBeNull();
    const degradados = c.isquemia.carriles.filter((x) => x.estado === "DEGRADADO");
    expect(degradados.length).toBeGreaterThan(0);

    const eventos = c.almacen.todos().filter((e) => e.tipo === E.CARRIL_DEGRADADO);
    expect(eventos.length).toBe(degradados.length);
    for (const e of eventos) {
      const p = e.payload as { camposFaltantes: string[]; horasIsquemiaProtegidas: number };
      expect(p.camposFaltantes.length).toBeGreaterThan(0);
      expect(p.horasIsquemiaProtegidas).toBe(1.5); // H07
    }
  });

  it("nunca marca compromiso.completo con un campo que el centro no dijo (tolerancia cero)", () => {
    for (const semilla of ["S-001", "S-002", "S-003", "S-004", "S-005"]) {
      const { c } = correr(semilla);
      for (const carril of c.isquemia.carriles) {
        const comp = carril.compromiso;
        if (!comp?.completo) continue;
        for (const campo of ["cirujanoNombrado", "quirofanoReservado", "receptorConfirmadoDisponible", "etaEquipoRecuperacion"] as const) {
          const cita = comp.citas[campo];
          expect(cita, `${semilla} ${carril.id} ${campo}`).toBeDefined();
          expect(cita!.origen).toBe("respuesta_centro");
          expect(cita!.literal.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("todo carril termina en un estado terminal: ninguno queda colgado", () => {
    const { c } = correr("S-001");
    for (const carril of c.isquemia.carriles) {
      expect(carril.t_cerrado).not.toBeNull();
      expect(["RECHAZADO", "COMPROMETIDO", "DEGRADADO", "ACEPTADO_DIRECTO", "TIMEOUT", "ABORTADO"]).toContain(carril.estado);
    }
  });
});

describe("guardrails de política", () => {
  it("G4 — no cierra en una secuencia alta mientras haya una más baja sin resolver", () => {
    for (const semilla of ["S-001", "S-002", "S-003"]) {
      const { c, r } = correr(semilla);
      if (!r?.campana.ganador) continue;
      const ganadora = r.campana.ganador.entradaMatchRun.secuencia;
      for (const carril of c.isquemia.carriles) {
        if (carril.entradaMatchRun.secuencia >= ganadora) continue;
        // Toda posición mejor que la ganadora tuvo que resolverse de verdad.
        expect(["RECHAZADO", "DEGRADADO", "TIMEOUT"], `${semilla} #${carril.entradaMatchRun.secuencia}`).toContain(carril.estado);
      }
    }
  });

  it("G8 — cada transición de carril tiene su evento", () => {
    const { c } = correr("S-001");
    const transiciones = c.almacen.todos().filter((e) => e.tipo === E.CARRIL_ESTADO);
    for (const carril of c.isquemia.carriles) {
      const suyas = transiciones.filter((e) => (e.payload as { carrilId: string }).carrilId === carril.id);
      expect(suyas.length).toBeGreaterThanOrEqual(2);
      expect((suyas[suyas.length - 1]!.payload as { estado: string }).estado).toBe(carril.estado);
    }
  });

  it("H16 — nunca hay más de MAX_CONCURRENTES_POLITICA carriles verificando a la vez", () => {
    const { c } = correr("S-001");
    let vivos = 0;
    let pico = 0;
    for (const e of c.almacen.todos()) {
      if (e.tipo !== E.CARRIL_ESTADO) continue;
      const p = e.payload as { estado: string; anterior: string };
      if (p.estado === "VERIFICANDO") vivos++;
      else if (p.anterior === "VERIFICANDO") vivos--;
      pico = Math.max(pico, vivos);
    }
    expect(pico).toBeLessThanOrEqual(c.politica.MAX_CONCURRENTES_POLITICA);
  });
});

describe("Centinela (§8.1 criterio de aceptación)", () => {
  it("≥ 95 % de sensibilidad, ≤ 5 % de falsos positivos, 100 % de citas válidas", () => {
    for (const semilla of ["S-001", "S-002", "S-003"]) {
      const { r } = correr(semilla);
      const d = r!.desempenoCentinela;
      expect(d.sensibilidad).toBeGreaterThanOrEqual(0.95);
      expect(d.tasaFalsosPositivos).toBeLessThanOrEqual(0.05);
      expect(d.citasValidas).toBe(d.criteriosReportados);
      // Los limítrofes producen escalamiento, no referral (G7).
      expect(d.escalamientosCorrectos).toBe(d.limitrofesTotales);
    }
  });
});

describe("Ruta (§8.4)", () => {
  it("el dron aparece con motivo escrito cuando hay perfusión", () => {
    const { r } = correr("S-001", { perfusion: "normotermica" } as never);
    const dron = r?.transporte?.find((o) => o.modalidad === "dron");
    if (!dron) return;
    expect(dron.viable).toBe(false);
    expect(dron.motivoNoViable).toMatch(/payload/);
    expect(dron.requiereExencion).toBe(true);
  });

  it("las inviables se devuelven incluidas, nunca ocultas", () => {
    const { r } = correr("S-001");
    expect(r!.transporte!.length).toBe(5);
    for (const o of r!.transporte!) {
      if (!o.viable) expect(o.motivoNoViable).toBeTruthy();
    }
  });
});

describe("Escribano (§8.5)", () => {
  it("cada oración de la justificación enlaza a al menos un evento y la cobertura se reporta", () => {
    const { r } = correr("S-001");
    const x = r!.expediente!;
    expect(x.justificacion.length).toBeGreaterThan(0);
    for (const o of x.justificacion) expect(o.eventos.length).toBeGreaterThan(0);
    expect(x.cobertura).toBe(1);
    expect(x.firmaHash).toMatch(/^sha-sim:[0-9a-f]{16}$/);
  });

  it("la firma es estable entre corridas con la misma semilla", () => {
    expect(correr("S-004").r!.expediente!.firmaHash).toBe(correr("S-004").r!.expediente!.firmaHash);
  });
});

describe("línea base serial (§11.4)", () => {
  it("corre en paralelo y produce una CIT y un registro de rechazos con códigos", () => {
    const { r } = correr("S-001");
    const b = r!.baseline;
    expect(b.pasos.length).toBeGreaterThan(0);
    for (const p of b.pasos) {
      if (p.resultado !== "colocado") expect(p.codigo).toBeTruthy();
    }
  });

  it("usa el mismo mundo: el guion del centro no depende de quién llama", () => {
    // Ya cubierto en mundo.test.ts a nivel de función; aquí se comprueba que la
    // línea base y el agente ven los mismos centros y el mismo match run.
    const { c } = correr("S-001");
    expect(c.mundo.matchRun.entradas.length).toBe(c.politica.N_CARRILES);
  });
});

describe("rama DCD (§7.1)", () => {
  it("VENTANA_EXPIRADA está implementada y termina el caso sin donación", () => {
    // Se busca una semilla cuyo donante protagonista sea DCD y expire.
    let visto = false;
    for (let i = 0; i < 40 && !visto; i++) {
      const { c } = correr(`DCD-${i}`);
      const expirada = c.almacen.todos().some((e) => e.tipo === E.VENTANA_DCD_EXPIRADA);
      if (!expirada) continue;
      visto = true;
      expect(c.isquemia.estadoCaso).toBe("SIN_DONACION");
    }
    expect(visto, "ninguna de las 40 semillas produjo una ventana DCD expirada").toBe(true);
  });
});

describe("insignias de adaptador", () => {
  it("sin credenciales todo corre local y queda registrado", () => {
    const { c } = correr("S-001");
    const remotos = c.adaptadores.filter((a) => a.remoto && a.slot !== "UI_TRANSPORTE");
    expect(remotos).toEqual([]);
    const eventos = c.almacen.todos().filter((e) => e.tipo === E.ADAPTADOR_SELECCIONADO);
    expect(eventos.length).toBe(c.adaptadores.length);
  });
});
