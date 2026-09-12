/**
 * `IsquemiaAgent` — el orquestador expuesto como agente AG-UI.
 *
 * Es la decisión central de la arquitectura (ARQUITECTURA.md §2): CopilotKit v2
 * acepta cualquier `AbstractAgent`, así que el panel entero se alimenta del
 * estado del agente en vez de tener su propio estado. La rejilla de 40 celdas,
 * las cuatro casillas del compromiso y el reloj de isquemia son proyecciones
 * del event store, no widgets con vida propia.
 *
 * Traducción de eventos:
 *   arranque              → RUN_STARTED + STATE_SNAPSHOT
 *   cada evento del bus   → STATE_DELTA (JSON Patch superficial)
 *   degradación / alerta  → CUSTOM (para animaciones y sonido)
 *   plan de transporte    → TOOL_CALL mostrarPlanTransporte  (generative UI)
 *   expediente AOOS       → TOOL_CALL mostrarExpediente      (generative UI)
 *   hitos de fase         → TEXT_MESSAGE_* (narración del Escribano)
 *   fin de corrida        → RUN_FINISHED
 */

import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";
import { crearLatido } from "../adapters/latido";
import type { Evento } from "../domain/tipos";
import { E } from "../orquestacion/eventos";
import { proyectar, type EstadoPanel } from "./estado";
import { diffEstado } from "./parche";
import { sesionPorDefecto, type Sesion } from "./sesion";

/** Cadencia de refresco del estado hacia la interfaz, en ms reales. */
const INTERVALO_MS = 220;

let contador = 0;
const nuevoId = (p: string) => `${p}-${++contador}`;

export class IsquemiaAgent extends AbstractAgent {
  /**
   * `AbstractAgent.clone()` reconstruye la instancia copiando solo los campos
   * que conoce, así que un campo propio se pierde en el clon que hace el
   * runtime por hilo. Se resuelve de dos formas: `clone()` lo reinyecta, y el
   * acceso cae de vuelta a la sesión del servidor si aun así faltara.
   */
  // Campo `private` de TypeScript, no `#privado` de JavaScript: `clone()` crea
  // la copia con `Object.create`, y un campo `#` no se puede escribir en un
  // objeto cuyo constructor nunca corrió.
  private sesionRef?: Sesion;

  private get sesion(): Sesion {
    return (this.sesionRef ??= sesionPorDefecto());
  }

  constructor(sesion: Sesion) {
    super({
      agentId: "isquemia",
      description:
        "Operations agent for deceased-donor organ placement. Owns the three clocks: referral detection, parallel placement across 40 centers with verified commitments, and multimodal transport routing.",
      initialState: proyectar(sesion.corrida) as unknown as Record<string, unknown>,
    });
    this.sesionRef = sesion;
  }

  clone(): IsquemiaAgent {
    const copia = super.clone() as IsquemiaAgent;
    copia.sesionRef = this.sesion;
    return copia;
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const sesion = this.sesion;

    return new Observable<BaseEvent>((observer) => {
      const emitir = (e: BaseEvent) => observer.next(e);
      let anterior: EstadoPanel = proyectar(sesion.corrida);
      let cerrado = false;

      emitir({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);
      emitir({ type: EventType.STATE_SNAPSHOT, snapshot: anterior } as unknown as BaseEvent);

      // El texto de apertura explica de qué va la pantalla sin que nadie
      // tenga que preguntarlo. Es narración, no un chatbot esperando turno.
      narrar(
        emitir,
        `Run ${sesion.corrida.corridaId} · seed ${sesion.corrida.semilla}. Watching the ICU feed for an explicit clinical trigger. ` +
          `Once the organ is cross-clamped I open ${sesion.corrida.politica.N_CARRILES} evaluation lanes and let at most ` +
          `${sesion.corrida.politica.MAX_CONCURRENTES_POLITICA} of them advance to a verified commitment at a time. ` +
          `A human coordinator working the same match run, on the same seed, runs alongside in the bottom strip.`,
      );

      // ---- eventos de dominio que merecen tratamiento especial en la UI ----
      const desuscribir = sesion.suscribir((evento: Evento) => {
        if (cerrado) return;
        try {
          traducirEvento(evento, emitir, sesion);
        } catch {
          // Un fallo de traducción nunca puede tumbar la corrida (§5.2.3).
        }
      });

      // ---- latido de estado ----
      const tick = crearLatido(INTERVALO_MS, () => {
        if (cerrado) return;
        const actual = proyectar(sesion.corrida);
        const ops = diffEstado(
          anterior as unknown as Record<string, unknown>,
          actual as unknown as Record<string, unknown>,
        );
        if (ops.length > 0) {
          emitir({ type: EventType.STATE_DELTA, delta: ops } as unknown as BaseEvent);
          anterior = actual;
        }
        if (actual.fase === "terminada" && sesion.resultado) {
          cerrar();
        }
      });

      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        tick.detener();
        desuscribir();

        const final = proyectar(sesion.corrida);
        emitir({ type: EventType.STATE_SNAPSHOT, snapshot: final } as unknown as BaseEvent);
        narrar(emitir, cierreNarrado(final));
        emitir({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as BaseEvent);
        observer.complete();
      };

      return () => {
        cerrado = true;
        tick.detener();
        desuscribir();
      };
    });
  }
}

// ------------------------------------------------------------------ helpers

function narrar(emitir: (e: BaseEvent) => void, texto: string): void {
  const id = nuevoId("msg");
  emitir({ type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" } as unknown as BaseEvent);
  emitir({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta: texto } as unknown as BaseEvent);
  emitir({ type: EventType.TEXT_MESSAGE_END, messageId: id } as unknown as BaseEvent);
}

/** Tool call sin ejecución: existe para que el frontend renderice un componente. */
function generativa(emitir: (e: BaseEvent) => void, nombre: string, args: unknown): void {
  const id = nuevoId("tc");
  emitir({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: nombre } as unknown as BaseEvent);
  emitir({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(args) } as unknown as BaseEvent);
  emitir({ type: EventType.TOOL_CALL_END, toolCallId: id } as unknown as BaseEvent);
  emitir({
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: id,
    messageId: nuevoId("msg"),
    content: "rendered",
  } as unknown as BaseEvent);
}

function custom(emitir: (e: BaseEvent) => void, nombre: string, valor: unknown): void {
  emitir({ type: EventType.CUSTOM, name: nombre, value: valor } as unknown as BaseEvent);
}

function traducirEvento(evento: Evento, emitir: (e: BaseEvent) => void, sesion: Sesion): void {
  const p = evento.payload as Record<string, unknown>;

  switch (evento.tipo) {
    case E.REFERRAL_EMITIDO:
      narrar(
        emitir,
        `Referral issued for ${p.pacienteId}: ${(p.criterios as { tipo: string }[]).map((c) => c.tipo).join(", ")}. ` +
          `Confidence ${p.confianza}. The clock on the hospital's contractual notification window starts now.`,
      );
      custom(emitir, "referral", p);
      break;

    case E.ESCALAMIENTO_SOLICITADO:
      custom(emitir, "escalamiento", p);
      break;

    case E.CROSS_CLAMP:
      narrar(
        emitir,
        `Cross clamp. Cold ischemia limit for this organ is ${p.citLimite_h} h and the clock does not stop from here on.`,
      );
      custom(emitir, "cross_clamp", p);
      break;

    case E.ALERTA_CIT:
      custom(emitir, "alerta_cit", p);
      break;

    case E.CARRIL_DEGRADADO:
      // El momento central de la demo: un provisional yes que no se sostiene.
      custom(emitir, "degradacion", p);
      narrar(
        emitir,
        `${p.centroNombre} gave a provisional yes and could not fill ${(p.camposFaltantes as string[]).join(" or ")} ` +
          `within the verification window. Lane downgraded instead of waited on — about ${p.horasIsquemiaProtegidas} h of cold ischemia protected.`,
      );
      break;

    case E.CARRIL_COMPROMETIDO:
      custom(emitir, "compromiso", p);
      break;

    case E.PLAN_TRANSPORTE_LISTO:
      generativa(emitir, "mostrarPlanTransporte", {
        centroId: p.centroId,
        opciones: sesion.corrida.isquemia.transporte ?? [],
      });
      break;

    case E.EXPEDIENTE_LISTO:
      generativa(emitir, "mostrarExpediente", sesion.corrida.isquemia.expediente ?? {});
      break;

    case E.CAMPANA_CERRADA:
      custom(emitir, "campana_cerrada", p);
      break;

    case E.VENTANA_DCD_EXPIRADA:
      narrar(
        emitir,
        `The DCD window expired without circulatory arrest. There is no donation from this case. ` +
          `This path is implemented on purpose: anyone who knows the domain will ask whether it is.`,
      );
      custom(emitir, "ventana_expirada", p);
      break;

    case E.DEGRADACION_PROVEEDOR:
      custom(emitir, "degradacion_proveedor", p);
      break;
  }
}

function cierreNarrado(s: EstadoPanel): string {
  const m = s.metricas;
  if (!m) return "Run finished.";
  const seq = s.resumen.mejorSecuencia;
  const base = s.baseline.secuenciaFinal;
  return [
    seq !== null
      ? `Placed at match run sequence #${seq} with a verified commitment.`
      : `No verified commitment was reached before the campaign closed.`,
    base !== null
      ? `The serial baseline, same seed, placed at #${base} after ${s.baseline.ofertas} offers and ${s.baseline.rechazosTardios} late refusals.`
      : `The serial baseline never placed.`,
    `${s.resumen.degradaciones} of ${s.resumen.provisionalYes} provisional acceptances were intercepted, protecting ${s.resumen.horasProtegidas.toFixed(1)} h.`,
    `Ischemia hours saved: ${m.M1_horasIsquemiaAhorradas.toFixed(2)}. Citation rate: ${m.M9_tasaCitacion.toFixed(2)}. Cost this run: $${m.M8_costoPorColocacionUSD.toFixed(4)}.`,
  ].join(" ");
}
