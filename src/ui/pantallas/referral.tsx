"use client";

import type { EstadoPanel } from "../../agui/estado";
import { reloj_t } from "../formato";

/**
 * P2 · Referral (reloj 1) — §12.2.
 * Paciente sintético, criterios detectados con su cita textual resaltada,
 * cuenta regresiva de la ventana contractual, y escalamiento a humano.
 */
export function Referral({ estado }: { estado: EstadoPanel }) {
  const c = estado.caso;
  const cent = estado.centinela;
  const transcurrido_min = c.t_trigger !== null ? (estado.reloj.t_sim - c.t_trigger) / 60000 : 0;
  const restante = Math.max(0, c.ventanaMinutos - transcurrido_min);
  const urgente = restante < 15;

  return (
    <div className="cuerpo">
      <div>
        <div className="panel">
          <div className="panel-cab">
            <span className="panel-tit">Clock 1 · notification window</span>
            <span className="kpi-nota">42 CFR 482.45 · contractual, not federal</span>
          </div>
          <div className="panel-cuerpo">
            <div style={{ display: "flex", gap: 40, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <div className="kpi-et">Time left in window</div>
                <div
                  className="reloj-valor"
                  style={{ fontSize: 40, color: urgente ? "var(--critico)" : "var(--texto)" }}
                >
                  {c.t_trigger !== null ? `${Math.floor(restante)}:${String(Math.floor((restante % 1) * 60)).padStart(2, "0")}` : "--:--"}
                </div>
                <div className="kpi-nota">
                  of {c.ventanaMinutos} min · 81.8% of OPOs contract for 60
                </div>
              </div>
              <dl className="dl">
                <dt>Patient</dt><dd>{c.pacienteId ?? "—"}</dd>
                <dt>Donor record</dt><dd>{c.donanteId}</dd>
                <dt>Pathway</dt><dd>{c.via}</dd>
                <dt>Age / blood</dt><dd>{c.edad} · {c.grupoSanguineo}</dd>
                <dt>KDPI</dt><dd>{(c.kdpi * 100).toFixed(0)}%</dd>
                <dt>Case state</dt><dd>{c.estado}</dd>
                <dt>Trigger</dt><dd>{c.t_trigger !== null ? reloj_t(c.t_trigger) : "—"}</dd>
                <dt>Referral</dt><dd>{c.t_referral !== null ? reloj_t(c.t_referral) : "—"}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-cab">
            <span className="panel-tit">Criteria detected · each one cited</span>
            <span className="kpi-nota">explicit criteria only — no prognosis, no death determination</span>
          </div>
          <div className="panel-cuerpo">
            {c.criterios.length === 0 && <div className="vacio">Watching the ICU feed.</div>}
            {c.criterios.map((k) => (
              <div key={k.tipo} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 13 }}>{k.tipo.replace(/_/g, " ").toLowerCase()}</strong>
                  <span className="num" style={{ fontSize: 11, color: k.confianza >= 0.8 ? "var(--acento)" : "var(--aviso)" }}>
                    confidence {k.confianza.toFixed(2)}
                  </span>
                </div>
                <div className="cita" style={{ borderLeftColor: "var(--acento)" }}>“{k.literal}”</div>
                <div style={{ fontSize: 10.5, color: "var(--texto-3)", fontFamily: "var(--mono)" }}>
                  source: {k.referencia}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="panel">
          <div className="panel-cab"><span className="panel-tit">Sentinel performance</span></div>
          <div className="panel-cuerpo">
            {!cent && <div className="vacio">Not measured yet.</div>}
            {cent && (
              <dl className="dl">
                <dt>Sensitivity</dt>
                <dd className={cent.sensibilidad >= 0.95 ? "meta-ok" : "meta-no"}>{(cent.sensibilidad * 100).toFixed(1)}%</dd>
                <dt>False positives</dt>
                <dd className={cent.tasaFalsosPositivos <= 0.05 ? "meta-ok" : "meta-no"}>{(cent.tasaFalsosPositivos * 100).toFixed(1)}%</dd>
                <dt>Escalated</dt>
                <dd>{cent.escalamientosCorrectos}/{cent.limitrofesTotales} borderline</dd>
                <dt>Citations</dt>
                <dd className={cent.citasValidas === cent.criteriosReportados ? "meta-ok" : "meta-no"}>
                  {cent.citasValidas}/{cent.criteriosReportados}
                </dd>
              </dl>
            )}
            <p style={{ fontSize: 11.5, color: "var(--texto-3)", marginTop: 12, lineHeight: 1.5 }}>
              Measured over the labelled 200-patient synthetic ICU set. The tricky negatives are low-GCS
              patients whose chart documents sedation — the criterion does not hold and the note has to be read.
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-cab">
            <span className="panel-tit">Escalations · G7</span>
            <span className="kpi-nota num">{estado.escalamientos.length}</span>
          </div>
          <div className="panel-cuerpo" style={{ maxHeight: 380, overflowY: "auto" }}>
            {estado.escalamientos.length === 0 && <div className="vacio">None pending.</div>}
            {estado.escalamientos.slice(0, 25).map((e) => (
              <div key={e.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #f0f2f5" }}>
                <div className="num" style={{ fontSize: 11, color: "var(--texto-3)" }}>{e.id}</div>
                <div style={{ fontSize: 12, color: "var(--texto-2)" }}>{e.motivo}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
