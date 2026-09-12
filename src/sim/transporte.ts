/**
 * §11.1.7 — clima y vuelos: tablas estáticas suficientes para el router.
 * Deterministas por semilla; Exa puede sustituirlas más tarde sin tocar §8.4.
 */

import { crearAleatorio } from "../domain/aleatorio";

export interface Coordenada {
  lat: number;
  lon: number;
}

/** Distancia en millas terrestres. */
export function millas(a: Coordenada, b: Coordenada): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface CondicionesTramo {
  distancia_mi: number;
  /** 0..1 */
  riesgoClima: number;
  /** 0..1 — H33: más de la mitad de los incidentes documentados son de aerolíneas y aeropuertos. */
  riesgoConexionComercial: number;
  /** Salidas comerciales útiles en las próximas 12 h. */
  vuelosComercialesDisponibles: number;
  /** Corredor de dron predefinido entre estos dos puntos. */
  corredorDronExiste: boolean;
  activacionHelicoptero_min: number;
}

export function condiciones(
  semilla: string,
  origen: Coordenada,
  destino: Coordenada,
  claveRuta: string,
): CondicionesTramo {
  const a = crearAleatorio(`${semilla}::ruta::${claveRuta}`);
  const d = millas(origen, destino);
  return {
    distancia_mi: d,
    riesgoClima: Number(Math.min(1, Math.max(0, a.normal(0.18, 0.14))).toFixed(3)),
    riesgoConexionComercial: Number(Math.min(1, Math.max(0, a.normal(0.52, 0.16))).toFixed(3)), // H33
    vuelosComercialesDisponibles: d > 250 ? a.entero(1, 7) : a.entero(0, 3),
    corredorDronExiste: d < 60 && a.bernoulli(0.35),
    activacionHelicoptero_min: a.entero(90, 121), // 90–120 min
  };
}

/** Velocidades y costos de referencia por modalidad. */
export const PARAMETROS_MODALIDAD = {
  terrestre: { velocidad_mph: 55, costoPorMilla: 4.2, costoBase: 350 },
  comercial: { velocidad_mph: 460, costoPorMilla: 2.1, costoBase: 900, overhead_min: 190 },
  helicoptero: { velocidad_mph: 145, costoPorMilla: 38, costoBase: 4500 },
  jet: { velocidad_mph: 430, costoPorMilla: 26, costoBase: 12000, overhead_min: 70 },
  dron: { velocidad_mph: 62, costoPorMilla: 9, costoBase: 800, payload_lb: 12 },
} as const;

/** Peso del dispositivo de perfusión — la razón por la que el dron casi siempre pierde. */
export const PESO_DISPOSITIVO_PERFUSION_LB = 48;
