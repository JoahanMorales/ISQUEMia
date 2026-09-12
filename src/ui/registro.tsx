"use client";

import { useMemo, useState } from "react";
import type { EventoVista } from "../agui/estado";
import { reloj_t } from "./formato";

const HITOS = new Set([
  "REFERRAL_EMITIDO", "CROSS_CLAMP", "CAMPANA_ABIERTA", "CAMPANA_CERRADA",
  "ALERTA_CIT", "EXPEDIENTE_LISTO", "PLAN_TRANSPORTE_LISTO", "AOOS_MARCADO",
]);
const CRITICOS = new Set(["CARRIL_DEGRADADO", "VENTANA_DCD_EXPIRADA", "DEGRADACION_PROVEEDOR", "ESCALAMIENTO_SOLICITADO"]);
const EXITOS = new Set(["CARRIL_COMPROMETIDO"]);

/** Panel lateral de P1: registro de eventos en vivo, filtrable por actor. */
export function Registro({ eventos }: { eventos: EventoVista[] }) {
  const [actor, setActor] = useState<string | null>(null);
  const [soloHitos, setSoloHitos] = useState(false);

  const actores = useMemo(() => {
    const s = new Set<string>();
    for (const e of eventos) s.add(e.actor.startsWith("carril:") ? "carril" : e.actor);
    return [...s].sort();
  }, [eventos]);

  const filtrados = useMemo(() => {
    let xs = eventos;
    if (actor) xs = xs.filter((e) => (actor === "carril" ? e.actor.startsWith("carril:") : e.actor === actor));
    if (soloHitos) xs = xs.filter((e) => HITOS.has(e.tipo) || CRITICOS.has(e.tipo) || EXITOS.has(e.tipo));
    return xs.slice(-220).reverse();
  }, [eventos, actor, soloHitos]);

  return (
    <div className="panel" style={{ position: "sticky", top: 150 }}>
      <div className="panel-cab">
        <span className="panel-tit">Event log</span>
        <span className="kpi-nota num">{eventos.length}</span>
      </div>
      <div className="filtros">
        <button className={`chip${actor === null ? " on" : ""}`} onClick={() => setActor(null)}>all</button>
        {actores.map((a) => (
          <button key={a} className={`chip${actor === a ? " on" : ""}`} onClick={() => setActor(a)}>{a}</button>
        ))}
        <button className={`chip${soloHitos ? " on" : ""}`} onClick={() => setSoloHitos(!soloHitos)}>milestones</button>
      </div>
      <div className="log">
        {filtrados.length === 0 && <div className="vacio">Nothing yet.</div>}
        {filtrados.map((e) => (
          <div
            key={e.id}
            className={`log-fila${HITOS.has(e.tipo) ? " hito" : ""}${CRITICOS.has(e.tipo) ? " critico" : ""}${EXITOS.has(e.tipo) ? " exito" : ""}`}
          >
            <span className="log-t">{reloj_t(e.t_sim)}</span>
            <span className="log-actor">{e.actor}</span>
            <span className="log-txt">{e.resumen}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
