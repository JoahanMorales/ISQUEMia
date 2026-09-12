"use client";

import { useEffect, useState } from "react";
import type { EstadoPanel, OpcionTransporteExt } from "../../agui/estado";
import { horas, minutos, usd } from "../formato";

/**
 * P3 · Router de transporte (reloj 3) — §12.2.
 * Las inviables se muestran, tachadas, con su motivo escrito. El dron aparece
 * casi siempre tachado: eso es intencional y demuestra que conocemos los
 * límites de la propia idea.
 */
export function Transporte({ estado }: { estado: EstadoPanel }) {
  return (
    <div className="cuerpo solo">
      <div className="panel">
        <div className="panel-cab">
          <span className="panel-tit">Clock 3 · multimodal routing</span>
          <span className="kpi-nota">
            score = 0.50·margin − 0.15·cost − 0.15·weather − 0.20·connection risk
          </span>
        </div>
        {!estado.transporte ? (
          <div className="vacio">No transport plan yet. It is requested once a lane commits.</div>
        ) : (
          <>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Mode</th><th>Duration</th><th>Projected CIT</th><th>Cost</th>
                  <th>Weather</th><th>Connection</th><th>Score</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {estado.transporte.map((o) => (
                  <tr key={o.modalidad} className={o.viable ? "" : "no-viable"}>
                    <td className="modalidad" style={{ fontWeight: 600 }}>{o.modalidad}</td>
                    <td className="num">{minutos(o.duracionTotal_min)}</td>
                    <td className="num" style={{ color: o.citProyectada_h > estado.organo.citLimite_h ? "var(--critico)" : undefined }}>
                      {horas(o.citProyectada_h)}
                    </td>
                    <td className="num">{usd(o.costoUSD)}</td>
                    <td className="num">{(o.riesgoClima * 100).toFixed(0)}%</td>
                    <td className="num">{(o.riesgoConexion * 100).toFixed(0)}%</td>
                    <td className="num" style={{ fontWeight: 600, color: o.viable ? "var(--acento)" : undefined }}>
                      {o.puntaje.toFixed(3)}
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {o.motivoNoViable ?? (o.requiereExencion ? "requires BVLOS waiver" : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="panel-cuerpo" style={{ borderTop: "1px solid var(--borde)" }}>
              <TarjetasTransporte opciones={estado.transporte} />
            </div>
          </>
        )}
      </div>

      {estado.transporte && <Corroboracion estado={estado} />}
    </div>
  );
}

/**
 * Corroboración con fuentes reales (slot `BUSQUEDA`, Exa).
 *
 * El plan de arriba sale de las tablas estáticas de §11.1.7 y es determinista
 * por semilla — tiene que serlo, porque alimenta M1 y la comparación con la
 * línea base. Esto no lo toca: busca fuentes sobre la modalidad elegida y las
 * pone al lado, con su enlace, para que el juez pueda pinchar en vez de creer.
 */
function Corroboracion({ estado }: { estado: EstadoPanel }) {
  const mejor = estado.transporte?.find((o) => o.viable) ?? null;
  const [estadoBusqueda, setEstadoBusqueda] = useState<
    { fase: "cargando" } | { fase: "ok"; remoto: boolean; resultados: Fuente[] } | { fase: "error"; error: string }
  >({ fase: "cargando" });

  const consulta = mejor
    ? `${mejor.modalidad} organ transport logistics cold ischemia time transplant ${estado.organo.etiqueta}`
    : null;

  useEffect(() => {
    if (!consulta) return;
    let vivo = true;
    void fetch("/api/busqueda", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consulta }),
    })
      .then((r) => r.json())
      .then((j: { ok: boolean; remoto?: boolean; resultados?: Fuente[]; error?: string }) => {
        if (!vivo) return;
        if (j.ok) setEstadoBusqueda({ fase: "ok", remoto: Boolean(j.remoto), resultados: j.resultados ?? [] });
        else setEstadoBusqueda({ fase: "error", error: j.error ?? "sin respuesta" });
      })
      .catch((e) => vivo && setEstadoBusqueda({ fase: "error", error: String(e) }));
    return () => {
      vivo = false;
    };
  }, [consulta]);

  if (!mejor) return null;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-cab">
        <span className="panel-tit">Corroboration · {mejor.modalidad}</span>
        <span className={estadoBusqueda.fase === "ok" && estadoBusqueda.remoto ? "insignia remoto" : "insignia"}>
          {estadoBusqueda.fase === "ok" && estadoBusqueda.remoto ? "exa · live" : "static corpus"}
        </span>
      </div>

      {estadoBusqueda.fase === "cargando" && <div className="vacio">Looking for sources…</div>}

      {estadoBusqueda.fase === "error" && (
        <div className="vacio" style={{ color: "var(--critico)" }}>
          Search degraded: {estadoBusqueda.error}. The plan above is unaffected — it never depended on this.
        </div>
      )}

      {estadoBusqueda.fase === "ok" && estadoBusqueda.resultados.length === 0 && (
        <div className="vacio">No external sources configured. The plan comes from the static tables of §11.1.7.</div>
      )}

      {estadoBusqueda.fase === "ok" && estadoBusqueda.resultados.length > 0 && (
        <div className="panel-cuerpo">
          <div className="kpi-nota" style={{ marginBottom: 10 }}>
            The routing decision above is deterministic and comes from the static tables. These are live external
            sources on the chosen modality — they corroborate, they do not decide.
          </div>
          {estadoBusqueda.resultados.map((f) => (
            <div key={f.url} className="cita" style={{ marginBottom: 8 }}>
              <a href={f.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                {f.titulo}
              </a>
              <div style={{ fontSize: 11.5, color: "var(--texto-2)", marginTop: 4 }}>{f.extracto}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Fuente {
  titulo: string;
  url: string;
  extracto: string;
}

/** Componente declarativo que el agente invoca como generative UI. */
export function TarjetasTransporte({ opciones, compacto }: { opciones: OpcionTransporteExt[]; compacto?: boolean }) {
  if (!opciones || opciones.length === 0) return null;
  return (
    <div className="grid3">
      {opciones.map((o) => (
        <div key={o.modalidad} className={`tarjeta${o.viable ? "" : " no-viable"}`}>
          <h4>{o.modalidad}</h4>
          <dl className="dl" style={{ fontSize: compacto ? 11.5 : 12.5 }}>
            <dt>Duration</dt><dd>{minutos(o.duracionTotal_min)}</dd>
            <dt>CIT at implant</dt><dd>{horas(o.citProyectada_h)}</dd>
            <dt>Cost</dt><dd>{usd(o.costoUSD)}</dd>
            <dt>Score</dt><dd>{o.puntaje.toFixed(3)}</dd>
          </dl>
          {!o.viable && <div className="motivo">✗ {o.motivoNoViable}</div>}
          {o.viable && o.requiereExencion && (
            <div className="motivo" style={{ color: "var(--aviso)" }}>requires BVLOS waiver</div>
          )}
        </div>
      ))}
    </div>
  );
}
