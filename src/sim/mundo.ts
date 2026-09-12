/**
 * §11 — el simulador de mundo. Sin acceso a DonorNet, esto *es* el mundo.
 *
 * Reúne: reloj, UCI sintética, donantes, 40 centros calibrados, candidatos,
 * match run auditable, DonorNet falso, portal legacy y tablas de transporte.
 * Todo determinista a partir de una sola semilla.
 */

import { crearAleatorio, type Aleatorio } from "../domain/aleatorio";
import { citLimiteEfectivo_h } from "../domain/politica";
import type { Candidato, Centro, Donante, Organo, Perfusion, TipoOrgano } from "../domain/tipos";
import {
  generarCandidatos,
  generarCentros,
  generarConjuntoUci,
  generarDonantes,
  generarOrgano,
  type PacienteUci,
} from "./generadores";
import { generarMatchRun, type MatchRun } from "./match-run";
import { PortalLegacy } from "./portal-legacy";
import { RelojSimulacion } from "./reloj";
import { condiciones, millas, type CondicionesTramo, type Coordenada } from "./transporte";

export interface OpcionesMundo {
  semilla: string;
  reloj: RelojSimulacion;
  /** Órgano de la campaña. Por defecto hígado: reloj apretado pero no imposible. */
  tipoOrgano?: TipoOrgano;
  perfusion?: Perfusion | null;
  nCentros?: number;
  /** Índice del donante del catálogo que protagoniza la corrida. */
  indiceDonante?: number;
}

export class Mundo {
  readonly semilla: string;
  readonly reloj: RelojSimulacion;
  readonly azar: Aleatorio;

  readonly uci: PacienteUci[];
  readonly donantes: Donante[];
  readonly centros: Centro[];
  readonly candidatos: Candidato[];

  readonly donante: Donante;
  readonly organo: Organo;
  readonly matchRun: MatchRun;
  readonly hospital: Coordenada;
  readonly portal: PortalLegacy;

  #centroPorId = new Map<string, Centro>();
  #candidatoPorId = new Map<string, Candidato>();

  constructor(opciones: OpcionesMundo) {
    this.semilla = opciones.semilla;
    this.reloj = opciones.reloj;
    this.azar = crearAleatorio(opciones.semilla);

    const tipo: TipoOrgano = opciones.tipoOrgano ?? "higado";
    const nCentros = opciones.nCentros ?? 40;

    this.uci = generarConjuntoUci(this.azar);
    this.donantes = generarDonantes(this.azar);
    this.centros = generarCentros(this.azar, tipo, nCentros);
    this.candidatos = generarCandidatos(this.azar, this.centros);

    for (const c of this.centros) this.#centroPorId.set(c.id, c);
    for (const c of this.candidatos) this.#candidatoPorId.set(c.id, c);

    this.donante = this.donantes[opciones.indiceDonante ?? 0]!;
    this.organo = generarOrgano(this.donante, tipo, opciones.perfusion ?? null);
    this.matchRun = generarMatchRun(this.candidatos, this.donante, this.organo, nCentros);

    const h = this.azar.derivar("hospital");
    this.hospital = { lat: 39.1 + h.rango(-3, 3), lon: -94.6 + h.rango(-6, 6) };
    this.portal = new PortalLegacy(this.reloj, this.azar.derivar("portal"));
  }

  centro(id: string): Centro {
    const c = this.#centroPorId.get(id);
    if (!c) throw new Error(`centro desconocido: ${id}`);
    return c;
  }

  candidato(id: string): Candidato {
    const c = this.#candidatoPorId.get(id);
    if (!c) throw new Error(`candidato desconocido: ${id}`);
    return c;
  }

  /** Límite de isquemia efectivo del órgano de la campaña, con perfusión aplicada. */
  citLimite_h(): number {
    return citLimiteEfectivo_h(this.organo.tipo, this.organo.perfusion);
  }

  /** §6.2 — la CIT transcurrida se deriva, nunca se almacena. */
  citTranscurrido_h(): number {
    if (this.organo.t_crossClamp === null) return 0;
    return (this.reloj.now() - this.organo.t_crossClamp) / 3_600_000;
  }

  distancia_mi(centroId: string): number {
    return millas(this.hospital, this.centro(centroId));
  }

  condicionesHacia(centroId: string): CondicionesTramo {
    return condiciones(this.semilla, this.hospital, this.centro(centroId), centroId);
  }

  /**
   * Tiempo estimado de traslado por la vía más plausible, usado para proyectar
   * la CIT al implante cuando aún no hay plan de transporte.
   */
  citProyectada_h(centroId: string, desde_h = this.citTranscurrido_h()): number {
    const d = this.distancia_mi(centroId);
    const traslado_h = d < 120 ? d / 55 : d < 400 ? d / 145 + 1.8 : d / 430 + 3.2;
    return desde_h + traslado_h + 1.2; // 1.2 h de quirófano y preparación
  }
}
