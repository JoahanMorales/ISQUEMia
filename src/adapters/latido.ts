/**
 * ADAPTER — latido de tiempo real.
 *
 * El único temporizador de pared que la capa de interfaz puede usar. Vive aquí
 * porque `lint-reloj` prohíbe `setInterval` fuera de `adapters/`, y esa regla
 * es la que garantiza que ninguna decisión de dominio dependa del reloj del
 * sistema. Refrescar una pantalla sí depende de él; decidir no.
 */

export interface Latido {
  detener(): void;
  readonly vivo: boolean;
}

export function crearLatido(intervalo_ms: number, fn: () => void): Latido {
  const handle = setInterval(fn, intervalo_ms);
  let vivo = true;
  return {
    detener() {
      if (!vivo) return;
      vivo = false;
      clearInterval(handle);
    },
    get vivo() {
      return vivo;
    },
  };
}
