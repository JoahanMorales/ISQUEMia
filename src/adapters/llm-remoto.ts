/**
 * ADAPTER — slots `LLM_NEGOCIACION`, `LLM_TRIAGE` contra un proveedor real
 * (OpenAI, o cualquier API compatible como OpenRouter).
 *
 * El problema que resuelve, y que manda sobre el diseño: los agentes de dominio
 * llaman al modelo desde callbacks agendados en el reloj de simulación, en
 * `completeSync`. Una promesa ahí dentro reordenaría los eventos y rompería la
 * reproducibilidad por semilla (§0.4.7). Por eso §5.2 principio 4 exige que el
 * camino síncrono se sirva **desde caché por hash de la entrada**:
 *
 *   · `complete()`    — llamada real, asíncrona. Se usa para precalentar.
 *   · `completeSync()` — solo caché. Acierto → respuesta real del modelo, con
 *                        sus tokens y su costo reales. Fallo → `null`, y quien
 *                        llama degrada de forma visible (G9): el evento
 *                        `DEGRADACION_PROVEEDOR` aparece en el registro y en el
 *                        panel, y el mapeo por reglas toma el relevo.
 *
 * `scripts/precalentar.ts` llena la caché corriendo la campaña una vez y
 * pidiéndole al modelo real cada entrada que apareció. A partir de ahí la misma
 * semilla corre con respuestas reales y sigue siendo determinista.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DefinicionHerramienta,
  Llm,
  Mensaje,
  RespuestaLlm,
  RouterModelos,
  TipoTarea,
} from "../domain/puertos";
import { MODELO_POR_TAREA, costoUSD, estimarTokens } from "./llm-guionado";

export interface EntradaCache {
  modelo: string;
  content: string;
  usage: { entrada: number; salida: number; costoUSD: number };
  /** Prompt original, para poder repoblar la caché cuando cambie el modelo. */
  peticion?: { messages: Mensaje[]; schema?: Record<string, unknown> };
}

/** Caché en disco compartida por todos los modelos. Clave: hash de la entrada. */
export class CacheLlm {
  #mapa = new Map<string, EntradaCache>();
  #ruta: string;
  #sucia = false;

  constructor(ruta = join(process.cwd(), ".cache", "llm.json")) {
    this.#ruta = ruta;
    if (existsSync(ruta)) {
      try {
        const crudo = JSON.parse(readFileSync(ruta, "utf8")) as Record<string, EntradaCache>;
        for (const [k, v] of Object.entries(crudo)) this.#mapa.set(k, v);
      } catch {
        // Una caché corrupta no puede tumbar una corrida: se ignora y se
        // reconstruye. El peor caso es degradar a reglas, que es visible.
      }
    }
  }

  static clave(modelo: string, messages: Mensaje[], schema?: Record<string, unknown>): string {
    const payload = JSON.stringify({
      modelo,
      messages: messages.map((m) => ({ rol: m.rol, contenido: m.contenido })),
      schema: schema ?? null,
    });
    return createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  get(clave: string): EntradaCache | undefined {
    return this.#mapa.get(clave);
  }

  set(clave: string, entrada: EntradaCache): void {
    this.#mapa.set(clave, entrada);
    this.#sucia = true;
  }

  get tamano(): number {
    return this.#mapa.size;
  }

  guardar(): void {
    if (!this.#sucia) return;
    mkdirSync(dirname(this.#ruta), { recursive: true });
    writeFileSync(this.#ruta, JSON.stringify(Object.fromEntries(this.#mapa), null, 2) + "\n", "utf8");
    this.#sucia = false;
  }
}

export interface OpcionesLlmRemoto {
  modelo: string;
  apiKey: string;
  baseUrl?: string;
  cache: CacheLlm;
  /** Se llama con cada entrada que faltó en caché, para poder precalentarla. */
  alFallarCache?: (peticion: { messages: Mensaje[]; schema?: Record<string, unknown> }) => void;
}

export class LlmRemoto implements Llm {
  readonly nombre = "remoto";
  readonly remoto = true;
  readonly modelo: string;
  #o: OpcionesLlmRemoto;

  constructor(opciones: OpcionesLlmRemoto) {
    this.#o = opciones;
    // El identificador del slot lleva prefijo de proveedor (`openai:gpt-5.4`);
    // la API quiere el nombre pelado.
    this.modelo = opciones.modelo;
  }

  get modeloApi(): string {
    const pelado = this.modelo.includes(":") ? this.modelo.slice(this.modelo.indexOf(":") + 1) : this.modelo;
    // OpenRouter nombra los modelos `proveedor/modelo`; la API de OpenAI los
    // quiere pelados. El slot los guarda como `openai:gpt-5.4`, así que aquí se
    // traduce según a dónde se esté llamando.
    const esOpenRouter = (this.#o.baseUrl ?? "").includes("openrouter.ai");
    if (!esOpenRouter) return pelado;
    const proveedor = this.modelo.includes(":") ? this.modelo.slice(0, this.modelo.indexOf(":")) : "openai";
    return `${proveedor}/${pelado}`;
  }

  async complete(
    messages: Mensaje[],
    tools?: DefinicionHerramienta[],
    schema?: Record<string, unknown>,
  ): Promise<RespuestaLlm> {
    const clave = CacheLlm.clave(this.modelo, messages, schema);
    const enCache = this.#o.cache.get(clave);
    if (enCache) return { content: enCache.content, toolCalls: [], usage: enCache.usage };

    const cuerpo: Record<string, unknown> = {
      model: this.modeloApi,
      messages: messages.map((m) => ({
        role: m.rol === "tool" ? "assistant" : m.rol,
        content: m.contenido,
      })),
    };

    // Salida estructurada: es lo que mide M6. Si el modelo devuelve algo que no
    // valida contra el esquema, el llamante lo cuenta como fallo de validación
    // en vez de tragárselo.
    if (schema) {
      cuerpo.response_format = {
        type: "json_schema",
        json_schema: {
          name: String((schema as { title?: string }).title ?? "salida"),
          strict: false,
          schema,
        },
      };
    }
    if (tools?.length) {
      cuerpo.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.nombre, description: t.descripcion, parameters: t.esquema },
      }));
    }

    const base = this.#o.baseUrl ?? "https://api.openai.com/v1";
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#o.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    });

    if (!r.ok) throw new Error(`${this.modeloApi}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);

    const j = (await r.json()) as {
      choices: { message: { content: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = j.choices[0]?.message?.content ?? "";
    const entrada = j.usage?.prompt_tokens ?? estimarTokens(messages.map((m) => m.contenido).join("\n"));
    const salida = j.usage?.completion_tokens ?? estimarTokens(content || " ");
    const usage = { entrada, salida, costoUSD: costoUSD(this.modelo, entrada, salida) };

    this.#o.cache.set(clave, { modelo: this.modelo, content, usage, peticion: { messages, schema } });
    return { content, toolCalls: [], usage };
  }

  completeSync(
    messages: Mensaje[],
    _tools?: DefinicionHerramienta[],
    schema?: Record<string, unknown>,
  ): RespuestaLlm | null {
    const entrada = this.#o.cache.get(CacheLlm.clave(this.modelo, messages, schema));
    if (!entrada) {
      // Que el llamante lo sepa y lo enseñe. Y que quede anotado para que
      // `npm run precalentar` lo resuelva en la siguiente pasada.
      this.#o.alFallarCache?.({ messages, schema });
      return null;
    }
    return { content: entrada.content, toolCalls: [], usage: entrada.usage };
  }
}

export interface OpcionesRouterRemoto {
  apiKey: string;
  baseUrl?: string;
  cache?: CacheLlm;
  alFallarCache?: (peticion: {
    tarea: TipoTarea;
    modelo: string;
    messages: Mensaje[];
    schema?: Record<string, unknown>;
  }) => void;
}

export class RouterRemoto implements RouterModelos {
  readonly nombre = "router-remoto";
  readonly cache: CacheLlm;
  #o: OpcionesRouterRemoto;
  #instancias = new Map<TipoTarea, Llm>();

  constructor(opciones: OpcionesRouterRemoto) {
    this.#o = opciones;
    this.cache = opciones.cache ?? new CacheLlm();
  }

  route(taskKind: TipoTarea): string {
    return MODELO_POR_TAREA[taskKind];
  }

  para(taskKind: TipoTarea): Llm {
    const existente = this.#instancias.get(taskKind);
    if (existente) return existente;
    const modelo = this.route(taskKind);
    const llm = new LlmRemoto({
      modelo,
      apiKey: this.#o.apiKey,
      baseUrl: this.#o.baseUrl,
      cache: this.cache,
      alFallarCache: (p) => this.#o.alFallarCache?.({ tarea: taskKind, modelo, ...p }),
    });
    this.#instancias.set(taskKind, llm);
    return llm;
  }
}
