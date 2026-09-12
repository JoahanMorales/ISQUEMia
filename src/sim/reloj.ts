/**
 * Reloj de simulación — §11.2.
 *
 * Puro: no consulta la hora del sistema. El único motor que lo mueve es
 * `advance()`. El modo tiempo real (demo acelerada) vive en
 * `adapters/motor-reloj.ts`, que llama a `advance()` desde fuera.
 *
 * §5.2 principio 2: ningún componente de dominio usa la hora del sistema.
 */

import type { Reloj } from "../domain/puertos";
import type { Timestamp } from "../domain/tipos";

interface Agendado {
  t: Timestamp;
  orden: number;
  callback: () => void;
  cancelado: boolean;
}

export interface OpcionesReloj {
  /** Instante inicial en ms sim. Por defecto 0. */
  t0?: Timestamp;
  /** Factor de aceleración usado por el motor de tiempo real. */
  factor?: number;
}

export class RelojSimulacion implements Reloj {
  #t: Timestamp;
  #factor: number;
  #congelado = false;
  #orden = 0;
  #cola: Agendado[] = [];
  #avanzando = false;

  constructor(opciones: OpcionesReloj = {}) {
    this.#t = opciones.t0 ?? 0;
    this.#factor = opciones.factor ?? 1;
  }

  now(): Timestamp {
    return this.#t;
  }

  get factor(): number {
    return this.#factor;
  }

  get congelado(): boolean {
    return this.#congelado;
  }

  freeze(): void {
    this.#congelado = true;
  }

  resume(): void {
    this.#congelado = false;
  }

  /** Cambia la aceleración sin mover el reloj. */
  setFactor(factor: number): void {
    this.#factor = factor;
  }

  schedule(enSegundos: number, callback: () => void): () => void {
    const item: Agendado = {
      t: this.#t + Math.round(enSegundos * 1000),
      orden: this.#orden++,
      callback,
      cancelado: false,
    };
    this.#cola.push(item);
    return () => {
      item.cancelado = true;
    };
  }

  /** Cuántos callbacks vivos quedan agendados. Útil para tests y para el motor. */
  get pendientes(): number {
    return this.#cola.filter((a) => !a.cancelado).length;
  }

  /** Instante del próximo callback agendado, o null si no hay ninguno. */
  proximoInstante(): Timestamp | null {
    let min: Timestamp | null = null;
    for (const a of this.#cola) {
      if (a.cancelado) continue;
      if (min === null || a.t < min) min = a.t;
    }
    return min;
  }

  advance(segundos: number): void {
    if (this.#congelado) return;
    if (segundos < 0) throw new Error("El reloj de simulación no retrocede");
    if (this.#avanzando) {
      throw new Error("advance() reentrante: un callback agendado no puede avanzar el reloj");
    }
    this.#avanzando = true;
    try {
      const destino = this.#t + Math.round(segundos * 1000);
      for (;;) {
        const siguiente = this.#tomarSiguienteHasta(destino);
        if (!siguiente) break;
        this.#t = siguiente.t;
        siguiente.callback();
      }
      this.#t = destino;
      this.#compactar();
    } finally {
      this.#avanzando = false;
    }
  }

  /** Avanza justo hasta el próximo evento agendado. Devuelve false si no hay. */
  advanceHastaProximo(): boolean {
    const proximo = this.proximoInstante();
    if (proximo === null) return false;
    this.advance(Math.max(0, (proximo - this.#t) / 1000));
    return true;
  }

  /** Corre hasta agotar la agenda o alcanzar `limiteSegundos` desde ahora. */
  correrHastaVacio(limiteSegundos = Number.POSITIVE_INFINITY): void {
    const limite = this.#t + (Number.isFinite(limiteSegundos) ? limiteSegundos * 1000 : Infinity);
    for (;;) {
      const proximo = this.proximoInstante();
      if (proximo === null || proximo > limite) break;
      this.advanceHastaProximo();
    }
  }

  /**
   * Empate en `t`: gana el que se agendó primero. Esto es lo que hace
   * reproducible una corrida con la misma semilla.
   */
  #tomarSiguienteHasta(destino: Timestamp): Agendado | null {
    let mejor: Agendado | null = null;
    for (const a of this.#cola) {
      if (a.cancelado || a.t > destino) continue;
      if (mejor === null || a.t < mejor.t || (a.t === mejor.t && a.orden < mejor.orden)) {
        mejor = a;
      }
    }
    if (mejor) mejor.cancelado = true; // consumido
    return mejor;
  }

  #compactar(): void {
    if (this.#cola.length > 64) this.#cola = this.#cola.filter((a) => !a.cancelado);
  }
}
