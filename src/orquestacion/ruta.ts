/**
 * §8.4 — RUTA, reloj 3. Genera y puntúa opciones de transporte multimodal.
 *
 * Las inviables se devuelven **incluidas**, con su motivo escrito. El dron
 * aparece casi siempre tachado con "payload insuficiente para dispositivo de
 * perfusión": es una salida deseada, no un defecto. Demuestra que el equipo
 * conoce los límites de su propia idea.
 */

import type { Reloj } from "../domain/puertos";
import type { Registrador } from "../domain/registro";
import type { ModalidadTransporte, OpcionTransporte, Tramo } from "../domain/tipos";
import type { Mundo } from "../sim/mundo";
import {
  PARAMETROS_MODALIDAD,
  PESO_DISPOSITIVO_PERFUSION_LB,
  type CondicionesTramo,
} from "../sim/transporte";
import { E } from "./eventos";

export const PESOS_PUNTAJE = { margen: 0.5, costo: 0.15, clima: 0.15, conexion: 0.2 };

export interface OpcionTransporteExt extends OpcionTransporte {
  /** Sin regla BVLOS final: el dron requiere exención. */
  requiereExencion: boolean;
  destinoCentroId: string;
  destinoNombre: string;
}

interface Contexto {
  distancia_mi: number;
  condiciones: CondicionesTramo;
  citActual_h: number;
  citLimite_h: number;
  hayPerfusion: boolean;
  origen: string;
  destino: string;
}

function construir(modalidad: ModalidadTransporte, ctx: Contexto): OpcionTransporteExt {
  const d = ctx.distancia_mi;
  const c = ctx.condiciones;
  let duracion_min = 0;
  let costoUSD = 0;
  let viable = true;
  let motivoNoViable: string | null = null;
  let riesgoConexion = 0.05;
  let requiereExencion = false;
  const tramos: Tramo[] = [];

  switch (modalidad) {
    case "terrestre": {
      const p = PARAMETROS_MODALIDAD.terrestre;
      duracion_min = Math.round((d / p.velocidad_mph) * 60);
      costoUSD = Math.round(p.costoBase + d * p.costoPorMilla);
      if (duracion_min > 120) {
        viable = false;
        motivoNoViable = "trayecto terrestre superior a 2 h";
      }
      break;
    }
    case "comercial": {
      const p = PARAMETROS_MODALIDAD.comercial;
      duracion_min = Math.round((d / p.velocidad_mph) * 60 + p.overhead_min);
      costoUSD = Math.round(p.costoBase + d * p.costoPorMilla);
      riesgoConexion = c.riesgoConexionComercial; // H33
      if (c.vuelosComercialesDisponibles === 0) {
        viable = false;
        motivoNoViable = "sin salidas comerciales útiles en la ventana";
      }
      tramos.push(
        { modalidad: "terrestre", desde: ctx.origen, hasta: "origin airport", duracion_min: 35, costoUSD: 180 },
        { modalidad: "comercial", desde: "origin airport", hasta: "destination airport", duracion_min: duracion_min - 70, costoUSD: costoUSD - 360 },
        { modalidad: "terrestre", desde: "destination airport", hasta: ctx.destino, duracion_min: 35, costoUSD: 180 },
      );
      break;
    }
    case "helicoptero": {
      const p = PARAMETROS_MODALIDAD.helicoptero;
      duracion_min = Math.round((d / p.velocidad_mph) * 60 + c.activacionHelicoptero_min);
      costoUSD = Math.round(p.costoBase + d * p.costoPorMilla);
      riesgoConexion = 0.1;
      if (d > 150) {
        viable = false;
        motivoNoViable = `distancia ${Math.round(d)} mi supera el alcance práctico de 150 mi`;
      }
      break;
    }
    case "jet": {
      const p = PARAMETROS_MODALIDAD.jet;
      duracion_min = Math.round((d / p.velocidad_mph) * 60 + p.overhead_min);
      costoUSD = Math.round(p.costoBase + d * p.costoPorMilla);
      riesgoConexion = 0.12;
      break;
    }
    case "dron": {
      const p = PARAMETROS_MODALIDAD.dron;
      duracion_min = Math.round((d / p.velocidad_mph) * 60 + 25);
      costoUSD = Math.round(p.costoBase + d * p.costoPorMilla);
      riesgoConexion = 0.15;
      requiereExencion = true; // sin regla BVLOS final
      // La regla del producto: el payload de 12 lb no carga un perfusor.
      if (ctx.hayPerfusion) {
        viable = false;
        motivoNoViable = `payload ${p.payload_lb} lb < dispositivo de perfusión (${PESO_DISPOSITIVO_PERFUSION_LB} lb)`;
      } else if (!c.corredorDronExiste) {
        viable = false;
        motivoNoViable = "no hay corredor predefinido entre estos dos puntos";
      }
      break;
    }
  }

  const citProyectada_h = ctx.citActual_h + duracion_min / 60 + 1.2;
  const margen = ctx.citLimite_h - citProyectada_h;
  if (margen <= 0) {
    viable = false;
    motivoNoViable = motivoNoViable ?? "excede isquemia";
  }

  return {
    modalidad,
    tramos: tramos.length ? tramos : [{ modalidad, desde: ctx.origen, hasta: ctx.destino, duracion_min, costoUSD }],
    duracionTotal_min: duracion_min,
    citProyectada_h: Number(citProyectada_h.toFixed(2)),
    costoUSD,
    riesgoClima: c.riesgoClima,
    riesgoConexion,
    viable,
    motivoNoViable,
    puntaje: 0,
    requiereExencion,
    destinoCentroId: "",
    destinoNombre: "",
  };
}

const MODALIDADES: ModalidadTransporte[] = ["terrestre", "comercial", "helicoptero", "jet", "dron"];

export function planificar(mundo: Mundo, centroId: string, citActual_h?: number): OpcionTransporteExt[] {
  const centro = mundo.centro(centroId);
  const ctx: Contexto = {
    distancia_mi: mundo.distancia_mi(centroId),
    condiciones: mundo.condicionesHacia(centroId),
    citActual_h: citActual_h ?? mundo.citTranscurrido_h(),
    citLimite_h: mundo.citLimite_h(),
    hayPerfusion: mundo.organo.perfusion !== null && mundo.organo.perfusion !== "estatico",
    origen: "donor hospital",
    destino: centro.nombre,
  };

  const opciones = MODALIDADES.map((m) => {
    const o = construir(m, ctx);
    o.destinoCentroId = centroId;
    o.destinoNombre = centro.nombre;
    return o;
  });

  // Normalización sobre el conjunto, para que el puntaje sea comparable.
  const margenes = opciones.map((o) => ctx.citLimite_h - o.citProyectada_h);
  const costos = opciones.map((o) => o.costoUSD);
  const norm = (v: number, xs: number[]) => {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    return max === min ? 0.5 : (v - min) / (max - min);
  };

  for (const o of opciones) {
    const margen = ctx.citLimite_h - o.citProyectada_h;
    o.puntaje = Number(
      (
        PESOS_PUNTAJE.margen * norm(margen, margenes) -
        PESOS_PUNTAJE.costo * norm(o.costoUSD, costos) -
        PESOS_PUNTAJE.clima * o.riesgoClima -
        PESOS_PUNTAJE.conexion * o.riesgoConexion
      ).toFixed(4),
    );
  }

  // Las inviables se muestran, no se esconden: van al final, con su motivo.
  return opciones.sort((a, b) => Number(b.viable) - Number(a.viable) || b.puntaje - a.puntaje);
}

export function solicitarPlan(
  mundo: Mundo,
  registro: Registrador,
  _reloj: Reloj,
  centroId: string,
): OpcionTransporteExt[] {
  registro.emitir("ruta", E.PLAN_TRANSPORTE_SOLICITADO, { centroId });
  const opciones = planificar(mundo, centroId);
  registro.emitir("ruta", E.PLAN_TRANSPORTE_LISTO, {
    centroId,
    mejor: opciones[0]?.modalidad ?? null,
    opciones: opciones.map((o) => ({
      modalidad: o.modalidad,
      viable: o.viable,
      motivoNoViable: o.motivoNoViable,
      puntaje: o.puntaje,
      citProyectada_h: o.citProyectada_h,
      costoUSD: o.costoUSD,
      duracionTotal_min: o.duracionTotal_min,
    })),
  });
  return opciones;
}
