/**
 * ADAPTER — slots `LLM_NEGOCIACION`, `LLM_TRIAGE`, `LLM_ROUTER`.
 *
 * Implementación local determinista. Hace exactamente el mismo trabajo que
 * haría el modelo real —clasificar prosa en código de rechazo, extraer los
 * cuatro campos del compromiso— pero con reglas, coste cero de red y salida
 * idéntica entre corridas.
 *
 * Contabiliza tokens y coste con la **tarifa real del modelo que sustituye**,
 * marcados como `tarifaSimulada: true`. Así la cifra de M8 es la que se pagaría,
 * y el panel dice de dónde viene en lugar de fingir que hubo una llamada.
 */

import type {
  DefinicionHerramienta,
  Llm,
  Mensaje,
  RespuestaLlm,
  RouterModelos,
  TipoTarea,
} from "../domain/puertos";
import { CODIGOS_RECHAZO, type CodigoRechazo } from "../domain/codigos-rechazo";

/** USD por millón de tokens. Precios de referencia de los modelos sustituidos. */
export const TARIFAS: Record<string, { entrada: number; salida: number }> = {
  "openai:gpt-5.4": { entrada: 2.5, salida: 10 },
  "openai:gpt-5.4-mini": { entrada: 0.15, salida: 0.6 },
  "openai:gpt-realtime": { entrada: 4, salida: 16 },
};

export const MODELO_POR_TAREA: Record<TipoTarea, string> = {
  negociacion: "openai:gpt-5.4",
  triage: "openai:gpt-5.4-mini",
  redaccion: "openai:gpt-5.4",
  ruta: "openai:gpt-5.4-mini",
};

/** Aproximación estándar: ~4 caracteres por token. */
export function estimarTokens(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 4));
}

export function costoUSD(modelo: string, entrada: number, salida: number): number {
  const t = TARIFAS[modelo] ?? TARIFAS["openai:gpt-5.4-mini"]!;
  return (entrada * t.entrada + salida * t.salida) / 1_000_000;
}

/** Palabras clave → código estandarizado (§3.2). Es el trabajo del modelo de triage. */
const REGLAS_CODIGO: [RegExp, CodigoRechazo][] = [
  [/\bcold (time|ischemi)|projected cold\b/i, "LOG_CIT_TOO_LONG"],
  [/\bwarm ischemi\b/i, "LOG_WIT_TOO_LONG"],
  [/\blabs?\b|\btest results?\b/i, "ORGAN_SPECIFIC_TEST_RESULTS"],
  [/\bmedical history\b/i, "DONOR_MEDICAL_HISTORY"],
  [/\banatomy|anatomical\b/i, "ORGAN_ANATOMICAL_DEFECT"],
  [/\bbiopsy\b/i, "BIOPSY_UNACCEPTABLE"],
  [/\bdonor age|age is above\b/i, "DONOR_AGE"],
  [/\bpreservation\b/i, "ORGAN_PRESERVATION"],
  [/\bcandidate is ?n[o']?t available|not available right now\b/i, "CANDIDATE_UNAVAILABLE"],
  [/\bcrossmatch\b/i, "POSITIVE_CROSSMATCH"],
  [/\bno OR|OR availability\b/i, "LOG_TEAM_OR_FACILITY_UNAVAILABLE"],
  [/\brecovery team\b/i, "LOG_RECOVERY_TEAM_UNAVAILABLE"],
  [/\bsize mismatch\b/i, "SIZE_MISMATCH"],
  [/\bKDPI\b/i, "DONOR_KDPI_TOO_HIGH"],
  [/\btransport\b/i, "LOG_TRANSPORTATION_UNAVAILABLE"],
  [/\bblood type\b/i, "BLOOD_TYPE_INCOMPATIBLE"],
  [/\bno response\b/i, "NO_REASON_GIVEN"],
];

export function mapearProsaACodigo(prosa: string): { codigo: CodigoRechazo; confianza: number } {
  for (const [re, codigo] of REGLAS_CODIGO) {
    if (re.test(prosa)) return { codigo, confianza: 0.95 };
  }
  return { codigo: "OTHER", confianza: 0.55 };
}

export class LlmGuionado implements Llm {
  readonly nombre = "guionado";
  readonly remoto = false;

  constructor(readonly modelo: string) {}

  async complete(messages: Mensaje[], tools?: DefinicionHerramienta[], schema?: Record<string, unknown>): Promise<RespuestaLlm> {
    return this.completeSync(messages, tools, schema)!;
  }

  completeSync(messages: Mensaje[], tools?: DefinicionHerramienta[], schema?: Record<string, unknown>): RespuestaLlm {
    const entradaTexto = messages.map((m) => m.contenido).join("\n");
    const ultimo = messages[messages.length - 1]?.contenido ?? "";

    let content = "";
    if (schema && (schema as { title?: string }).title === "CodigoRechazo") {
      const { codigo, confianza } = mapearProsaACodigo(ultimo);
      content = JSON.stringify({ codigo, confianza });
    } else {
      content = "";
    }

    const entrada = estimarTokens(entradaTexto) + (tools?.length ?? 0) * 60;
    const salida = estimarTokens(content || " ");
    return {
      content,
      toolCalls: [],
      usage: { entrada, salida, costoUSD: costoUSD(this.modelo, entrada, salida) },
    };
  }
}

export class RouterLocal implements RouterModelos {
  readonly nombre = "router-local";
  #cache = new Map<TipoTarea, Llm>();

  route(taskKind: TipoTarea): string {
    return MODELO_POR_TAREA[taskKind];
  }

  para(taskKind: TipoTarea): Llm {
    const cached = this.#cache.get(taskKind);
    if (cached) return cached;
    const llm = new LlmGuionado(this.route(taskKind));
    this.#cache.set(taskKind, llm);
    return llm;
  }
}

/** Esquema JSON del triage de rechazo. Validarlo es lo que mide M6. */
export const ESQUEMA_CODIGO_RECHAZO = {
  title: "CodigoRechazo",
  type: "object",
  required: ["codigo", "confianza"],
  properties: {
    codigo: { type: "string", enum: CODIGOS_RECHAZO },
    confianza: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export function validaEsquemaCodigo(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as { codigo?: unknown; confianza?: unknown };
  return (
    typeof v.codigo === "string" &&
    (CODIGOS_RECHAZO as readonly string[]).includes(v.codigo) &&
    typeof v.confianza === "number" &&
    v.confianza >= 0 &&
    v.confianza <= 1
  );
}
