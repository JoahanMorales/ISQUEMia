/**
 * ADAPTER — slot `RUNTIME` a nivel de política (§7.4). Implementación local:
 * cero configuración, corre dentro del proceso, en tiempo de simulación.
 *
 * Los dos niveles conviven a propósito (§7.4, nota de diseño):
 *   nivel 1 · 40 carriles de evaluación barata abiertos a la vez;
 *   nivel 2 · como máximo 4 avanzan a compromiso — la intervención de H16.
 *
 * El adaptador de Trigger.dev implementa la misma interfaz con
 * `concurrencyLimit: 4`; la política no cambia, solo quién la ejecuta.
 */

import type { MotorCarriles } from "../domain/puertos";

interface EnCola {
  carrilId: string;
  secuencia: number;
  alObtener: () => void;
}

export interface OpcionesMotorLocal {
  maxEvaluaciones: number;
  maxCompromisos: number;
  /** Se llama cada vez que cambia la ocupación, para poder emitir un evento. */
  alCambiar?: (estado: { evaluaciones: number; compromisos: number; enCola: number }) => void;
}

export class MotorLocal implements MotorCarriles {
  readonly nombre = "local";
  #evaluaciones = new Set<string>();
  #compromisos = new Set<string>();
  #cola: EnCola[] = [];
  #pendientesEvaluacion: { carrilId: string; arrancar: () => void }[] = [];

  constructor(private opciones: OpcionesMotorLocal) {}

  get evaluacionesVivas(): number {
    return this.#evaluaciones.size;
  }
  get compromisosVivos(): number {
    return this.#compromisos.size;
  }
  get enColaDeCompromiso(): number {
    return this.#cola.length;
  }

  abrirEvaluacion(carrilId: string, arrancar: () => void): void {
    if (this.#evaluaciones.size >= this.opciones.maxEvaluaciones) {
      this.#pendientesEvaluacion.push({ carrilId, arrancar });
      return;
    }
    this.#evaluaciones.add(carrilId);
    this.#notificar();
    arrancar();
  }

  /** El carril avisa que terminó su fase de evaluación. */
  cerrarEvaluacion(carrilId: string): void {
    if (!this.#evaluaciones.delete(carrilId)) return;
    const siguiente = this.#pendientesEvaluacion.shift();
    this.#notificar();
    if (siguiente) this.abrirEvaluacion(siguiente.carrilId, siguiente.arrancar);
  }

  solicitarSlotCompromiso(carrilId: string, secuencia: number, alObtener: () => void): void {
    if (this.#compromisos.has(carrilId)) return;
    if (this.#compromisos.size < this.opciones.maxCompromisos) {
      this.#compromisos.add(carrilId);
      this.#notificar();
      alObtener();
      return;
    }
    this.#cola.push({ carrilId, secuencia, alObtener });
    // G4: se atiende por secuencia de match run, no por orden de llegada.
    this.#cola.sort((a, b) => a.secuencia - b.secuencia);
    this.#notificar();
  }

  liberarSlotCompromiso(carrilId: string): void {
    if (!this.#compromisos.delete(carrilId)) return;
    const siguiente = this.#cola.shift();
    this.#notificar();
    if (siguiente) {
      this.#compromisos.add(siguiente.carrilId);
      this.#notificar();
      siguiente.alObtener();
    }
  }

  cancelar(carrilId: string): void {
    this.#cola = this.#cola.filter((x) => x.carrilId !== carrilId);
    this.#pendientesEvaluacion = this.#pendientesEvaluacion.filter((x) => x.carrilId !== carrilId);
    this.liberarSlotCompromiso(carrilId);
    this.cerrarEvaluacion(carrilId);
  }

  cancelarTodo(): void {
    this.#cola = [];
    this.#pendientesEvaluacion = [];
    this.#compromisos.clear();
    this.#evaluaciones.clear();
    this.#notificar();
  }

  #notificar(): void {
    this.opciones.alCambiar?.({
      evaluaciones: this.#evaluaciones.size,
      compromisos: this.#compromisos.size,
      enCola: this.#cola.length,
    });
  }
}
