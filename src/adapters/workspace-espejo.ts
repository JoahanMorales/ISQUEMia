/**
 * ADAPTER — slot `WORKSPACE`, implementación local.
 *
 * Materializa exactamente las mismas escrituras que el adaptador de Ambiguous
 * AI, pero dentro de la app. Así el panel de Workspace nunca queda vacío por
 * falta de una credencial: lo que se ve es lo que se enviaría.
 */

import type { AppWorkspace, ItemWorkspace, Reloj, Workspace } from "../domain/puertos";
import type { Actor, Cita, ExpedienteAOOS } from "../domain/tipos";

export class WorkspaceEspejo implements Workspace {
  readonly nombre = "espejo-local";
  readonly remoto = false;
  #items: ItemWorkspace[] = [];
  #n = 0;

  constructor(private reloj: Reloj) {}

  items(): ItemWorkspace[] {
    return [...this.#items];
  }

  #crear(app: AppWorkspace, titulo: string, cuerpo: string, autor: Actor, meta: Record<string, unknown> = {}): ItemWorkspace {
    const item: ItemWorkspace = {
      id: `WS-${String(++this.#n).padStart(4, "0")}`,
      app,
      titulo,
      cuerpo,
      url: null,
      t_sim: this.reloj.now(),
      autor,
      meta,
    };
    this.#items.push(item);
    return item;
  }

  async publicarExpediente(expediente: ExpedienteAOOS, autor: Actor): Promise<ItemWorkspace> {
    return this.#crear("docs", `AOOS justification — ${expediente.organoId}`, renderExpediente(expediente), autor, {
      cobertura: expediente.cobertura,
      firmaHash: expediente.firmaHash,
      secuenciaFinal: expediente.secuenciaFinal,
    });
  }

  async crearTarea(e: { titulo: string; cuerpo: string; asignadoA: string; prioridad: string; autor: Actor }): Promise<ItemWorkspace> {
    return this.#crear("tasks", e.titulo, e.cuerpo, e.autor, { asignadoA: e.asignadoA, prioridad: e.prioridad, estado: "open" });
  }

  async publicarEnCanal(e: { canal: string; texto: string; autor: Actor; citas?: Cita[] }): Promise<ItemWorkspace> {
    return this.#crear("chat", `#${e.canal}`, e.texto, e.autor, { canal: e.canal, citas: e.citas ?? [] });
  }

  async registrarActividadCrm(e: {
    centroId: string;
    centroNombre: string;
    resumen: string;
    carril: { id: string; estado: string; codigoRechazo: string | null };
    autor: Actor;
  }): Promise<ItemWorkspace> {
    return this.#crear("crm", e.centroNombre, e.resumen, e.autor, {
      centroId: e.centroId,
      carrilId: e.carril.id,
      estado: e.carril.estado,
      codigoRechazo: e.carril.codigoRechazo,
    });
  }

  async enviarCorreo(e: { para: string; asunto: string; cuerpo: string; autor: Actor }): Promise<ItemWorkspace> {
    return this.#crear("mail", e.asunto, e.cuerpo, e.autor, { para: e.para });
  }

  async escribirHoja(e: { hoja: string; filas: Record<string, unknown>[]; autor: Actor }): Promise<ItemWorkspace> {
    return this.#crear("sheets", e.hoja, JSON.stringify(e.filas, null, 2), e.autor, { filas: e.filas });
  }

  async subirArchivo(e: { nombre: string; contenido: string; autor: Actor }): Promise<ItemWorkspace> {
    return this.#crear("drive", e.nombre, e.contenido, e.autor, { bytes: e.contenido.length });
  }
}

export function renderExpediente(x: ExpedienteAOOS): string {
  const lineas: string[] = [
    `# AOOS justification — ${x.organoId}`,
    "",
    `Donor: ${x.donanteResumen}`,
    `Final match run sequence: ${x.secuenciaFinal > 0 ? `#${x.secuenciaFinal}` : "not placed"}`,
    `Offers issued: ${x.totalOfertas}`,
    `Citation coverage: ${(x.cobertura * 100).toFixed(0)}%${x.cobertura < 1 ? "  ← INCOMPLETE, shown on purpose" : ""}`,
    `Signature: ${x.firmaHash}`,
    "",
    "## Justification",
  ];
  for (const o of x.justificacion) {
    lineas.push(`- ${o.texto}`, `  ↳ events: ${o.eventos.join(", ") || "none"}`);
  }
  if (x.degradaciones.length) {
    lineas.push("", "## Downgraded provisional acceptances");
    for (const d of x.degradaciones) {
      lineas.push(`- ${d.centroId}: missing ${d.camposFaltantes.join(", ")} · ${d.horasProtegidas} h protected`);
    }
  }
  lineas.push("", "## Refusals");
  for (const r of x.rechazos) {
    lineas.push(`- #${r.secuencia} ${r.centroId} — ${r.codigo} — "${r.citaLiteral}"`);
  }
  return lineas.join("\n");
}
