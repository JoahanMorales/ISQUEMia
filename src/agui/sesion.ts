/**
 * Sesión de corrida del servidor.
 *
 * Mantiene viva una `Corrida` por `corridaId`, con el motor de tiempo real que
 * empuja el reloj de simulación. Es lo único con estado mutable del servidor;
 * todo lo demás se deriva del event store.
 */

import { crearMotorReloj, type MotorReloj } from "../adapters/motor-reloj";
import { crearCorrida, type Corrida, type OpcionesCorrida } from "../composicion";
import type { Evento } from "../domain/tipos";
import type { ResultadoCorrida } from "../orquestacion/corrida";

export interface OpcionesSesion extends OpcionesCorrida {
  /** Aceleración de la demo: 60× a 300× (§11.1.1). */
  factor?: number;
}

export class Sesion {
  readonly corrida: Corrida;
  readonly motor: MotorReloj;
  resultado: ResultadoCorrida | null = null;
  readonly creada: number;

  #suscriptores = new Set<(e: Evento) => void>();

  constructor(opciones: OpcionesSesion) {
    this.corrida = crearCorrida({ ...opciones, factor: opciones.factor ?? 120 });
    this.motor = crearMotorReloj(this.corrida.reloj);
    this.creada = this.corrida.reloj.now();
    this.corrida.bus.subscribe((e) => {
      for (const s of [...this.#suscriptores]) s(e);
    });
  }

  arrancar(): void {
    if (this.corrida.isquemia.fase !== "inactiva") return;
    this.corrida.isquemia.iniciar((r) => {
      this.resultado = r;
      this.motor.detener();
    });
    this.motor.arrancar();
  }

  suscribir(fn: (e: Evento) => void): () => void {
    this.#suscriptores.add(fn);
    return () => this.#suscriptores.delete(fn);
  }

  setFactor(factor: number): void {
    this.corrida.reloj.setFactor(Math.max(1, Math.min(600, factor)));
  }

  congelar(): void {
    this.corrida.reloj.freeze();
  }

  reanudar(): void {
    this.corrida.reloj.resume();
  }

  detener(): void {
    this.motor.detener();
    this.corrida.motor.cancelarTodo();
  }

  /** Corre la campaña completa de golpe, sin animación. Útil para replay. */
  adelantarHastaElFinal(): void {
    this.motor.detener();
    this.corrida.reloj.resume();
    this.corrida.reloj.correrHastaVacio(72 * 3600);
  }
}

// ---------------------------------------------------------------- registro

const SESIONES = new Map<string, Sesion>();

export function obtenerSesion(corridaId: string): Sesion | undefined {
  return SESIONES.get(corridaId);
}

export function crearSesion(opciones: OpcionesSesion): Sesion {
  const id = opciones.corridaId ?? `run-${opciones.semilla}`;
  SESIONES.get(id)?.detener();
  const sesion = new Sesion({ ...opciones, corridaId: id });
  SESIONES.set(id, sesion);
  return sesion;
}

/**
 * La sesión del servidor se crea perezosa y **sin arrancar**. Arrancarla aquí
 * haría que el reloj de isquemia empezara a correr cuando se levanta el proceso
 * de Next, de modo que quien abre el panel cinco minutos después se encuentra la
 * campaña ya terminada. La consola la arranca con `POST /api/corrida`
 * `{accion:"arrancar"}` cuando hay alguien mirando.
 */
export function sesionPorDefecto(): Sesion {
  const existente = [...SESIONES.values()][0];
  if (existente) return existente;
  return crearSesion({ semilla: "S-001" });
}

export function listarSesiones(): { corridaId: string; semilla: string; fase: string }[] {
  return [...SESIONES.values()].map((s) => ({
    corridaId: s.corrida.corridaId,
    semilla: s.corrida.semilla,
    fase: s.corrida.isquemia.fase,
  }));
}

export function reiniciar(semilla: string, opciones: Partial<OpcionesSesion> = {}): Sesion {
  for (const s of SESIONES.values()) s.detener();
  SESIONES.clear();
  const s = crearSesion({ semilla, ...opciones });
  s.arrancar();
  return s;
}
