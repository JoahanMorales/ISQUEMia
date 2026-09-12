"use client";

import type { EstadoPanel } from "../../agui/estado";
import { reloj_t } from "../formato";

/**
 * Espejo del workspace (Ambiguous AI).
 *
 * Lo que se ve aquí es exactamente lo que se escribe en el workspace real
 * cuando hay credencial: mismo documento, misma tarea, mismo mensaje. Sin
 * credencial no queda un hueco en la pantalla, queda el espejo.
 */
const ICONO: Record<string, string> = {
  docs: "Doc", tasks: "Task", chat: "Chat", crm: "CRM", mail: "Mail", sheets: "Sheet", drive: "Drive",
};

export function PanelWorkspace({ estado }: { estado: EstadoPanel }) {
  const ws = estado.adaptadores.find((a) => a.slot === "WORKSPACE");

  return (
    <div className="cuerpo solo">
      <div className="panel">
        <div className="panel-cab">
          <span className="panel-tit">Workspace · where the file lands in human hands</span>
          <span className={`insignia${ws?.remoto ? " remoto" : ""}`}>
            <span className="pt" />
            {ws?.remoto ? "writing to Ambiguous" : "local mirror — same payload, no credential"}
          </span>
        </div>
        <div className="panel-cuerpo">
          {estado.workspace.length === 0 && (
            <div className="vacio">Nothing written yet. The AOOS file is published when the campaign closes.</div>
          )}
          {estado.workspace.map((i) => (
            <div key={i.id} className="tarjeta" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div>
                  <span className="insignia" style={{ marginRight: 8 }}><span className="pt" />{ICONO[i.app] ?? i.app}</span>
                  <strong style={{ fontSize: 13 }}>{i.titulo}</strong>
                </div>
                <span className="num" style={{ fontSize: 11, color: "var(--texto-3)" }}>
                  {reloj_t(i.t_sim)} · {i.autor}
                </span>
              </div>
              <pre style={{
                margin: 0, fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap",
                fontFamily: "var(--mono)", color: "var(--texto-2)", maxHeight: 320, overflowY: "auto",
              }}>
                {i.cuerpo}
              </pre>
              {i.url && <a href={i.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>open in Ambiguous →</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
