/**
 * Fase 1 · aceptación:
 *  - dos corridas con la misma semilla producen exactamente la misma secuencia.
 *  - el centro no sabe quién lo contacta.
 */
import { describe, expect, it } from "vitest";
import { crearAleatorio } from "../src/domain/aleatorio";
import { RelojSimulacion } from "../src/sim/reloj";
import { Mundo } from "../src/sim/mundo";
import { construirOferta, generarGuion, semillaComportamiento } from "../src/sim/donornet";
import { compatibleABO, generarMatchRun, puntuarCandidato } from "../src/sim/match-run";
import { CAMPO_CONFUSO, PortalLegacy, SesionExpirada, CampoObligatorioFaltante } from "../src/sim/portal-legacy";
import { generarConjuntoUci } from "../src/sim/generadores";

const mundoDe = (semilla: string) => new Mundo({ semilla, reloj: new RelojSimulacion() });

describe("simulador de mundo (§11)", () => {
  it("40 centros con la distribución de volumen de §10.4", () => {
    const m = mundoDe("S-001");
    expect(m.centros).toHaveLength(40);
    expect(m.centros.filter((c) => c.volumenAnual > 200)).toHaveLength(5);
    expect(m.centros.filter((c) => c.volumenAnual >= 50 && c.volumenAnual <= 200)).toHaveLength(15);
    expect(m.centros.filter((c) => c.volumenAnual < 50)).toHaveLength(20);
  });

  it("todo identificador es sintético (G1)", () => {
    const m = mundoDe("S-001");
    for (const c of m.centros) expect(c.id.startsWith("SYN-")).toBe(true);
    for (const d of m.donantes) expect(d.id.startsWith("SYN-")).toBe(true);
    expect(m.organo.id.startsWith("SYN-")).toBe(true);
    for (const p of m.uci) expect(p.id.startsWith("SYN-")).toBe(true);
  });

  it("el conjunto de UCI tiene los conteos etiquetados de §10.2", () => {
    const uci = generarConjuntoUci(crearAleatorio("S-001"));
    expect(uci).toHaveLength(200);
    const por = (c: string) => uci.filter((p) => p.clase === c).length;
    expect(por("positivo_claro")).toBe(30);
    expect(por("positivo_dcd")).toBe(20);
    expect(por("positivo_limitrofe")).toBe(15);
    expect(por("negativo_obvio")).toBe(100);
    expect(por("negativo_tramposo")).toBe(35);
    // Los tramposos tienen Glasgow bajo pero ningún criterio verdadero.
    const tramposos = uci.filter((p) => p.clase === "negativo_tramposo");
    expect(tramposos.every((p) => p.criteriosVerdaderos.length === 0)).toBe(true);
    expect(tramposos.every((p) => p.notas.length > 0)).toBe(true);
  });

  it("el match run es determinista, sin repetir centro y ABO-compatible", () => {
    const m = mundoDe("S-001");
    const secuencias = m.matchRun.entradas.map((e) => e.secuencia);
    expect(secuencias).toEqual(secuencias.map((_, i) => i + 1));
    expect(new Set(m.matchRun.entradas.map((e) => e.centroId)).size).toBe(m.matchRun.entradas.length);
    for (const e of m.matchRun.entradas) {
      expect(compatibleABO(m.donante.grupoSanguineo, m.candidato(e.candidatoId).grupoSanguineo)).toBe(true);
    }
  });

  it("el match run es inmutable tras generarse (G4)", () => {
    const m = mundoDe("S-001");
    expect(Object.isFrozen(m.matchRun)).toBe(true);
    expect(() => {
      (m.matchRun.entradas as unknown[]).push({});
    }).toThrow();
  });

  it("el puntaje del match run es explícito y reproducible", () => {
    const m = mundoDe("S-001");
    const c = m.candidato(m.matchRun.entradas[0]!.candidatoId);
    const a = puntuarCandidato(c, m.donante, m.organo);
    const b = puntuarCandidato(c, m.donante, m.organo);
    expect(a.puntaje).toBe(b.puntaje);
    expect(Object.keys(a.factores).sort()).toEqual([
      "compatibilidadKdpi",
      "sensibilizacion",
      "tiempoEnLista",
      "urgencia",
    ]);
  });

  it("misma semilla ⇒ mundo idéntico; semilla distinta ⇒ mundo distinto", () => {
    const huella = (s: string) => {
      const m = mundoDe(s);
      return JSON.stringify({
        donante: m.donante,
        centros: m.centros,
        matchRun: m.matchRun.entradas,
        uci: m.uci.length,
      });
    };
    expect(huella("S-001")).toEqual(huella("S-001"));
    expect(huella("S-001")).not.toEqual(huella("S-002"));
  });
});

describe("regla de oro: el centro no sabe quién lo contacta (§11.3)", () => {
  it("generarGuion no acepta ningún parámetro que identifique al llamante", () => {
    // Si alguien añade un parámetro tipo `llamante`, este test falla y la
    // comparación agente vs. línea base deja de ser honesta.
    const nombres = generarGuion
      .toString()
      .slice(generarGuion.toString().indexOf("(") + 1, generarGuion.toString().indexOf(")"))
      .split(",")
      .map((s) => s.trim().split(/[:=]/)[0]!.trim())
      .filter(Boolean);
    expect(nombres).toEqual([
      "centro",
      "oferta",
      "candidatoGrupo",
      "candidatoAceptaDcd",
      "candidatoKdpiMaximo",
      "semillaBase",
    ]);
  });

  it("el agente y la línea base obtienen exactamente el mismo guion", () => {
    const m = mundoDe("S-001");
    const entrada = m.matchRun.entradas[3]!;
    const centro = m.centro(entrada.centroId);
    const cand = m.candidato(entrada.candidatoId);
    const oferta = construirOferta(m.donante, m.organo, entrada.secuencia, 2.5, 6.1, 9_000_000);
    const semilla = semillaComportamiento(m.semilla, m.organo.id, centro.id, 0);

    const comoAgente = generarGuion(centro, oferta, cand.grupoSanguineo, cand.aceptaDCD, cand.kdpiMaximoAceptado, semilla);
    const comoHumano = generarGuion(centro, oferta, cand.grupoSanguineo, cand.aceptaDCD, cand.kdpiMaximoAceptado, semilla);
    expect(comoAgente).toEqual(comoHumano);
  });

  it("el guion respeta las reglas duras antes que el azar", () => {
    const m = mundoDe("S-003");
    const entrada = m.matchRun.entradas[0]!;
    const centro = m.centro(entrada.centroId);
    const cand = m.candidato(entrada.candidatoId);
    // CIT proyectada absurda ⇒ LOG_CIT_TOO_LONG, el rechazo más frecuente (H01).
    const oferta = construirOferta(m.donante, m.organo, 1, 20, 99, 0);
    const g = generarGuion(centro, oferta, cand.grupoSanguineo, cand.aceptaDCD, cand.kdpiMaximoAceptado, "x");
    expect(g.decision).toBe("rechazo");
    expect(g.codigoRechazo).toBe("LOG_CIT_TOO_LONG");
    expect(g.reglaDura).toMatch(/CIT proyectada/);
  });

  it("un provisional yes incompleto deja campos faltantes (H05)", () => {
    const m = mundoDe("S-001");
    let vistos = 0;
    let incompletos = 0;
    for (const entrada of m.matchRun.entradas) {
      const centro = m.centro(entrada.centroId);
      const cand = m.candidato(entrada.candidatoId);
      const oferta = construirOferta(m.donante, m.organo, entrada.secuencia, 1, 4, 0);
      const g = generarGuion(
        centro, oferta, cand.grupoSanguineo, cand.aceptaDCD, cand.kdpiMaximoAceptado,
        semillaComportamiento(m.semilla, m.organo.id, centro.id, 0),
      );
      if (g.decision !== "provisional") continue;
      vistos++;
      if (!g.completara) {
        incompletos++;
        expect(g.camposFaltantes.length).toBeGreaterThan(0);
        expect(g.camposRevelados.length + g.camposFaltantes.length).toBe(4);
      }
    }
    expect(vistos).toBeGreaterThan(0);
    // H05: la mayoría de los provisional yes no llegan a compromiso completo.
    expect(incompletos / vistos).toBeGreaterThan(0.4);
  });
});

describe("portal legacy (§11.5)", () => {
  it("la sesión expira a los 8 minutos sim", () => {
    const reloj = new RelojSimulacion();
    const portal = new PortalLegacy(reloj, crearAleatorio("p"));
    portal.abrirSesion("c1");
    reloj.advance(7 * 60);
    expect(portal.sesionViva("c1")).toBe(true);
    reloj.advance(2 * 60);
    expect(portal.sesionViva("c1")).toBe(false);
    expect(() => portal.enviar("c1", { [CAMPO_CONFUSO]: "3" })).toThrow(SesionExpirada);
  });

  it("el campo obligatorio mal etiquetado rechaza lo que un humano pondría", () => {
    const reloj = new RelojSimulacion();
    const portal = new PortalLegacy(reloj, crearAleatorio("p"));
    portal.abrirSesion("c1");
    // Un humano nuevo pone el nombre del contacto; el portal quiere la secuencia.
    expect(() => portal.enviar("c1", { [CAMPO_CONFUSO]: "Dr. Lee" })).toThrow(CampoObligatorioFaltante);
    expect(portal.enviar("c1", { [CAMPO_CONFUSO]: "7" }).ok).toBe(true);
  });

  it("la respuesta tarda entre 2 y 9 segundos", () => {
    const portal = new PortalLegacy(new RelojSimulacion(), crearAleatorio("p"));
    for (let i = 0; i < 200; i++) {
      const l = portal.latencia();
      expect(l).toBeGreaterThanOrEqual(2);
      expect(l).toBeLessThanOrEqual(9);
    }
  });
});
