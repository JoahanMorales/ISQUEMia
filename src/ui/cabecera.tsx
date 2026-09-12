"use client";

import type { EstadoPanel } from "../agui/estado";
import type { Pestana } from "./consola";
import { clase_umbral, color_umbral, hhmmss, horas } from "./formato";

/**
 * §12.2 — prioridad visual: el reloj primero, el estado de los carriles
 * segundo, todo lo demás después. El reloj no se detiene nunca durante la demo.
 */
export function Cabecera({
  estado,
  pestana,
  setPestana,
  accion,
  corriendo,
}: {
  estado: EstadoPanel;
  pestana: Pestana;
  setPestana: (p: Pestana) => void;
  accion: (a: string, extra?: Record<string, unknown>) => Promise<void>;
  corriendo: boolean;
}) {
  const o = estado.organo;
  const cit_ms = o.citTranscurrido_h * 3_600_000;
  const cls = clase_umbral(o.fraccion);

  return (
    <header className="cabecera">
      <div className="cab-fila">
        <div className="reloj-bloque">
          <div className="reloj-etiqueta">Cold ischemia</div>
          <div className={`reloj-valor ${cls}`}>{hhmmss(cit_ms)}</div>
          <div className="barra-cit">
            <i style={{ width: `${Math.min(100, o.fraccion * 100)}%`, background: color_umbral(o.fraccion) }} />
            {[0.5, 0.75, 0.9].map((u) => (
              <span key={u} className="marca" style={{ left: `${u * 100}%` }} />
            ))}
          </div>
          <div className="reloj-sub">
            {(o.fraccion * 100).toFixed(0)}% of {o.citLimite_h} h limit · {o.etiqueta}
            {o.perfusion ? ` · ${o.perfusion} perfusion` : " · static storage"}
          </div>
        </div>

        <div className="kpis">
          <Kpi et="Offers issued" v={estado.resumen.ofertasEmitidas} nota={`of ${estado.carriles.length} lanes`} />
          <Kpi et="Lanes live" v={estado.resumen.carrilesVivos} nota={`${estado.resumen.verificandoAhora} verifying`} />
          <Kpi
            et="Best sequence"
            v={estado.resumen.mejorSecuencia !== null ? `#${estado.resumen.mejorSecuencia}` : "—"}
            nota={estado.resumen.citProyectadaMejor_h !== null ? `${horas(estado.resumen.citProyectadaMejor_h)} projected` : "no commitment yet"}
            acento={estado.resumen.mejorSecuencia !== null}
          />
          <Kpi
            et="Intercepted"
            v={`${estado.resumen.degradaciones}/${estado.resumen.provisionalYes}`}
            nota={`${estado.resumen.horasProtegidas.toFixed(1)} h protected`}
            critico={estado.resumen.degradaciones > 0}
          />
          <Kpi et="Run cost" v={`$${estado.spans.costoUSD.toFixed(4)}`} nota={`${estado.spans.total} spans`} />
        </div>

        <div className="controles">
          <span className="insignia" title="Simulation phase">
            <span className="pt" />
            {estado.fase}
          </span>
          <select
            className="select"
            value={estado.reloj.factor}
            onChange={(e) => void accion("factor", { factor: Number(e.target.value) })}
            title="Clock acceleration"
          >
            {[1, 30, 60, 120, 300, 600].map((f) => (
              <option key={f} value={f}>{f}×</option>
            ))}
          </select>
          <button
            className={`btn${estado.reloj.congelado ? " on" : ""}`}
            onClick={() => void accion(estado.reloj.congelado ? "reanudar" : "congelar")}
          >
            {estado.reloj.congelado ? "Resume" : "Freeze"}
          </button>
          <button className="btn" onClick={() => void accion("adelantar")} title="Run the whole campaign at once">
            Run to end
          </button>
          <button
            className="btn"
            onClick={async () => {
              const s = prompt("Seed", estado.semilla);
              if (s) { await accion("reiniciar", { semilla: s }); location.reload(); }
            }}
            title="Same seed reproduces the run exactly"
          >
            Seed {estado.semilla}
          </button>
        </div>
      </div>

      <nav className="tabs">
        <Tab id="sala" actual={pestana} set={setPestana}>Placement room</Tab>
        <Tab id="referral" actual={pestana} set={setPestana} pip={estado.caso.criterios.length || undefined}>Referral</Tab>
        <Tab id="transporte" actual={pestana} set={setPestana} pip={estado.transporte?.length}>Transport</Tab>
        <Tab id="expediente" actual={pestana} set={setPestana} pip={estado.expediente ? "✓" : undefined}>AOOS file</Tab>
        <Tab id="metricas" actual={pestana} set={setPestana} pip={estado.metricas ? 9 : undefined}>Metrics</Tab>
        <Tab id="workspace" actual={pestana} set={setPestana} pip={estado.workspace.length || undefined}>Workspace</Tab>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 5, alignItems: "center", paddingBottom: 6 }}>
          {estado.adaptadores
            .filter((a) => ["LLM_NEGOCIACION", "VOZ", "WORKSPACE", "BUSQUEDA", "AUTH", "RUNTIME"].includes(a.slot))
            .map((a) => (
              <span key={a.slot} className={`insignia${a.remoto ? " remoto" : ""}`} title={a.motivo}>
                <span className="pt" />
                {a.slot.toLowerCase().replace("llm_", "")}: {a.implementacion}
              </span>
            ))}
          <span className={`insignia${corriendo ? " remoto" : ""}`} title="AG-UI stream">
            <span className="pt" />
            {corriendo ? "streaming" : "idle"}
          </span>
        </div>
      </nav>
    </header>
  );
}

function Kpi({ et, v, nota, acento, critico }: { et: string; v: string | number; nota?: string; acento?: boolean; critico?: boolean }) {
  return (
    <div>
      <div className="kpi-et">{et}</div>
      <div className="kpi-val" style={{ color: acento ? "var(--acento)" : critico ? "var(--critico)" : undefined }}>{v}</div>
      {nota && <div className="kpi-nota">{nota}</div>}
    </div>
  );
}

function Tab({ id, actual, set, children, pip }: { id: Pestana; actual: Pestana; set: (p: Pestana) => void; children: React.ReactNode; pip?: number | string }) {
  return (
    <button className={`tab${actual === id ? " on" : ""}`} onClick={() => set(id)}>
      {children}
      {pip !== undefined && <span className="pip">{pip}</span>}
    </button>
  );
}
