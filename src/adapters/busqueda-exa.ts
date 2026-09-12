/**
 * ADAPTER — slot `BUSQUEDA` sobre Exa.
 *
 * §11.1.7 permite tablas estáticas para el transporte, y eso es lo que usa el
 * planificador: tiene que ser determinista por semilla, porque sale en M1 y en
 * la comparación con la línea base. Meter una API en ese camino rompería la
 * reproducibilidad.
 *
 * Así que Exa entra por donde aporta sin contaminar: **corroboración**. Una vez
 * elegido el plan, la pantalla de transporte busca fuentes reales sobre esa
 * ruta y las muestra con su enlace. El plan no cambia; lo que cambia es que el
 * jurado puede pinchar la fuente. Fuera del reloj de simulación, siempre.
 */

import type { Busqueda } from "../domain/puertos";

export interface OpcionesExa {
  apiKey: string;
  baseUrl?: string;
  /** Resultados por consulta. Pocos: es una tarjeta, no un buscador. */
  n?: number;
}

export class BusquedaExa implements Busqueda {
  readonly nombre = "exa";
  readonly remoto = true;
  #o: OpcionesExa;

  constructor(opciones: OpcionesExa) {
    this.#o = opciones;
  }

  async search(query: string): Promise<{ titulo: string; url: string; extracto: string }[]> {
    const r = await fetch(`${this.#o.baseUrl ?? "https://api.exa.ai"}/search`, {
      method: "POST",
      headers: { "x-api-key": this.#o.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        query,
        numResults: this.#o.n ?? 4,
        contents: { text: { maxCharacters: 320 } },
      }),
    });

    if (!r.ok) throw new Error(`Exa: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);

    const j = (await r.json()) as {
      results?: { title?: string; url?: string; text?: string; snippet?: string }[];
    };

    return (j.results ?? []).map((x) => ({
      titulo: x.title ?? x.url ?? "(sin título)",
      url: x.url ?? "",
      extracto: (x.text ?? x.snippet ?? "").trim().replace(/\s+/g, " ").slice(0, 300),
    }));
  }
}

/** Sin credencial no se inventa nada: se devuelve vacío y la tarjeta lo dice. */
export class BusquedaVacia implements Busqueda {
  readonly nombre = "corpus-estatico";
  readonly remoto = false;

  async search(): Promise<{ titulo: string; url: string; extracto: string }[]> {
    return [];
  }
}
