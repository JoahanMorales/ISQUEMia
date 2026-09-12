/**
 * §8.5 — ESCRIBANO. Construye el expediente AOOS y la cadena de custodia.
 *
 * Regla: cada oración de la justificación debe poder mapearse a al menos un
 * `Evento.id`. El escribano emite `cobertura` = proporción de oraciones con
 * respaldo. Si es < 1.0 el expediente se marca incompleto **y se muestra así**:
 * mostrarlo es una fortaleza, no una debilidad.
 */

import type { AlmacenEventos } from "../domain/puertos";
import type { Registrador } from "../domain/registro";
import type {
  CampoCompromiso,
  Carril,
  CodigoRechazo,
  Evento,
  ExpedienteAOOS,
  OracionJustificada,
} from "../domain/tipos";
import type { Mundo } from "../sim/mundo";
import { etiquetaOrgano } from "./carril";
import { E } from "./eventos";

/** Hash estable y determinista del rango de eventos que respalda el expediente. */
export function firmar(eventos: Evento[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const e of eventos) {
    const s = `${e.id}|${e.t_sim}|${e.tipo}|${e.actor}`;
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = (Math.imul(h2 + s.charCodeAt(i), 2654435761) ^ (h2 >>> 13)) >>> 0;
    }
  }
  return `sha-sim:${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export interface OpcionesExpediente {
  mundo: Mundo;
  almacen: AlmacenEventos;
  registro: Registrador;
  carriles: Carril[];
  ganador: Carril | null;
  aoos: boolean;
}

export function construirExpediente(o: OpcionesExpediente): ExpedienteAOOS {
  const { mundo, almacen, carriles, ganador } = o;
  const eventos = almacen.todos();
  const porTipo = (tipo: string) => eventos.filter((e) => e.tipo === tipo);

  const rechazos = carriles
    .filter((c) => c.estado === "RECHAZADO" && c.codigoRechazo)
    .map((c) => {
      const ev = eventos.find(
        (e) => e.tipo === E.CARRIL_RECHAZADO && (e.payload as { carrilId?: string }).carrilId === c.id,
      );
      return {
        secuencia: c.entradaMatchRun.secuencia,
        centroId: c.entradaMatchRun.centroId,
        codigo: c.codigoRechazo as CodigoRechazo,
        t_sim: c.t_cerrado ?? 0,
        citaLiteral: String((ev?.payload as { literal?: string })?.literal ?? c.respuestaCruda ?? ""),
      };
    });

  const degradaciones = porTipo(E.CARRIL_DEGRADADO).map((e) => {
    const p = e.payload as {
      centroId: string;
      camposFaltantes: CampoCompromiso[];
      horasIsquemiaProtegidas: number;
    };
    return {
      centroId: p.centroId,
      camposFaltantes: p.camposFaltantes,
      t_sim: e.t_sim,
      horasProtegidas: p.horasIsquemiaProtegidas,
    };
  });

  const oraciones: OracionJustificada[] = [];
  const oracion = (texto: string, eventosRespaldo: Evento[], citas: OracionJustificada["citas"] = []) => {
    oraciones.push({ texto, eventos: eventosRespaldo.map((e) => e.id), citas });
  };

  const apertura = porTipo(E.CAMPANA_ABIERTA);
  const cierre = porTipo(E.CAMPANA_CERRADA);
  const organo = etiquetaOrgano(mundo.organo.tipo);

  oracion(
    `The ${organo} from donor ${mundo.donante.id} (${mundo.donante.via}, age ${mundo.donante.edad}, blood type ${mundo.donante.grupoSanguineo}) was offered to ${carriles.length} centers from the match run, in strict sequence order.`,
    apertura,
    [
      {
        afirmacion: `donor ${mundo.donante.id} is ${mundo.donante.via}, age ${mundo.donante.edad}`,
        origen: "registro_donante",
        referencia: mundo.donante.id,
        literal: `${mundo.donante.via}, ${mundo.donante.edad} y, ${mundo.donante.grupoSanguineo}`,
      },
    ],
  );

  oracion(
    `${rechazos.length} centers declined with a standardized refusal code; the most frequent category was ${categoriaMasFrecuente(rechazos)}.`,
    porTipo(E.CARRIL_RECHAZADO),
  );

  if (degradaciones.length > 0) {
    const horas = degradaciones.reduce((s, d) => s + d.horasProtegidas, 0);
    oracion(
      `${degradaciones.length} provisional acceptances failed verification and were downgraded rather than waited on, protecting an estimated ${horas.toFixed(1)} hours of cold ischemia.`,
      porTipo(E.CARRIL_DEGRADADO),
    );
  }

  if (ganador) {
    const centro = mundo.centro(ganador.entradaMatchRun.centroId);
    const comp = ganador.compromiso;
    oracion(
      `Placement was completed at ${centro.nombre} at match run sequence #${ganador.entradaMatchRun.secuencia}, with a verified commitment naming surgeon ${comp?.cirujanoNombrado ?? "—"} and OR ${comp?.quirofanoReservado?.sala ?? "—"}.`,
      porTipo(E.CARRIL_COMPROMETIDO),
      Object.values(comp?.citas ?? {}),
    );
    if (o.aoos) {
      oracion(
        `Because the accepting center sits above the out-of-sequence threshold, this placement is recorded as AOOS and this file constitutes its written justification.`,
        porTipo(E.AOOS_MARCADO),
      );
    }
  } else {
    oracion(
      `No center reached a verified commitment before the campaign closed; the organ was not placed through this campaign.`,
      cierre,
    );
  }

  const citLinea = eventos
    .filter((e) => e.tipo === E.ALERTA_CIT || e.tipo === E.CARRIL_COMPROMETIDO || e.tipo === E.CROSS_CLAMP)
    .map((e) => ({
      t_sim: e.t_sim,
      citHoras: Number((e.payload as { cit_h?: number }).cit_h ?? 0),
      evento: e.id,
    }));

  const conRespaldo = oraciones.filter((s) => s.eventos.length > 0).length;
  const cobertura = oraciones.length ? conRespaldo / oraciones.length : 0;

  const expediente: ExpedienteAOOS = {
    organoId: mundo.organo.id,
    donanteResumen: `${mundo.donante.id} · ${mundo.donante.via} · ${mundo.donante.edad} y · ${mundo.donante.grupoSanguineo} · KDPI ${(mundo.donante.kdpi * 100).toFixed(0)}%`,
    secuenciaFinal: ganador?.entradaMatchRun.secuencia ?? -1,
    totalOfertas: carriles.filter((c) => c.intentos > 0).length,
    rechazos,
    degradaciones,
    justificacion: oraciones,
    citLinea,
    cobertura,
    firmaHash: firmar(eventos),
  };

  o.registro.emitir("escribano", E.EXPEDIENTE_LISTO, {
    organoId: expediente.organoId,
    cobertura,
    oraciones: oraciones.length,
    firmaHash: expediente.firmaHash,
    incompleto: cobertura < 1,
  });

  return expediente;
}

function categoriaMasFrecuente(rechazos: { codigo: CodigoRechazo }[]): string {
  const conteo = new Map<string, number>();
  for (const r of rechazos) conteo.set(r.codigo, (conteo.get(r.codigo) ?? 0) + 1);
  let mejor = "none";
  let max = 0;
  for (const [k, v] of conteo) if (v > max) ((max = v), (mejor = k));
  return mejor;
}
