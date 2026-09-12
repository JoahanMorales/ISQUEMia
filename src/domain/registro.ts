/**
 * Registrador — la única forma en que el dominio escribe eventos.
 * Rellena `t_sim` desde el reloj y retransmite al bus (§5.1, §5.2 principio 1).
 * G8: ninguna decisión sin evento correspondiente.
 */

import type { AlmacenEventos, BusEventos, Reloj } from "./puertos";
import type { Actor, Evento } from "./tipos";

export class Registrador {
  constructor(
    private reloj: Reloj,
    private almacen: AlmacenEventos,
    private bus: BusEventos,
  ) {}

  emitir(actor: Actor, tipo: string, payload: Record<string, unknown> = {}): Evento {
    const evento = this.almacen.append({
      t_sim: this.reloj.now(),
      actor,
      tipo,
      payload,
    });
    this.bus.emit(evento);
    return evento;
  }
}
