/**
 * ADAPTER — slot `WORKSPACE` sobre Ambiguous AI, vía MCP.
 *
 * Escribe **siempre en los dos sitios**: en el espejo local, para que el panel
 * nunca tenga un hueco ni dependa de la red; y en el workspace real, en cuanto
 * la llamada vuelve, rellenando el enlace. Si la red falla, el espejo ya está
 * pintado y la degradación se emite como evento en vez de perderse (G9).
 *
 * Las ocho superficies del workspace que ISQUEMIA usa:
 *   Docs   — expediente AOOS navegable
 *   Tasks  — escalamiento a humano con su paquete de contexto (G7)
 *   Chat   — canal de operación, un mensaje por hito, firmado por su agente
 *   CRM    — nada por ahora: los centros sintéticos no son contactos reales
 *   Mail   — notificación de referral al OPO con la cita del criterio
 *   Sheets — las nueve métricas por semilla, para la suite de evaluación
 *   Drive  — cadena de custodia
 */

import type { AppWorkspace, ItemWorkspace, Reloj, Workspace } from "../domain/puertos";
import type { Actor, Cita, ExpedienteAOOS } from "../domain/tipos";
import { ClienteMcp } from "./mcp-ambiguous";
import { renderExpediente, WorkspaceEspejo } from "./workspace-espejo";

export const CANAL_OPERACION = "isquemia-ops";

export interface OpcionesWorkspaceAmbiguous {
  reloj: Reloj;
  apiKey: string;
  baseUrl?: string;
  /** Base para construir enlaces visibles al recurso creado. */
  appUrl?: string;
  /** Se llama cuando una escritura remota falla: el llamante emite el evento G9. */
  alDegradar?: (detalle: { operacion: string; error: string }) => void;
}

export class WorkspaceAmbiguous implements Workspace {
  readonly nombre = "ambiguous";
  readonly remoto = true;

  #mcp: ClienteMcp;
  #espejo: WorkspaceEspejo;
  #appUrl: string;
  #o: OpcionesWorkspaceAmbiguous;
  #canalId: Promise<string | null> | null = null;

  constructor(opciones: OpcionesWorkspaceAmbiguous) {
    this.#o = opciones;
    this.#espejo = new WorkspaceEspejo(opciones.reloj);
    this.#appUrl = opciones.appUrl ?? "https://app.ambiguous.ai";
    this.#mcp = new ClienteMcp({
      baseUrl: opciones.baseUrl ?? "https://app.ambiguous.ai/mcp",
      apiKey: opciones.apiKey,
    });
  }

  items(): ItemWorkspace[] {
    return this.#espejo.items();
  }

  /**
   * Escribe en el espejo primero y devuelve ese item de inmediato; la llamada
   * remota completa el `url` cuando vuelve. El panel nunca espera a la red.
   */
  async #conEspejo(
    local: Promise<ItemWorkspace>,
    operacion: string,
    remoto: () => Promise<string | null>,
  ): Promise<ItemWorkspace> {
    const item = await local;
    try {
      const url = await remoto();
      if (url) item.url = url;
      item.meta.remoto = true;
    } catch (e) {
      item.meta.remoto = false;
      item.meta.errorRemoto = e instanceof Error ? e.message : String(e);
      this.#o.alDegradar?.({ operacion, error: String(item.meta.errorRemoto) });
    }
    return item;
  }

  #enlace(app: AppWorkspace, id: string | undefined): string | null {
    if (!id) return null;
    const ruta: Record<AppWorkspace, string> = {
      docs: "docs", sheets: "docs", tasks: "tasks", chat: "chat",
      crm: "crm", mail: "mail", drive: "drive",
    };
    return `${this.#appUrl}/${ruta[app]}/${id}`;
  }

  // ------------------------------------------------------------------ docs

  async publicarExpediente(expediente: ExpedienteAOOS, autor: Actor): Promise<ItemWorkspace> {
    return this.#conEspejo(
      this.#espejo.publicarExpediente(expediente, autor),
      "docs.create",
      async () => {
        const doc = await this.#mcp.llamar<{ id?: string }>("create_document", {
          type: "doc",
          title: `AOOS justification — ${expediente.organoId}`,
          content: renderExpediente(expediente),
        });
        return this.#enlace("docs", doc?.id);
      },
    );
  }

  // ----------------------------------------------------------------- tasks

  async crearTarea(e: {
    titulo: string; cuerpo: string; asignadoA: string;
    prioridad: "baja" | "media" | "alta" | "critica"; autor: Actor;
  }): Promise<ItemWorkspace> {
    const PRIORIDAD = { baja: "low", media: "medium", alta: "high", critica: "urgent" } as const;
    return this.#conEspejo(this.#espejo.crearTarea(e), "tasks.create", async () => {
      const r = await this.#mcp.llamar<{ task?: { id?: string; task_key?: string } }>("create_task", {
        title: e.titulo,
        description: e.cuerpo,
        priority: PRIORIDAD[e.prioridad],
        status: "todo",
      });
      return this.#enlace("tasks", r?.task?.id);
    });
  }

  // ------------------------------------------------------------------ chat

  /** El canal de operación se crea una sola vez por proceso. */
  async #canalOperacion(): Promise<string | null> {
    this.#canalId ??= (async () => {
      try {
        const lista = await this.#mcp.llamar<{ data?: { id: string; name: string }[] }>("list_channels", {});
        const existente = lista?.data?.find((c) => c.name === CANAL_OPERACION);
        if (existente) return existente.id;
        const creado = await this.#mcp.llamar<{ id?: string; channel?: { id?: string } }>("chat_channel_create", {
          type: "public",
          name: CANAL_OPERACION,
          description: "ISQUEMIA placement agents — synthetic data only, no PHI.",
        });
        return creado?.id ?? creado?.channel?.id ?? null;
      } catch {
        return null;
      }
    })();
    return this.#canalId;
  }

  async publicarEnCanal(e: { canal: string; texto: string; autor: Actor; citas?: Cita[] }): Promise<ItemWorkspace> {
    return this.#conEspejo(this.#espejo.publicarEnCanal(e), "chat.send", async () => {
      const canalId = await this.#canalOperacion();
      if (!canalId) return null;
      const citas = (e.citas ?? [])
        .map((c) => `> “${c.literal}” — \`${c.referencia}\``)
        .join("\n");
      await this.#mcp.llamar("send_message", {
        channel_id: canalId,
        content: `**${e.autor}** · ${e.texto}${citas ? `\n${citas}` : ""}`,
      });
      return this.#enlace("chat", canalId);
    });
  }

  // ------------------------------------------------------------------- crm

  async registrarActividadCrm(e: {
    centroId: string; centroNombre: string; resumen: string;
    carril: { id: string; estado: string; codigoRechazo: string | null }; autor: Actor;
  }): Promise<ItemWorkspace> {
    // Los centros son sintéticos: no se crean contactos reales en el CRM del
    // equipo. La actividad queda en el espejo y se refleja en el canal.
    return this.#espejo.registrarActividadCrm(e);
  }

  // ------------------------------------------------------------------ mail

  async enviarCorreo(e: { para: string; asunto: string; cuerpo: string; autor: Actor }): Promise<ItemWorkspace> {
    return this.#conEspejo(this.#espejo.enviarCorreo(e), "mail.send", async () => {
      const r = await this.#mcp.llamar<{ id?: string; message?: { id?: string } }>("send_email", {
        to: [e.para],
        subject: e.asunto,
        body_markdown: e.cuerpo,
      });
      return this.#enlace("mail", r?.id ?? r?.message?.id);
    });
  }

  // ---------------------------------------------------------------- sheets

  async escribirHoja(e: { hoja: string; filas: Record<string, unknown>[]; autor: Actor }): Promise<ItemWorkspace> {
    return this.#conEspejo(this.#espejo.escribirHoja(e), "sheets.create", async () => {
      const r = await this.#mcp.llamar<{ id?: string }>("create_sheet", {
        title: e.hoja,
        content: JSON.stringify(e.filas),
      });
      return this.#enlace("sheets", r?.id);
    });
  }

  // ----------------------------------------------------------------- drive

  async subirArchivo(e: { nombre: string; contenido: string; autor: Actor }): Promise<ItemWorkspace> {
    // La subida a Drive necesita init + confirm con GCS; la cadena de custodia
    // se publica como documento, que es donde alguien la va a leer de todos modos.
    return this.#conEspejo(this.#espejo.subirArchivo(e), "docs.create", async () => {
      const doc = await this.#mcp.llamar<{ id?: string }>("create_document", {
        type: "doc",
        title: e.nombre,
        content: e.contenido,
      });
      return this.#enlace("docs", doc?.id);
    });
  }

  /** Identidad de la llave, para mostrarla en el panel. */
  async identidad(): Promise<{ display_name?: string; username?: string; workspace_id?: string } | null> {
    try {
      return await this.#mcp.llamar("auth_whoami", {});
    } catch {
      return null;
    }
  }
}
