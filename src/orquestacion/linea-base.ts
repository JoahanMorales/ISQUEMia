/**
 * §11.4 — línea base serial. Obligatoria.
 *
 * Corre el mismo caso, con la misma semilla y los mismos perfiles de centro,
 * bajo política humana: un carril a la vez, orden estricto, acepta el
 * provisional yes al pie de la letra y **espera** el resultado.
 *
 * La diferencia entre esta corrida y la del agente es el producto. Que salga de
 * la misma semilla es lo que la hace creíble.
 */

import type { Politica } from "../domain/politica";
import type { Reloj } from "../domain/puertos";
import type { Registrador } from "../domain/registro";
import type { CodigoRechazo } from "../domain/tipos";
import { construirOferta, generarGuion, semillaComportamiento } from "../sim/donornet";
import type { Mundo } from "../sim/mundo";
import { E } from "./eventos";

export interface PasoBaseline {
  secuencia: number;
  centroId: string;
  centroNombre: string;
  t_inicio: number;
  t_fin: number;
  resultado: "rechazo" | "rechazo_tardio" | "colocado";
  codigo: CodigoRechazo | null;
}

export interface ResultadoBaseline {
  pasos: PasoBaseline[];
  secuenciaFinal: number | null;
  t_colocacion: number | null;
  cit_h: number | null;
  ofertasEmitidas: number;
  /** Provisional yes que el humano aceptó y que terminaron en rechazo tardío. */
  rechazosTardios: number;
}

export interface OpcionesBaseline {
  mundo: Mundo;
  reloj: Reloj;
  registro: Registrador;
  politica: Politica;
}

/**
 * Estado observable mientras corre, para el cintillo inferior de P1: la línea
 * base tiene su propia posición y su propio reloj, visibles en paralelo.
 */
export interface EstadoBaseline {
  secuenciaActual: number;
  t_sim: number;
  cit_h: number;
  estado: "corriendo" | "colocado" | "agotado";
  ofertas: number;
}

export class LineaBaseSerial {
  #o: OpcionesBaseline;
  #pasos: PasoBaseline[] = [];
  #indice = 0;
  #rechazosTardios = 0;
  #t_offset: number;
  #alTerminar: ((r: ResultadoBaseline) => void) | null = null;
  #terminado = false;

  constructor(opciones: OpcionesBaseline) {
    this.#o = opciones;
    this.#t_offset = opciones.reloj.now();
  }

  get estado(): EstadoBaseline {
    const t = this.#o.reloj.now();
    return {
      secuenciaActual: this.#indice + 1,
      t_sim: t,
      cit_h: this.#o.mundo.citTranscurrido_h(),
      estado: this.#terminado ? (this.#colocado() ? "colocado" : "agotado") : "corriendo",
      ofertas: this.#pasos.length,
    };
  }

  #colocado(): boolean {
    return this.#pasos.some((p) => p.resultado === "colocado");
  }

  arrancar(alTerminar: (r: ResultadoBaseline) => void): void {
    this.#alTerminar = alTerminar;
    this.#siguiente();
  }

  #siguiente(): void {
    const { mundo, politica, reloj, registro } = this.#o;
    const entradas = mundo.matchRun.entradas;
    if (this.#indice >= entradas.length) return this.#terminar();

    const entrada = entradas[this.#indice]!;
    const centro = mundo.centro(entrada.centroId);
    const candidato = mundo.candidato(entrada.candidatoId);
    const t_inicio = reloj.now();

    // Mismo mundo, misma semilla, mismo guion: el centro no sabe quién llama.
    const oferta = construirOferta(
      mundo.donante, mundo.organo, entrada.secuencia,
      (t_inicio - this.#t_offset) / 3_600_000 + mundo.citTranscurrido_h(),
      mundo.citProyectada_h(centro.id), t_inicio,
    );
    const guion = generarGuion(
      centro, oferta, candidato.grupoSanguineo, candidato.aceptaDCD, candidato.kdpiMaximoAceptado,
      semillaComportamiento(mundo.semilla, mundo.organo.id, centro.id, 0),
    );

    registro.emitir("humano", E.BASELINE_CARRIL_ABIERTO, {
      secuencia: entrada.secuencia,
      centroId: centro.id,
      centroNombre: centro.nombre,
    });

    // Latencia del operador humano: 90 s entre carriles, 1.5× de madrugada.
    const horas = (t_inicio / 3_600_000) % 24;
    const multiplicador = horas >= 0 && horas < 6 ? politica.BASELINE_MULTIPLICADOR_NOCTURNO : 1;
    const latenciaOperador = politica.BASELINE_LATENCIA_ENTRE_CARRILES_s * multiplicador;

    // Espera la respuesta del centro. Si es provisional, la acepta al pie de la
    // letra y espera el desenlace — que con p = 0.70 es un rechazo tardío 1.5 h
    // después. Ese es exactamente el costo que el agente evita.
    let espera = guion.latenciaPrimeraRespuesta_s + latenciaOperador;
    let resultado: PasoBaseline["resultado"] = "rechazo";
    let codigo: CodigoRechazo | null = guion.codigoRechazo;

    if (guion.decision === "provisional") {
      if (guion.completara) {
        resultado = "colocado";
        codigo = null;
        espera += guion.retrasoRechazoTardio_s * 0.4; // confirmación, más corta
      } else {
        resultado = "rechazo_tardio";
        codigo = "LOG_RESOURCE_TIME_CONSTRAINT";
        espera += guion.retrasoRechazoTardio_s; // H07 — 1.5 h en promedio
        this.#rechazosTardios++;
      }
    } else if (guion.decision === "aceptacion_directa") {
      resultado = "colocado";
      codigo = null;
    }

    reloj.schedule(espera, () => {
      const t_fin = reloj.now();
      this.#pasos.push({
        secuencia: entrada.secuencia,
        centroId: centro.id,
        centroNombre: centro.nombre,
        t_inicio,
        t_fin,
        resultado,
        codigo,
      });
      registro.emitir("humano", E.BASELINE_CARRIL_CERRADO, {
        secuencia: entrada.secuencia,
        centroId: centro.id,
        resultado,
        codigo,
        duracion_s: (t_fin - t_inicio) / 1000,
      });
      if (resultado === "colocado") return this.#terminar();
      this.#indice++;
      this.#siguiente();
    });
  }

  #terminar(): void {
    if (this.#terminado) return;
    this.#terminado = true;
    const colocado = this.#pasos.find((p) => p.resultado === "colocado") ?? null;
    const r: ResultadoBaseline = {
      pasos: this.#pasos,
      secuenciaFinal: colocado?.secuencia ?? null,
      t_colocacion: colocado?.t_fin ?? null,
      cit_h: colocado ? this.#o.mundo.citProyectada_h(colocado.centroId, (colocado.t_fin - this.#t_offset) / 3_600_000) : null,
      ofertasEmitidas: this.#pasos.length,
      rechazosTardios: this.#rechazosTardios,
    };
    this.#o.registro.emitir("humano", E.BASELINE_TERMINADO, {
      secuenciaFinal: r.secuenciaFinal,
      ofertas: r.ofertasEmitidas,
      rechazosTardios: r.rechazosTardios,
      cit_h: r.cit_h,
    });
    this.#alTerminar?.(r);
  }
}
