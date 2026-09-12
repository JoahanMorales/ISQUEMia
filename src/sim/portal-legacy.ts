/**
 * §11.5 — portal legacy falso. No es bonito a propósito.
 *
 * Tres comportamientos obligatorios: la sesión expira a los 8 minutos sim,
 * un campo obligatorio está etiquetado de forma confusa, y la respuesta tarda
 * entre 2 y 9 segundos. Es el argumento visible de por qué hace falta un
 * agente y no una API.
 */

import type { Aleatorio } from "../domain/aleatorio";
import type { Reloj } from "../domain/puertos";

export const EXPIRACION_SESION_S = 8 * 60;

export class SesionExpirada extends Error {
  constructor() {
    super("Your session has timed out. Please sign in again. (Ref: DN-0x8)");
    this.name = "SesionExpirada";
  }
}

export class CampoObligatorioFaltante extends Error {
  constructor(readonly campo: string) {
    super(`Field "${campo}" is required.`);
    this.name = "CampoObligatorioFaltante";
  }
}

/**
 * El campo obligatorio mal etiquetado: el portal lo llama "Recipient Center
 * Contact Ref." pero en realidad quiere el número de secuencia del match run.
 * Un humano nuevo lo llena mal la primera vez; un agente tiene que descubrirlo.
 */
export const CAMPO_CONFUSO = "Recipient Center Contact Ref.";

export interface FormularioPortal {
  ["Donor ID"]?: string;
  ["Organ"]?: string;
  [CAMPO_CONFUSO]?: string;
  ["Response"]?: string;
}

export interface ResultadoPortal {
  ok: boolean;
  latencia_s: number;
  mensaje: string;
  reintentos: number;
}

export class PortalLegacy {
  #abiertaEn = new Map<string, number>();

  constructor(
    private reloj: Reloj,
    private azar: Aleatorio,
  ) {}

  abrirSesion(carrilId: string): void {
    this.#abiertaEn.set(carrilId, this.reloj.now());
  }

  sesionViva(carrilId: string): boolean {
    const t = this.#abiertaEn.get(carrilId);
    if (t === undefined) return false;
    return (this.reloj.now() - t) / 1000 < EXPIRACION_SESION_S;
  }

  /** Latencia realista del portal: 2 a 9 segundos, siempre. */
  latencia(): number {
    return Number(this.azar.rango(2, 9).toFixed(2));
  }

  enviar(carrilId: string, form: FormularioPortal): ResultadoPortal {
    const latencia_s = this.latencia();
    if (!this.sesionViva(carrilId)) {
      throw new SesionExpirada();
    }
    const secuencia = form[CAMPO_CONFUSO];
    if (!secuencia || !/^\d+$/.test(secuencia)) {
      throw new CampoObligatorioFaltante(CAMPO_CONFUSO);
    }
    return { ok: true, latencia_s, mensaje: "Response recorded.", reintentos: 0 };
  }
}
