/**
 * ADAPTER — slot `RUNTIME` (§5.4). Concurrencia nativa del lenguaje.
 * §5.2 principio 3: un carril que falla no puede tumbar a otro, así que
 * `spawn` nunca deja escapar un rechazo sin capturar.
 */

import type { Manija, Runtime } from "../domain/puertos";

export class RuntimeAsync implements Runtime {
  #vivos = new Map<string, AbortController>();

  spawn<T>(id: string, tarea: (senal: AbortSignal) => Promise<T>): Manija<T> {
    const control = new AbortController();
    this.#vivos.set(id, control);
    const promesa = (async () => {
      try {
        return await tarea(control.signal);
      } finally {
        this.#vivos.delete(id);
      }
    })();
    // Aislamiento: nadie más ve un unhandled rejection de este carril.
    promesa.catch(() => {});
    return {
      id,
      promesa,
      cancelar: () => control.abort(),
    };
  }

  get vivos(): number {
    return this.#vivos.size;
  }

  cancelarTodo(): void {
    for (const c of this.#vivos.values()) c.abort();
  }
}
