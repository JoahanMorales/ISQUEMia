/**
 * ADAPTER — motor de tiempo real que empuja el reloj de simulación.
 * Es la única pieza que conecta la hora de pared con `sim.advance()`.
 * En tests no se usa: los tests llaman a `advance()` a mano.
 */

import type { RelojSimulacion } from "../sim/reloj";
import { monotono } from "./reloj-sistema";

export interface MotorReloj {
  arrancar(): void;
  detener(): void;
  readonly corriendo: boolean;
}

/**
 * Avanza el reloj `factor` segundos sim por segundo real (demo: 60×–300×).
 * `tick_ms` es el periodo de muestreo en tiempo real.
 */
export function crearMotorReloj(sim: RelojSimulacion, tick_ms = 50): MotorReloj {
  let handle: ReturnType<typeof setInterval> | null = null;
  let ultimo = 0;

  return {
    arrancar() {
      if (handle) return;
      ultimo = monotono();
      handle = setInterval(() => {
        const ahora = monotono();
        const transcurrido_s = (ahora - ultimo) / 1000;
        ultimo = ahora;
        if (sim.congelado) return;
        sim.advance(transcurrido_s * sim.factor);
      }, tick_ms);
    },
    detener() {
      if (handle) clearInterval(handle);
      handle = null;
    },
    get corriendo() {
      return handle !== null;
    },
  };
}
