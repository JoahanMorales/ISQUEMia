/**
 * §10 — datos sintéticos. Cero datos reales; distribuciones ancladas a §3.1,
 * individuos ficticios, todo determinista por semilla, todo con prefijo `SYN-`.
 */

import type { Aleatorio } from "../domain/aleatorio";
import { CIT_LIMITE_H } from "../domain/politica";
import type {
  Candidato,
  CausaMuerte,
  Centro,
  Donante,
  GrupoSanguineo,
  Organo,
  PerfilCentro,
  TipoOrgano,
  TipoCriterio,
  Via,
} from "../domain/tipos";

export const ENCABEZADO_SINTETICO = "# DATOS SINTÉTICOS — NO CLÍNICOS";

// ------------------------------------------------------------------ nombres

const CIUDADES = [
  ["Ashford", 41.88, -87.63], ["Brightwater", 34.05, -118.24], ["Cedar Falls", 40.71, -74.01],
  ["Dunmore", 29.76, -95.37], ["Elkhorn", 33.45, -112.07], ["Fairhaven", 39.95, -75.17],
  ["Glenrock", 29.42, -98.49], ["Harlowe", 32.72, -117.16], ["Ironwood", 32.78, -96.8],
  ["Juniper Bay", 37.34, -121.89], ["Kestrel", 30.27, -97.74], ["Lakemont", 30.33, -81.66],
  ["Marbury", 39.77, -86.16], ["Northgate", 35.23, -80.84], ["Oakhurst", 39.96, -82.99],
  ["Pinecrest", 39.74, -104.99], ["Quarrytown", 35.15, -90.05], ["Redstone", 42.36, -71.06],
  ["Stonebridge", 36.16, -86.78], ["Thornbury", 38.9, -77.04], ["Underhill", 42.33, -83.05],
  ["Vantage", 47.61, -122.33], ["Westmere", 44.98, -93.27], ["Yarrow", 38.63, -90.2],
  ["Alderbrook", 25.76, -80.19], ["Bellhaven", 33.75, -84.39], ["Crestline", 45.51, -122.68],
  ["Dovercliff", 36.17, -115.14], ["Eastvale", 43.04, -87.91], ["Fernwood", 39.29, -76.61],
  ["Granby", 35.47, -97.52], ["Hollowell", 36.11, -115.17], ["Inglenook", 27.95, -82.46],
  ["Jasperfield", 39.1, -94.58], ["Kirkwall", 32.29, -90.18], ["Lindmere", 43.61, -116.2],
  ["Millbrook", 41.5, -81.69], ["Norwich Hills", 40.44, -79.99], ["Overton", 38.25, -85.76],
  ["Pemberly", 34.74, -92.29],
] as const;

const SUFIJOS = ["University Hospital", "Medical Center", "Regional Transplant Institute", "Health System", "General Hospital"];
const NOMBRES_CIRUJANO = ["Okafor", "Lindqvist", "Bertrand", "Nakamura", "Vasquez", "Halloran", "Petrov", "Adeyemi", "Rosales", "Whitfield"];

// ------------------------------------------------------------------ centros

/** §11.3 — perfil calibrado. Cada campo anclado a un hecho de §3.1. */
export function generarPerfilCentro(azar: Aleatorio, volumenAnual: number, tipo: TipoOrgano): PerfilCentro {
  const citLimite = CIT_LIMITE_H[tipo];
  // Los centros grandes son algo más agresivos: es lo que explica la
  // concentración de colocaciones fuera de secuencia en los once mayores (§10.4).
  const grande = volumenAnual > 200;
  return {
    kdpiMaximo: azar.rango(0.5, 1.0),
    aceptaDCD: azar.bernoulli(0.7),
    citMaximaTolerada_h: Math.max(1, azar.normal(0.7 * citLimite, 0.12 * citLimite)),
    requiereBiopsia: azar.bernoulli(0.35),
    latenciaRespuesta_s: { mu: Math.log(120), sigma: 0.85 }, // mediana 120 s, cola larga
    multiplicadorNocturno: 1.11, // H37
    multiplicadorFinDeSemana: 1.14, // derivado de H38
    pProvisionalYes: azar.rango(0.25, 0.45) + (grande ? 0.05 : 0),
    pDeclineDadoProvisional: 0.7, // H05 — no ajustar sin justificación
    pCompromisoCompletoDadoProvisional: 0.3,
    pCambioDeDecision: 0.2, // H15
    distribucionRechazo: {
      LOG_CIT_TOO_LONG: 0.2037, // H01
      ORGAN_SPECIFIC_TEST_RESULTS: 0.1427,
      DONOR_MEDICAL_HISTORY: 0.1227,
      ORGAN_ANATOMICAL_DEFECT: 0.1013,
      BIOPSY_UNACCEPTABLE: 0.093,
      OTHER: 0.0738,
      DONOR_AGE: 0.0553,
      ORGAN_PRESERVATION: 0.0313,
      LOG_WIT_TOO_LONG: 0.027,
      // resto hasta 1.0
      CANDIDATE_UNAVAILABLE: 0.048,
      POSITIVE_CROSSMATCH: 0.035,
      LOG_TEAM_OR_FACILITY_UNAVAILABLE: 0.03,
      LOG_RECOVERY_TEAM_UNAVAILABLE: 0.022,
      SIZE_MISMATCH: 0.02,
      DONOR_KDPI_TOO_HIGH: 0.0182,
      LOG_TRANSPORTATION_UNAVAILABLE: 0.0119,
    },
  };
}

/** §10.4 — 40 centros: 5 grandes, 15 medianos, 20 pequeños. */
export function generarCentros(azar: Aleatorio, tipo: TipoOrgano, n = 40): Centro[] {
  const a = azar.derivar("centros");
  const volumenes: number[] = [
    ...Array.from({ length: 5 }, () => a.entero(201, 420)),
    ...Array.from({ length: 15 }, () => a.entero(50, 201)),
    ...Array.from({ length: 20 }, () => a.entero(8, 50)),
  ].slice(0, n);

  return volumenes.map((volumenAnual, i) => {
    const [ciudad, lat, lon] = CIUDADES[i % CIUDADES.length]!;
    return {
      id: `SYN-CTR-${String(i + 1).padStart(3, "0")}`,
      nombre: `${ciudad} ${SUFIJOS[i % SUFIJOS.length]}`,
      lat: lat + a.rango(-0.25, 0.25),
      lon: lon + a.rango(-0.25, 0.25),
      volumenAnual,
      perfil: generarPerfilCentro(a.derivar(`perfil-${i}`), volumenAnual, tipo),
    };
  });
}

// --------------------------------------------------------------- candidatos

const GRUPOS: GrupoSanguineo[] = ["O", "A", "B", "AB"];
const PESO_GRUPO = { O: 0.45, A: 0.34, B: 0.15, AB: 0.06 };

/** §10.4 — entre 30 y 400 candidatos por centro según volumen. */
export function generarCandidatos(azar: Aleatorio, centros: Centro[]): Candidato[] {
  const a = azar.derivar("candidatos");
  const out: Candidato[] = [];
  for (const centro of centros) {
    const n = Math.min(400, Math.max(30, Math.round(centro.volumenAnual * a.rango(1.2, 2.4))));
    for (let i = 0; i < n; i++) {
      out.push({
        id: `SYN-CAN-${centro.id.slice(-3)}-${String(i + 1).padStart(4, "0")}`,
        centroId: centro.id,
        grupoSanguineo: a.categorico(PESO_GRUPO) as GrupoSanguineo,
        pra: a.bernoulli(0.2) ? a.rango(0.8, 0.99) : a.rango(0, 0.6),
        urgencia: a.entero(1, 7),
        tiempoEnLista_dias: Math.round(a.logNormal(Math.log(540), 0.9)),
        aceptaDCD: a.bernoulli(0.72),
        kdpiMaximoAceptado: a.rango(0.35, 1.0),
        disponibleAhora: a.bernoulli(0.86),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- donantes

const CAUSAS: Record<CausaMuerte, number> = { stroke: 0.35, anoxia: 0.3, trauma: 0.25, otro: 0.1 };

/** §10.3 — 50 donantes con distribuciones ancladas. */
export function generarDonantes(azar: Aleatorio, n = 50, hospitalId = "SYN-HOSP-001"): Donante[] {
  const a = azar.derivar("donantes");
  return Array.from({ length: n }, (_, i) => {
    const via: Via = a.bernoulli(0.43) ? "DCD" : "DBD"; // H30
    // KDPI: uniforme 0.1–0.99 con 20 % ≥ 0.85 (H18)
    const kdpi = a.bernoulli(0.2) ? a.rango(0.85, 0.99) : a.rango(0.1, 0.85);
    return {
      id: `SYN-DON-${String(i + 1).padStart(3, "0")}`,
      via,
      edad: Math.min(75, Math.max(2, Math.round(a.logNormal(Math.log(45), 0.32)))),
      grupoSanguineo: a.categorico(PESO_GRUPO) as GrupoSanguineo,
      peso_kg: Math.round(a.normal(78, 16)),
      altura_cm: Math.round(a.normal(172, 10)),
      causaMuerte: a.categorico(CAUSAS) as CausaMuerte,
      kdpi: Number(kdpi.toFixed(2)),
      creatinina: Number(a.normal(1.1, 0.5).toFixed(2)),
      serologias: {
        hcv: a.bernoulli(0.08),
        hbv: a.bernoulli(0.03),
        hiv: false,
        cmv: a.bernoulli(0.55),
      },
      biopsiaRealizada: a.bernoulli(0.35),
      biopsiaHallazgos: null,
      hospitalId,
      t_trigger: null,
      t_referral: null,
      t_autorizacion: null,
      t_retiroSoporte: null,
      t_paro: null,
      t_crossClamp: null,
      ventanaDCD_min: via === "DCD" ? a.entero(60, 121) : null, // H31
    } satisfies Donante;
  });
}

export function generarOrgano(donante: Donante, tipo: TipoOrgano, perfusion: Organo["perfusion"] = null): Organo {
  return {
    id: `SYN-ORG-${donante.id.slice(-3)}-${tipo}`,
    donanteId: donante.id,
    tipo,
    citLimite_h: CIT_LIMITE_H[tipo],
    perfusion,
    t_crossClamp: null,
    estado: "NO_RECUPERADO",
    descartado: false,
    motivoDescarte: null,
  };
}

// ----------------------------------------------------- conjunto de UCI (§10.2)

export type ClaseUci =
  | "positivo_claro"
  | "positivo_dcd"
  | "positivo_limitrofe"
  | "negativo_obvio"
  | "negativo_tramposo";

export interface Observacion {
  id: string;
  t_sim: number;
  campo: "glasgow" | "reflejos_tronco" | "ventilacion" | "lesion_neuro";
  valor: string;
}

export interface Nota {
  id: string;
  t_sim: number;
  texto: string;
}

export interface PacienteUci {
  id: string;
  clase: ClaseUci;
  /** Verdad de terreno: qué criterios se cumplen realmente. */
  criteriosVerdaderos: TipoCriterio[];
  /** true si se espera `escalarAHumano` en vez de referral (§10.2 limítrofe). */
  esperaEscalamiento: boolean;
  observaciones: Observacion[];
  notas: Nota[];
}

const CONTEO_UCI: Record<ClaseUci, number> = {
  positivo_claro: 30,
  positivo_dcd: 20,
  positivo_limitrofe: 15,
  negativo_obvio: 100,
  negativo_tramposo: 35,
};

/**
 * §10.2 — 200 pacientes-hora con etiquetas de verdad. Los `negativo_tramposo`
 * existen para que el detector no aprenda "Glasgow bajo = referir": la sedación
 * documentada invalida el criterio y hay que leer la nota.
 */
export function generarConjuntoUci(azar: Aleatorio): PacienteUci[] {
  const a = azar.derivar("uci");
  const pacientes: PacienteUci[] = [];
  let n = 0;

  const nuevo = (clase: ClaseUci): { p: PacienteUci; obs: (campo: Observacion["campo"], valor: string) => void; nota: (t: string) => void } => {
    const id = `SYN-PAC-${String(++n).padStart(3, "0")}`;
    const t = a.entero(0, 3600 * 24) * 1000;
    const p: PacienteUci = { id, clase, criteriosVerdaderos: [], esperaEscalamiento: false, observaciones: [], notas: [] };
    let oi = 0;
    let ni = 0;
    return {
      p,
      obs: (campo, valor) => p.observaciones.push({ id: `${id}-OBS-${++oi}`, t_sim: t, campo, valor }),
      nota: (texto) => p.notas.push({ id: `${id}-NOTE-${++ni}`, t_sim: t, texto }),
    };
  };

  for (const [clase, cuantos] of Object.entries(CONTEO_UCI) as [ClaseUci, number][]) {
    for (let i = 0; i < cuantos; i++) {
      const { p, obs, nota } = nuevo(clase);
      switch (clase) {
        case "positivo_claro": {
          const gcs = a.entero(3, 6);
          obs("glasgow", `GCS ${gcs}T (E1 V1T M${gcs - 2})`);
          obs("ventilacion", "mechanical ventilation, AC/VC, FiO2 0.40");
          obs("lesion_neuro", "CT: diffuse cerebral edema, effaced basal cisterns");
          nota("Neuro exam: no cough, no gag, pupils fixed at 5 mm bilaterally. No sedation for 24 h.");
          p.criteriosVerdaderos = ["GCS_MENOR_IGUAL_5", "VENTILACION_CON_LESION_NEURO", "PERDIDA_REFLEJOS_TRONCO"];
          break;
        }
        case "positivo_dcd": {
          obs("glasgow", `GCS ${a.entero(4, 8)}T`);
          obs("ventilacion", "mechanical ventilation");
          nota("Family meeting held. Documented order for withdrawal of life-sustaining therapy tomorrow 10:00.");
          p.criteriosVerdaderos = ["PLAN_RETIRO_SOPORTE"];
          if (a.bernoulli(0.4)) {
            nota("Family asked spontaneously whether the patient could be an organ donor.");
            p.criteriosVerdaderos.push("FAMILIA_PREGUNTA_DONACION");
          }
          break;
        }
        case "positivo_limitrofe": {
          obs("glasgow", `GCS ${a.entero(6, 8)}T`);
          obs("ventilacion", "mechanical ventilation");
          nota("Patient on propofol infusion, rate being weaned. Neuro exam deferred until sedation cleared.");
          p.criteriosVerdaderos = [];
          p.esperaEscalamiento = true;
          break;
        }
        case "negativo_obvio": {
          obs("glasgow", `GCS ${a.entero(13, 16)}`);
          nota("Post-operative day 2, hemodynamically stable, tolerating diet.");
          break;
        }
        case "negativo_tramposo": {
          const gcs = a.entero(3, 6);
          obs("glasgow", `GCS ${gcs}T`);
          obs("ventilacion", "mechanical ventilation");
          if (a.bernoulli(0.6)) {
            nota(`Deep sedation documented: midazolam ${a.entero(4, 12)} mg/h plus fentanyl. GCS not assessable.`);
          } else {
            obs("lesion_neuro", "no intracranial pathology on CT");
            nota("Low GCS attributed to septic encephalopathy, no neurologic injury. Ventilated for ARDS.");
          }
          break;
        }
      }
      pacientes.push(p);
    }
  }
  return pacientes;
}

export function nombreCirujano(azar: Aleatorio): string {
  return `Dr. ${azar.elegir(NOMBRES_CIRUJANO)}`;
}
