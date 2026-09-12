/**
 * ADAPTER — slot `UI_TRANSPORTE` (§5.4), implementación local.
 * La versión CopilotKit/WebSocket se conecta suscribiéndose a este bus.
 */

import type { BusEventos } from "../domain/puertos";
import type { Evento } from "../domain/tipos";

export class BusMemoria implements BusEventos {
  #handlers = new Set<(evento: Evento) => void>();

  emit(evento: Evento): void {
    for (const h of [...this.#handlers]) {
      try {
        h(evento);
      } catch {
        // G9: un suscriptor caído nunca tumba la corrida.
      }
    }
  }

  subscribe(handler: (evento: Evento) => void): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  get suscriptores(): number {
    return this.#handlers.size;
  }
}
