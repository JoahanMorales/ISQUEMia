"use client";

import type { CarrilVista } from "../agui/estado";
import { titulo } from "./formato";

/**
 * P1 · rejilla de 40 celdas (§12.2).
 *
 * Cada celda: centro, secuencia, estado con color, latencia y —cuando el
 * carril está verificando— las cuatro casillas del compromiso llenándose una
 * por una. Ver esas cuatro casillas llenarse, o no llenarse, es el momento
 * central de la demo, así que son lo único que se anima.
 */
export function Rejilla({
  carriles,
  seleccionado,
  onSeleccionar,
  filtro,
}: {
  carriles: CarrilVista[];
  seleccionado: string | null;
  onSeleccionar: (id: string | null) => void;
  filtro: string | null;
}) {
  const visibles = filtro ? carriles.filter((c) => c.estado === filtro) : carriles;

  if (visibles.length === 0) {
    return <div className="vacio">No lanes yet. The campaign opens at cross clamp.</div>;
  }

  return (
    <div className="rejilla">
      {visibles.map((c) => (
        <button
          key={c.id}
          className={`celda${seleccionado === c.id ? " sel" : ""}`}
          data-e={c.estado}
          onClick={() => onSeleccionar(seleccionado === c.id ? null : c.id)}
          title={c.literalRechazo ?? c.centroNombre}
        >
          <div className="celda-cab">
            <span className="seq">#{c.secuencia}</span>
            <span className="lat">{c.latencia_s !== null ? `${Math.round(c.latencia_s)}s` : "—"}</span>
          </div>
          <div className="centro">{c.centroNombre}</div>
          <div className={`estado-txt est-${c.estado}`}>{titulo(c.estado)}</div>
          {c.codigoRechazo && <div className="codigo">{c.codigoRechazo}</div>}
          {c.estado === "DEGRADADO" && c.horasProtegidas !== null && (
            <div className="protegidas">{c.horasProtegidas} h protected</div>
          )}
          {(c.estado === "VERIFICANDO" ||
            c.estado === "PROVISIONAL" ||
            c.estado === "DEGRADADO" ||
            c.estado === "COMPROMETIDO" ||
            c.estado === "ACEPTADO_DIRECTO") && (
            <div className="casillas">
              {c.casillas.map((k) => (
                <span key={k.campo} className={`casilla${k.llena ? " on" : ""}`} title={k.etiqueta} />
              ))}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

/** Detalle del carril seleccionado: las cuatro casillas con su cita literal. */
export function DetalleCarril({ carril }: { carril: CarrilVista }) {
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-cab">
        <span className="panel-tit">
          Lane #{carril.secuencia} · {carril.centroNombre}
        </span>
        <span className={`estado-txt est-${carril.estado}`}>{titulo(carril.estado)}</span>
      </div>
      <div className="panel-cuerpo">
        <dl className="dl" style={{ marginBottom: 12 }}>
          <dt>Center volume</dt>
          <dd>{carril.volumenAnual}/yr</dd>
          <dt>Channel</dt>
          <dd>{carril.modalidad}</dd>
          <dt>First response</dt>
          <dd>{carril.latencia_s !== null ? `${Math.round(carril.latencia_s)} s` : "—"}</dd>
          {carril.codigoRechazo && (
            <>
              <dt>Refusal code</dt>
              <dd>{carril.codigoRechazo}</dd>
            </>
          )}
        </dl>

        <div className="panel-tit" style={{ marginBottom: 8 }}>Verified commitment</div>
        {carril.casillas.map((k) => (
          <div key={k.campo} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 7 }}>
            <span
              style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0, marginTop: 1,
                border: `1px solid ${k.llena ? "var(--acento)" : "var(--borde-fuerte)"}`,
                background: k.llena ? "var(--acento)" : "transparent",
                color: "#fff", fontSize: 10, lineHeight: "13px", textAlign: "center",
              }}
            >
              {k.llena ? "✓" : ""}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: k.llena ? "var(--texto)" : "var(--texto-3)" }}>
                {k.etiqueta}
                {k.valor && <span className="num" style={{ fontWeight: 400, color: "var(--texto-2)" }}> · {k.valor}</span>}
              </div>
              {k.literal ? (
                <div className="cita">“{k.literal}”</div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--texto-3)" }}>
                  not stated by the center — never inferred
                </div>
              )}
            </div>
          </div>
        ))}

        {carril.transcripcion.length > 0 && (
          <>
            <div className="panel-tit" style={{ margin: "14px 0 8px" }}>Transcript</div>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {carril.transcripcion.map((t, i) => (
                <div key={i} style={{ marginBottom: 7, fontSize: 12 }}>
                  <span
                    style={{
                      fontFamily: "var(--mono)", fontSize: 9.5, textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: t.hablante === "agente" ? "var(--info)" : "var(--texto-3)",
                    }}
                  >
                    {t.hablante === "agente" ? "agent" : "center"}
                  </span>
                  <div style={{ color: "var(--texto-2)", lineHeight: 1.4 }}>{t.texto}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
