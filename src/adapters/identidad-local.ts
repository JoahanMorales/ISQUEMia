/**
 * ADAPTER — slot `AUTH`, implementación local.
 * Cada agente tiene un `sub` estable, para que cada línea del registro de
 * auditoría se pueda atribuir a un agente concreto. Auth0 sustituye esto
 * emitiendo un client M2M por agente, con el mismo contrato.
 */

import type { IdentidadAgente } from "../domain/puertos";
import type { Actor } from "../domain/tipos";

export class IdentidadLocal implements IdentidadAgente {
  readonly nombre = "local";
  readonly remoto = false;

  constructor(private prefijo = "isquemia") {}

  sub(actor: Actor): string {
    return `${this.prefijo}|${actor.replace(":", "-")}`;
  }

  async token(): Promise<string | null> {
    return null;
  }
}
