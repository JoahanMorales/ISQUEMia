"use client";

import { useEffect, useState } from "react";
import type { EstadoPanel } from "../../agui/estado";

/** Forma de `evals/resultados.json`, escrita por `npm run evals` (§14.4). */
interface FilaEval {
  semilla: string;
  organo: string;
  secuenciaAgente: number | null;
  secuenciaBaseline: number | null;
  citAgente_h: number | null;
  citBaseline_h: number | null;
  bloqueantesEnMeta: boolean;
  metricas: {
    M1_horasIsquemiaAhorradas: number;
    M3_tasa: number;
    M5_tasaCompletitudCarril: number;
    M6_precisionUsoHerramientas: number;
    M9_tasaCitacion: number;
  };
}

interface ResultadosEval {
  generado: string;
  semillas: number;
  aprobado: boolean;
  agregado: {
    M1_medio_comparables: number;
    M1_comparables: number;
    M3_medio: number;
    M5_min: number;
    M6_min: number;
    M9_min: number;
    M8_total: number;
    colocadas: number;
    baselineColoco: number;
    organosSalvados: number;
  };
  filas: FilaEval[];
}

/**
 * P5 · Panel de métricas — §14.3.
 * Las nueve cifras, en vivo. Esta es la pantalla de los últimos veinte
 * segundos del pitch. Las que no cumplen se muestran en rojo, no se ocultan.
 */
export function Metricas({ estado }: { estado: EstadoPanel }) {
  const m = estado.metricas;
  const suite = useSuite();

  return (
    <div className="cuerpo solo">
      <div className="panel">
        <div className="panel-cab">
          <span className="panel-tit">The nine numbers · seed {estado.semilla}</span>
          <span className="kpi-nota">
            p50 {estado.spans.p50_ms.toFixed(0)} ms · p95 {estado.spans.p95_ms.toFixed(0)} ms ·
            {" "}{estado.spans.validados}/{estado.spans.conEsquema} schema-valid
          </span>
        </div>

        {!m ? (
          <div className="vacio">Computed when the run finishes. Everything above is already live.</div>
        ) : (
          <div className="panel-cuerpo">
            <div className="grid2">
              {m.evaluacion.map((e) => (
                <div key={e.metrica} className="tarjeta" style={{ borderColor: e.cumple ? "var(--acento-borde)" : "var(--critico-borde)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span className="kpi-et">{e.metrica} · {NOMBRES[e.metrica]}</span>
                    <span className={e.cumple ? "meta-ok" : "meta-no"}>{e.cumple ? "meets" : "misses"}</span>
                  </div>
                  <div className="kpi-val" style={{ fontSize: 30, color: e.cumple ? "var(--acento)" : "var(--critico)" }}>
                    {formato(e.metrica, e.valor)}
                  </div>
                  <div className="kpi-nota">target {e.meta}</div>
                  {NOTA[e.metrica] && (
                    <div style={{ fontSize: 11, color: "var(--texto-3)", marginTop: 6, lineHeight: 1.4 }}>{NOTA[e.metrica]}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="panel-tit" style={{ margin: "20px 0 8px" }}>Agent vs. serial baseline · same seed</div>
            <table className="tabla">
              <thead><tr><th></th><th>Agent</th><th>Serial baseline</th></tr></thead>
              <tbody>
                <tr>
                  <td>Placed at sequence</td>
                  <td className="num">{estado.resumen.mejorSecuencia !== null ? `#${estado.resumen.mejorSecuencia}` : "—"}</td>
                  <td className="num">{estado.baseline.secuenciaFinal !== null ? `#${estado.baseline.secuenciaFinal}` : "—"}</td>
                </tr>
                <tr>
                  <td>Offers issued</td>
                  <td className="num">{m.M4_ofertasPorColocacion}</td>
                  <td className="num">{m.M4_ofertasBaseline}</td>
                </tr>
                <tr>
                  <td>Late refusals waited on</td>
                  <td className="num">0</td>
                  <td className="num" style={{ color: estado.baseline.rechazosTardios ? "var(--critico)" : undefined }}>
                    {estado.baseline.rechazosTardios}
                  </td>
                </tr>
                <tr>
                  <td>Provisional yes intercepted</td>
                  <td className="num">{m.M3_provisionalYesInterceptados}/{m.M3_provisionalYesTotales}</td>
                  <td className="num">0 — accepted at face value</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-cab"><span className="panel-tit">Adapters in this run</span></div>
        <div className="panel-cuerpo">
          <table className="tabla">
            <thead><tr><th>Slot</th><th>Implementation</th><th>Mode</th><th>Why</th></tr></thead>
            <tbody>
              {estado.adaptadores.map((a) => (
                <tr key={a.slot}>
                  <td className="num" style={{ fontSize: 11 }}>{a.slot}</td>
                  <td>{a.implementacion}</td>
                  <td>
                    <span className={`insignia${a.remoto ? " remoto" : ""}`}><span className="pt" />{a.remoto ? "remote" : "local"}</span>
                  </td>
                  <td style={{ color: "var(--texto-3)", fontSize: 11.5 }}>{a.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SuiteRegresion suite={suite} />
    </div>
  );
}

/**
 * La suite de diez semillas. Una corrida buena puede ser suerte de semilla; esto
 * es la respuesta al juez que lo pregunte. Se lee del archivo que escribe
 * `npm run evals`, no se recalcula en el navegador.
 */
function SuiteRegresion({ suite }: { suite: ResultadosEval | "cargando" | null }) {
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-cab">
        <span className="panel-tit">Ten-seed regression suite · §14.4</span>
        {suite && suite !== "cargando" && (
          <span className={suite.aprobado ? "meta-ok" : "meta-no"}>
            {suite.aprobado ? "M5 · M6 · M9 in target on all ten" : "blocking metric out of target"}
          </span>
        )}
      </div>

      {suite === "cargando" && <div className="vacio">Reading evals/resultados.json…</div>}

      {suite === null && (
        <div className="vacio">
          No suite results yet. Run <code>npm run evals</code> — it writes <code>evals/resultados.json</code> and
          fails the build if M5, M6 or M9 fall below target on any seed.
        </div>
      )}

      {suite && suite !== "cargando" && (
        <div className="panel-cuerpo">
          <div className="grid2" style={{ marginBottom: 14 }}>
            <div className="tarjeta">
              <span className="kpi-et">Placed by the agent</span>
              <div className="kpi-val" style={{ fontSize: 30 }}>
                {suite.agregado.colocadas}/{suite.semillas}
              </div>
              <div className="kpi-nota">serial baseline placed {suite.agregado.baselineColoco}/{suite.semillas}</div>
            </div>
            <div className="tarjeta" style={{ borderColor: "var(--acento-borde)" }}>
              <span className="kpi-et">Organs the baseline lost and the agent placed</span>
              <div className="kpi-val" style={{ fontSize: 30, color: "var(--acento)" }}>
                {suite.agregado.organosSalvados}/{suite.semillas}
              </div>
              <div className="kpi-nota">
                on those seeds there are no “hours saved” to report: the serial run exhausted the match run
              </div>
            </div>
          </div>

          <table className="tabla">
            <thead>
              <tr>
                <th>Seed</th><th>Agent</th><th>Baseline</th><th>CIT agent</th><th>CIT baseline</th>
                <th>M1</th><th>M3</th><th>M5</th><th>M6</th><th>M9</th><th></th>
              </tr>
            </thead>
            <tbody>
              {suite.filas.map((f) => (
                <tr key={f.semilla}>
                  <td className="num">{f.semilla}</td>
                  <td className="num">{f.secuenciaAgente !== null ? `#${f.secuenciaAgente}` : "—"}</td>
                  <td className="num">{f.secuenciaBaseline !== null ? `#${f.secuenciaBaseline}` : "lost"}</td>
                  <td className="num">{f.citAgente_h !== null ? `${f.citAgente_h.toFixed(1)} h` : "—"}</td>
                  <td className="num">{f.citBaseline_h !== null ? `${f.citBaseline_h.toFixed(1)} h` : "—"}</td>
                  <td className="num">
                    {f.secuenciaBaseline !== null ? `${f.metricas.M1_horasIsquemiaAhorradas.toFixed(2)} h` : "n/a"}
                  </td>
                  <td className="num">{f.metricas.M3_tasa.toFixed(2)}</td>
                  <td className="num">{f.metricas.M5_tasaCompletitudCarril.toFixed(3)}</td>
                  <td className="num">{f.metricas.M6_precisionUsoHerramientas.toFixed(3)}</td>
                  <td className="num">{f.metricas.M9_tasaCitacion.toFixed(3)}</td>
                  <td className={f.bloqueantesEnMeta ? "meta-ok" : "meta-no"}>{f.bloqueantesEnMeta ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="kpi-nota" style={{ marginTop: 10 }}>
            M1 averages {suite.agregado.M1_medio_comparables} h over the {suite.agregado.M1_comparables} seeds where
            both runs placed · M3 {suite.agregado.M3_medio} · suite cost ${suite.agregado.M8_total} ·
            {/* lint-reloj: permitido — formatea la marca de tiempo del archivo de la suite */}
            generated {new Date(suite.generado).toLocaleString() /* lint-reloj: permitido — sello del archivo */}
          </div>
        </div>
      )}
    </div>
  );
}

function useSuite(): ResultadosEval | "cargando" | null {
  const [suite, setSuite] = useState<ResultadosEval | "cargando" | null>("cargando");
  useEffect(() => {
    let vivo = true;
    void fetch("/api/evals")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { resultados: ResultadosEval } | null) => {
        if (vivo) setSuite(j?.resultados ?? null);
      })
      .catch(() => vivo && setSuite(null));
    return () => {
      vivo = false;
    };
  }, []);
  return suite;
}

const NOMBRES: Record<string, string> = {
  M1: "ischemia hours saved", M2: "time to first commitment", M3: "false provisional yes intercepted",
  M4: "offers per placement", M5: "lane completion rate", M6: "tool-use accuracy",
  M7: "lane latency p95", M8: "cost per placement", M9: "citation rate",
};

const NOTA: Record<string, string> = {
  M4: "Opening 40 evaluation lanes costs more contacts than a lucky serial run on one seed. Read this across the ten-seed suite, not on one.",
  M9: "Target is exactly 1.00 on purpose: it is the measurable stand-in for “does not hallucinate” in a clinical domain.",
  M8: "Priced at the real tariff of the model each local adapter stands in for.",
};

function formato(metrica: string, v: number | null): string {
  if (v === null) return "—";
  switch (metrica) {
    case "M1": return `${v.toFixed(2)} h`;
    case "M2": return `${(v * 100).toFixed(1)}%`;
    case "M3": case "M5": case "M6": case "M9": return v.toFixed(2);
    case "M7": return `${v.toFixed(0)} ms`;
    case "M8": return `$${v.toFixed(4)}`;
    default: return String(v);
  }
}
