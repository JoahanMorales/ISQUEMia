"use client";

import { useState } from "react";
import type { EstadoPanel } from "../../agui/estado";
import type { ExpedienteAOOS } from "../../domain/tipos";
import { reloj_t } from "../formato";

/**
 * P4 · Expediente AOOS — §12.2 y §8.5.
 * Documento navegable: cada oración enlaza al evento que la respalda y el
 * indicador de cobertura está siempre visible. Si la cobertura es < 1.0 se
 * muestra, no se esconde: mostrarlo es una fortaleza.
 */
export function Expediente({ estado }: { estado: EstadoPanel }) {
  const x = estado.expediente;
  const [evento, setEvento] = useState<string | null>(null);
  const detalle = evento ? estado.eventos.find((e) => e.id === evento) ?? null : null;

  if (!x) {
    return (
      <div className="cuerpo solo">
        <div className="panel"><div className="vacio">The Scribe writes the file when the campaign closes.</div></div>
      </div>
    );
  }

  return (
    <div className="cuerpo">
      <div className="panel">
        <div className="panel-cab">
          <span className="panel-tit">AOOS justification file</span>
          <Cobertura valor={x.cobertura} />
        </div>
        <div className="panel-cuerpo">
          <dl className="dl" style={{ marginBottom: 16 }}>
            <dt>Organ</dt><dd>{x.organoId}</dd>
            <dt>Donor</dt><dd>{x.donanteResumen}</dd>
            <dt>Final sequence</dt><dd>{x.secuenciaFinal > 0 ? `#${x.secuenciaFinal}` : "not placed"}</dd>
            <dt>Offers issued</dt><dd>{x.totalOfertas}</dd>
            <dt>Signature</dt><dd style={{ fontSize: 11 }}>{x.firmaHash}</dd>
          </dl>

          <div className="panel-tit" style={{ marginBottom: 8 }}>Justification</div>
          {x.justificacion.map((o, i) => (
            <p key={i} style={{ margin: "0 0 12px", lineHeight: 1.55, fontSize: 13.5 }}>
              {o.texto}{" "}
              {o.eventos.map((id) => (
                <button
                  key={id}
                  onClick={() => setEvento(id)}
                  title={id}
                  style={{
                    border: "none", background: "var(--info-suave)", color: "var(--info)",
                    borderRadius: 3, padding: "0 4px", fontFamily: "var(--mono)", fontSize: 10,
                    marginRight: 3,
                  }}
                >
                  {id.split("#")[1] ?? id}
                </button>
              ))}
            </p>
          ))}

          {x.degradaciones.length > 0 && (
            <>
              <div className="panel-tit" style={{ margin: "18px 0 8px" }}>Downgraded provisional acceptances</div>
              <table className="tabla">
                <thead><tr><th>Center</th><th>Missing</th><th>Time</th><th>Protected</th></tr></thead>
                <tbody>
                  {x.degradaciones.map((d, i) => (
                    <tr key={i}>
                      <td className="num">{d.centroId}</td>
                      <td style={{ color: "var(--critico)" }}>{d.camposFaltantes.join(", ")}</td>
                      <td className="num">{reloj_t(d.t_sim)}</td>
                      <td className="num">{d.horasProtegidas} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="panel-tit" style={{ margin: "18px 0 8px" }}>Refusals ({x.rechazos.length})</div>
          <table className="tabla">
            <thead><tr><th>Seq</th><th>Center</th><th>Code</th><th>What they said</th></tr></thead>
            <tbody>
              {x.rechazos.map((r, i) => (
                <tr key={i}>
                  <td className="num">#{r.secuencia}</td>
                  <td className="num">{r.centroId}</td>
                  <td className="num" style={{ fontSize: 11 }}>{r.codigo}</td>
                  <td style={{ fontStyle: "italic", color: "var(--texto-2)" }}>“{r.citaLiteral}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ position: "sticky", top: 150, alignSelf: "start" }}>
        <div className="panel-cab"><span className="panel-tit">Backing event</span></div>
        <div className="panel-cuerpo">
          {!detalle && <div className="vacio">Click any citation chip to see the event that backs it.</div>}
          {detalle && (
            <>
              <dl className="dl" style={{ marginBottom: 10 }}>
                <dt>Id</dt><dd style={{ fontSize: 11 }}>{detalle.id}</dd>
                <dt>Sim time</dt><dd>{reloj_t(detalle.t_sim)}</dd>
                <dt>Actor</dt><dd>{detalle.actor}</dd>
                <dt>Type</dt><dd style={{ fontSize: 11 }}>{detalle.tipo}</dd>
              </dl>
              <pre style={{
                fontSize: 11, background: "var(--superficie-2)", padding: 10, borderRadius: 4,
                overflowX: "auto", border: "1px solid var(--borde)", margin: 0,
              }}>
                {JSON.stringify(detalle.payload, null, 2)}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Cobertura({ valor }: { valor: number }) {
  const completo = valor >= 1;
  return (
    <span className={`insignia${completo ? " remoto" : ""}`} style={completo ? undefined : { borderColor: "var(--aviso-borde)", background: "var(--aviso-suave)", color: "var(--aviso)" }}>
      <span className="pt" />
      citation coverage {(valor * 100).toFixed(0)}%{completo ? "" : " · incomplete, shown on purpose"}
    </span>
  );
}

/** Generative UI: el agente emite `mostrarExpediente` y esto lo renderiza. */
export function TarjetaExpediente({ expediente }: { expediente: ExpedienteAOOS }) {
  if (!expediente?.organoId) return null;
  return (
    <div className="tarjeta">
      <h4>AOOS file · {expediente.organoId}</h4>
      <Cobertura valor={expediente.cobertura ?? 0} />
      <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 12, lineHeight: 1.5 }}>
        {(expediente.justificacion ?? []).slice(0, 3).map((o, i) => (
          <li key={i}>{o.texto}</li>
        ))}
      </ul>
      <div style={{ fontSize: 10.5, color: "var(--texto-3)", marginTop: 8, fontFamily: "var(--mono)" }}>
        {expediente.firmaHash}
      </div>
    </div>
  );
}
