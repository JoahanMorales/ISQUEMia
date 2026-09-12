/**
 * ADAPTER — slot `ALMACEN` (§5.4). Append-only en memoria.
 * Fuente de verdad de la corrida (§5.2 principio 1): el estado se deriva
 * replayando estos eventos. La implementación Postgres reusa esta interfaz.
 */

import type { AlmacenEventos } from "../domain/puertos";
import type { Evento, EventoNuevo } from "../domain/tipos";
import { horaDePared } from "./reloj-sistema";

export interface OpcionesAlmacen {
  corridaId: string;
  semilla: string;
  /** Se invoca tras cada append; el bus lo usa para retransmitir. */
  alEscribir?: (evento: Evento) => void;
}

export class AlmacenMemoria implements AlmacenEventos {
  readonly corridaId: string;
  readonly semilla: string;
  #eventos: Evento[] = [];
  #seq = 0;
  #alEscribir: ((evento: Evento) => void) | undefined;

  constructor(opciones: OpcionesAlmacen) {
    this.corridaId = opciones.corridaId;
    this.semilla = opciones.semilla;
    this.#alEscribir = opciones.alEscribir;
  }

  append(nuevo: EventoNuevo): Evento {
    // El id es determinista por corrida: la reproducibilidad del replay
    // depende de que no entre aleatoriedad ni hora de pared en la identidad.
    const evento: Evento = Object.freeze({
      id: `${this.corridaId}#${String(this.#seq++).padStart(6, "0")}`,
      t_wall: horaDePared(),
      t_sim: nuevo.t_sim,
      actor: nuevo.actor,
      tipo: nuevo.tipo,
      payload: Object.freeze({ ...nuevo.payload }),
      semilla: this.semilla,
      corridaId: this.corridaId,
    });
    this.#eventos.push(evento);
    this.#alEscribir?.(evento);
    return evento;
  }

  read(desde?: number, hasta?: number): Evento[] {
    return this.#eventos.filter(
      (e) => (desde === undefined || e.t_sim >= desde) && (hasta === undefined || e.t_sim <= hasta),
    );
  }

  todos(): Evento[] {
    return [...this.#eventos];
  }

  async flush(): Promise<void> {
    // En memoria no hay nada que vaciar; el adaptador Postgres sí lo usa.
  }

  get tamano(): number {
    return this.#eventos.length;
  }
}
