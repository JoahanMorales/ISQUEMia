/**
 * ADAPTER — slot `OBSERVABILIDAD` (§5.4). Spans de §14.1 en memoria,
 * que alimentan el panel P5 y el arnés de evaluación (§14.4).
 */

import type { MetaSpan, Observabilidad, Span, SpanRegistrado } from "../domain/puertos";
import type { Reloj } from "../domain/puertos";
import { monotono } from "./reloj-sistema";

export class ObservabilidadMemoria implements Observabilidad {
  #spans: SpanRegistrado[] = [];

  constructor(
    private reloj: Reloj,
    private corridaId: string,
    private semilla: string,
  ) {}

  span(nombre: string, meta: MetaSpan): Span {
    const inicio = monotono();
    const t_sim = this.reloj.now();
    let cerrado = false;
    return {
      fin: (extra?: Partial<MetaSpan>) => {
        if (cerrado) return;
        cerrado = true;
        this.#spans.push({
          ...meta,
          ...extra,
          nombre,
          latencia_ms: monotono() - inicio,
          t_sim,
          corridaId: this.corridaId,
          semilla: this.semilla,
        });
      },
    };
  }

  spans(): SpanRegistrado[] {
    return [...this.#spans];
  }
}
