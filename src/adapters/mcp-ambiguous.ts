/**
 * ADAPTER — cliente MCP mínimo sobre HTTP streamable para Ambiguous AI.
 *
 * El servidor expone 856 herramientas y ~775 KB de esquemas: adjuntarlas a un
 * modelo sería absurdo. ISQUEMIA no las necesita — sus agentes llaman por
 * nombre a las nueve que usa, con argumentos tipados en el sitio de la llamada.
 * Por eso aquí no hay descubrimiento dinámico ni SDK: solo `tools/call`.
 *
 * El transporte responde `text/event-stream` incluso para respuestas unitarias,
 * así que hay que leer la primera línea `data:` en vez de esperar JSON plano.
 */

export interface OpcionesMcp {
  baseUrl: string;
  apiKey: string;
  /** Timeout por llamada, en ms de pared. El demo no espera a nadie. */
  timeout_ms?: number;
}

export class ErrorMcp extends Error {
  constructor(
    readonly herramienta: string,
    mensaje: string,
  ) {
    super(`[${herramienta}] ${mensaje}`);
    this.name = "ErrorMcp";
  }
}

const PROTOCOLO = "2025-06-18";

export class ClienteMcp {
  #id = 0;
  #iniciado: Promise<void> | null = null;

  constructor(private o: OpcionesMcp) {}

  get url(): string {
    return this.o.baseUrl;
  }

  async #peticion(cuerpo: unknown): Promise<unknown> {
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), this.o.timeout_ms ?? 15_000); // lint-reloj: permitido — timeout de red
    try {
      const respuesta = await fetch(this.o.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.o.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOLO,
        },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
      const texto = await respuesta.text();
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}: ${texto.slice(0, 200)}`);
      return parsearSse(texto);
    } finally {
      clearTimeout(t);
    }
  }

  async iniciar(): Promise<void> {
    this.#iniciado ??= (async () => {
      await this.#peticion({
        jsonrpc: "2.0",
        id: ++this.#id,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOLO,
          capabilities: {},
          clientInfo: { name: "isquemia", version: "0.1.0" },
        },
      });
    })();
    return this.#iniciado;
  }

  /** Llama una herramienta y devuelve su payload ya parseado. */
  async llamar<T = unknown>(nombre: string, argumentos: Record<string, unknown>): Promise<T> {
    await this.iniciar();
    const respuesta = (await this.#peticion({
      jsonrpc: "2.0",
      id: ++this.#id,
      method: "tools/call",
      params: { name: nombre, arguments: argumentos },
    })) as {
      error?: { message?: string };
      result?: { isError?: boolean; content?: { type: string; text?: string }[] };
    };

    if (respuesta.error) throw new ErrorMcp(nombre, respuesta.error.message ?? "error desconocido");
    const texto = respuesta.result?.content?.find((c) => c.type === "text")?.text;
    if (respuesta.result?.isError) throw new ErrorMcp(nombre, texto ?? "isError");
    if (texto === undefined) return undefined as T;
    try {
      return JSON.parse(texto) as T;
    } catch {
      return texto as unknown as T;
    }
  }
}

/** El transporte envía `event: message` + `data: {...}`, una trama por respuesta. */
function parsearSse(texto: string): unknown {
  for (const linea of texto.split("\n")) {
    if (!linea.startsWith("data:")) continue;
    const cuerpo = linea.slice(5).trim();
    if (!cuerpo) continue;
    return JSON.parse(cuerpo);
  }
  // Algunos despliegues responden JSON plano; se acepta igual.
  return JSON.parse(texto);
}
