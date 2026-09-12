"use client";

import type { EstadoPanel } from "../agui/estado";
import { horas } from "./formato";

/**
 * §12.2 — cintillo inferior: la línea base serial corriendo en paralelo, con
 * su propia posición y su propio reloj. Es la comparación que el jurado tiene
 * que creer, así que está siempre visible, no escondida en una pestaña.
 */
export function Cintillo({ estado }: { estado: EstadoPanel }) {
  const total = estado.carriles.length || 40;
  const posAgente = estado.resumen.mejorSecuencia ?? Math.max(1, estado.resumen.ofertasEmitidas);
  const posHumano = estado.baseline.secuenciaFinal ?? estado.baseline.secuenciaActual;
  const m = estado.metricas;

  return (
    <div className="cintillo">
      <div>
        <div className="et">Serial baseline · same seed</div>
        <div className="v">
          {estado.baseline.secuenciaFinal !== null
            ? `placed at #${estado.baseline.secuenciaFinal}`
            : `working #${estado.baseline.secuenciaActual}`}
        </div>
      </div>

      <div>
        <div className="et">Baseline offers</div>
        <div className="v">{estado.baseline.ofertas}</div>
      </div>

      <div>
        <div className="et">Late refusals waited on</div>
        <div className="v" style={{ color: estado.baseline.rechazosTardios > 0 ? "var(--critico)" : undefined }}>
          {estado.baseline.rechazosTardios}
        </div>
      </div>

      <div className="pista" title="Position in the match run: agent vs. human coordinator">
        <i className="humano" style={{ left: `${(Math.min(posHumano, total) / total) * 100}%` }} title={`baseline #${posHumano}`} />
        <i className="agente" style={{ left: `${(Math.min(posAgente, total) / total) * 100}%` }} title={`agent #${posAgente}`} />
      </div>

      <div>
        <div className="et">Ischemia hours saved</div>
        <div className="v" style={{ color: (m?.M1_horasIsquemiaAhorradas ?? 0) > 0 ? "var(--acento)" : undefined }}>
          {m ? horas(m.M1_horasIsquemiaAhorradas) : "—"}
        </div>
      </div>
    </div>
  );
}
