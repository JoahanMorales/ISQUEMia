/**
 * §8.2 — DESPACHADOR. Convierte un match run en una campaña de carriles y
 * decide cuándo cerrar.
 *
 * Guardrail G4: no reordena el match run jamás. Solo puede saltarse posiciones
 * marcando AOOS explícitamente, con justificación y evento auditable.
 */

import type { Politica } from "../domain/politica";
import type { MotorCarriles, Observabilidad, Reloj, RouterModelos } from "../domain/puertos";
import type { Registrador } from "../domain/registro";
import type { Carril, CodigoRechazo, Modalidad } from "../domain/tipos";
import { construirOferta, generarGuion, semillaComportamiento } from "../sim/donornet";
import type { Mundo } from "../sim/mundo";
import { EjecutorCarril, type DepsCarril } from "./carril";
import { E } from "./eventos";

export interface ResultadoCampana {
  carriles: Carril[];
  ganador: Carril | null;
  /** Secuencia del match run en la que se colocó, o null. */
  secuenciaFinal: number | null;
  aoos: boolean;
  t_primerCompromiso: number | null;
  t_cierre: number | null;
  degradaciones: number;
  provisionalYesTotales: number;
  ofertasEmitidas: number;
  horasProtegidas: number;
  citFinal_h: number | null;
}

export interface OpcionesDespachador {
  mundo: Mundo;
  reloj: Reloj;
  registro: Registrador;
  motor: MotorCarriles;
  obs: Observabilidad;
  politica: Politica;
  modelos: RouterModelos;
  triage: DepsCarril["triage"];
  /** §5.3 — los K primeros carriles por secuencia usan voz. */
  kVoz?: number;
}

export class Despachador {
  readonly ejecutores = new Map<string, EjecutorCarril>();
  #o: OpcionesDespachador;
  #deps: DepsCarril;
  #cerrada = false;
  #ganador: Carril | null = null;
  #comprometidos: Carril[] = [];
  #t_primerCompromiso: number | null = null;
  #t_cierre: number | null = null;
  #degradaciones = 0;
  #provisionalYes = 0;
  #terminados: Carril[] = [];
  #horasProtegidas = 0;
  #alCerrar: ((r: ResultadoCampana) => void) | null = null;

  constructor(opciones: OpcionesDespachador) {
    this.#o = opciones;
    this.#deps = {
      reloj: opciones.reloj,
      registro: opciones.registro,
      motor: opciones.motor,
      obs: opciones.obs,
      politica: opciones.politica,
      modelos: opciones.modelos,
      triage: opciones.triage,
    };
  }

  /** Abre la campaña completa. Devuelve cuando todos los carriles cerraron. */
  abrir(alCerrar: (r: ResultadoCampana) => void): void {
    this.#alCerrar = alCerrar;
    const { mundo, politica } = this.#o;
    const kVoz = this.#o.kVoz ?? politica.K_VOZ;
    const entradas = mundo.matchRun.entradas.slice(0, politica.N_CARRILES);

    this.#o.registro.emitir("despachador", E.CAMPANA_ABIERTA, {
      organoId: mundo.organo.id,
      tipo: mundo.organo.tipo,
      nCarriles: entradas.length,
      maxConcurrentesCompromiso: politica.MAX_CONCURRENTES_POLITICA,
      kVoz,
      citLimite_h: mundo.citLimite_h(),
    });

    for (const entrada of entradas) {
      const centro = mundo.centro(entrada.centroId);
      const candidato = mundo.candidato(entrada.candidatoId);
      const modalidad: Modalidad =
        entrada.secuencia <= kVoz ? "voz" : entrada.secuencia % 3 === 0 ? "portal" : "mensajeria";

      const citActual = mundo.citTranscurrido_h();
      const citProyectada = mundo.citProyectada_h(centro.id);
      const oferta = construirOferta(
        mundo.donante, mundo.organo, entrada.secuencia, citActual, citProyectada, this.#o.reloj.now(),
      );
      const guion = generarGuion(
        centro, oferta, candidato.grupoSanguineo, candidato.aceptaDCD, candidato.kdpiMaximoAceptado,
        semillaComportamiento(mundo.semilla, mundo.organo.id, centro.id, 0),
      );
      if (guion.decision === "provisional") this.#provisionalYes++;

      const id = `L${String(entrada.secuencia).padStart(2, "0")}`;
      const ejecutor = new EjecutorCarril({
        id,
        organoId: mundo.organo.id,
        entrada,
        modalidad,
        centro,
        oferta,
        guion,
        deps: this.#deps,
        alTerminar: (r) => this.#alTerminarCarril(r.carril, r.horasProtegidas),
      });
      this.ejecutores.set(id, ejecutor);
      // Nivel 1: todas las evaluaciones abiertas a la vez.
      this.#o.motor.abrirEvaluacion(id, () => ejecutor.arrancar());
    }
  }

  #alTerminarCarril(carril: Carril, horasProtegidas: number): void {
    this.#terminados.push(carril);
    this.#horasProtegidas += horasProtegidas;
    if (carril.estado === "DEGRADADO") {
      this.#degradaciones++;
      // §8.2: cuando un carril se degrada, el siguiente avanza. Sin esperar.
      // Eso lo hace el motor al liberar el slot; aquí solo se deja constancia.
      this.#o.registro.emitir("despachador", E.CONCURRENCIA_CAMBIO, {
        motivo: "degradacion",
        carrilId: carril.id,
        compromisosVivos: this.#o.motor.compromisosVivos,
        enCola: this.#o.motor.enColaDeCompromiso,
      });
    }

    const exito = carril.estado === "COMPROMETIDO" || carril.estado === "ACEPTADO_DIRECTO";
    if (exito) {
      this.#comprometidos.push(carril);
      this.#t_primerCompromiso ??= carril.compromiso?.t_verificado ?? this.#o.reloj.now();
    }

    if (this.#cerrada) return;
    this.#intentarCerrarPorSecuencia();

    if (this.#terminados.length === this.ejecutores.size && !this.#cerrada) {
      this.#elegirGanador();
      this.#cerrar(this.#ganador ? "compromiso_verificado" : "sin_colocacion");
    }
  }

  /**
   * G4 — la frontera de secuencia.
   *
   * Un compromiso verificado en la posición #38 **no** cierra la colocación
   * mientras la #3 siga viva: aceptarlo sería saltarse el match run, que es
   * exactamente lo que la política de OPTN prohíbe y lo que AOOS existe para
   * documentar. La campaña cierra cuando el mejor compromiso verificado no
   * tiene por encima ninguna posición sin resolver.
   *
   * Esto es también lo que hace honesta la comparación: el agente gana por
   * resolver las posiciones bajas *rápido*, no por colarse a una alta.
   */
  #intentarCerrarPorSecuencia(): void {
    if (this.#comprometidos.length === 0) return;
    const mejor = this.#mejorComprometido()!;
    const pendientePorEncima = [...this.ejecutores.values()].some(
      (e) => e.carril.t_cerrado === null && e.carril.entradaMatchRun.secuencia < mejor.entradaMatchRun.secuencia,
    );
    if (pendientePorEncima) return;
    this.#ganador = mejor;
    this.#cerrar("compromiso_verificado");
  }

  #mejorComprometido(): Carril | null {
    if (this.#comprometidos.length === 0) return null;
    return this.#comprometidos.reduce((a, b) =>
      a.entradaMatchRun.secuencia <= b.entradaMatchRun.secuencia ? a : b,
    );
  }

  #elegirGanador(): void {
    this.#ganador ??= this.#mejorComprometido();
  }

  /** §8.2 — recalcula la CIT proyectada y descarta lo que ya no cabe. */
  marcarInviablesPorCit(): number {
    const limite = this.#o.mundo.citLimite_h();
    let marcados = 0;
    for (const [id, ejecutor] of this.ejecutores) {
      const carril = ejecutor.carril;
      if (carril.t_cerrado !== null) continue;
      const proyectada = this.#o.mundo.citProyectada_h(carril.entradaMatchRun.centroId);
      if (proyectada <= limite) continue;
      const codigo: CodigoRechazo = "LOG_CIT_TOO_LONG"; // H01, el rechazo #1
      this.#o.registro.emitir("despachador", E.CARRIL_RECHAZADO, {
        carrilId: id,
        centroId: carril.entradaMatchRun.centroId,
        codigo,
        literal: `Projected CIT ${proyectada.toFixed(1)} h exceeds limit ${limite.toFixed(1)} h`,
        origen: "despachador",
        secuencia: carril.entradaMatchRun.secuencia,
      });
      ejecutor.abortar(`inviable por ${codigo}`);
      marcados++;
    }
    return marcados;
  }

  #cerrar(motivo: string): void {
    if (this.#cerrada) return;
    this.#cerrada = true;
    this.#t_cierre = this.#o.reloj.now();

    for (const ejecutor of this.ejecutores.values()) {
      if (ejecutor.carril.t_cerrado === null) ejecutor.abortar("colocación cerrada");
    }

    // Compromisos verificados que no se usaron porque había una posición mejor.
    for (const c of this.#comprometidos) {
      if (c === this.#ganador) continue;
      this.#o.registro.emitir("despachador", E.CONCURRENCIA_CAMBIO, {
        motivo: "compromiso_no_utilizado",
        carrilId: c.id,
        secuencia: c.entradaMatchRun.secuencia,
        ganadora: this.#ganador?.entradaMatchRun.secuencia ?? null,
      });
    }

    const secuenciaFinal = this.#ganador?.entradaMatchRun.secuencia ?? null;
    const aoos = secuenciaFinal !== null && secuenciaFinal > this.#o.politica.UMBRAL_SECUENCIA_AOOS;
    if (aoos) {
      this.#o.registro.emitir("despachador", E.AOOS_MARCADO, {
        secuencia: secuenciaFinal,
        umbral: this.#o.politica.UMBRAL_SECUENCIA_AOOS,
        justificacionRequerida: true,
      });
    }

    const carriles = [...this.ejecutores.values()].map((e) => e.carril);
    this.#o.registro.emitir("despachador", E.CAMPANA_CERRADA, {
      motivo,
      secuenciaFinal,
      aoos,
      ofertasEmitidas: carriles.filter((c) => c.intentos > 0).length,
      degradaciones: this.#degradaciones,
      provisionalYesTotales: this.#provisionalYes,
      horasProtegidas: this.#horasProtegidas,
    });

    this.#alCerrar?.({
      carriles,
      ganador: this.#ganador,
      secuenciaFinal,
      aoos,
      t_primerCompromiso: this.#t_primerCompromiso,
      t_cierre: this.#t_cierre,
      degradaciones: this.#degradaciones,
      provisionalYesTotales: this.#provisionalYes,
      ofertasEmitidas: carriles.filter((c) => c.intentos > 0).length,
      horasProtegidas: this.#horasProtegidas,
      citFinal_h: this.#ganador ? this.#o.mundo.citProyectada_h(this.#ganador.entradaMatchRun.centroId) : null,
    });
  }
}
