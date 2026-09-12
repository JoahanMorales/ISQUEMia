/**
 * DonorNet falso — §11.1.3 y §11.3.
 *
 * REGLA DE ORO (§11.3): el comportamiento del centro **no sabe** si lo está
 * contactando el agente o la línea base humana. Por eso `generarGuion` no
 * recibe ningún parámetro que identifique al llamante: recibe la oferta, el
 * perfil del centro y una semilla derivada de (órgano, centro, intento).
 * Si algún día alguien añade ese parámetro, la comparación deja de ser honesta
 * y hay un test que falla.
 */

import { crearAleatorio, type Aleatorio } from "../domain/aleatorio";
import type {
  CampoCompromiso,
  Centro,
  CodigoRechazo,
  Donante,
  GrupoSanguineo,
  Organo,
  TipoOrgano,
} from "../domain/tipos";
import { compatibleABO } from "./match-run";
import { nombreCirujano } from "./generadores";

/** Lo que el carril presenta al centro (§8.3 paso 1). */
export interface Oferta {
  organoId: string;
  tipo: TipoOrgano;
  via: Donante["via"];
  edad: number;
  grupoSanguineo: GrupoSanguineo;
  kdpi: number | null;
  serologias: Donante["serologias"];
  biopsiaRealizada: boolean;
  citActual_h: number;
  citProyectadaAlImplante_h: number;
  secuencia: number;
  /** Instante de simulación en que se emite la oferta. */
  t_sim: number;
}

export type Decision = "rechazo" | "provisional" | "aceptacion_directa";

export interface CampoRevelado {
  campo: CampoCompromiso;
  valor: string;
  /** Segundos sim después de entrar en VERIFICACIÓN. */
  retraso_s: number;
  /** Texto exacto que dijo el centro — la cita del §8.6. */
  literal: string;
}

/**
 * El guion completo de lo que este centro hará ante esta oferta. El mundo lo
 * decide de una vez, de forma determinista; el carril solo lo reproduce en
 * tiempo de simulación y no puede alterarlo.
 */
export interface GuionCentro {
  centroId: string;
  latenciaPrimeraRespuesta_s: number;
  decision: Decision;
  codigoRechazo: CodigoRechazo | null;
  prosaRespuesta: string;
  /** Solo si `decision === "provisional"`. */
  completara: boolean;
  camposRevelados: CampoRevelado[];
  camposFaltantes: CampoCompromiso[];
  /** Cuánto tardaría en llegar el rechazo tardío si nadie verificara (H07). */
  retrasoRechazoTardio_s: number;
  /** Motivo del rechazo duro, cuando lo hubo, para la traza. */
  reglaDura: string | null;
}

const PROSA_RECHAZO: Partial<Record<CodigoRechazo, string>> = {
  LOG_CIT_TOO_LONG: "Projected cold time is past what we can accept for this organ, we'll pass.",
  ORGAN_SPECIFIC_TEST_RESULTS: "The latest labs on this organ don't look right to our team, declining.",
  DONOR_MEDICAL_HISTORY: "Given the donor's medical history we're going to decline this one.",
  ORGAN_ANATOMICAL_DEFECT: "Anatomy on the imaging is not something our surgeon wants to take.",
  BIOPSY_UNACCEPTABLE: "Biopsy findings are outside our acceptance range, we'll decline.",
  OTHER: "We're going to pass on this offer.",
  DONOR_AGE: "Donor age is above our threshold for this candidate.",
  ORGAN_PRESERVATION: "The preservation method used doesn't work for our protocol.",
  LOG_WIT_TOO_LONG: "Warm ischemic time is longer than we accept.",
  CANDIDATE_UNAVAILABLE: "Our candidate isn't available right now, please pass.",
  POSITIVE_CROSSMATCH: "Virtual crossmatch is positive, we cannot use it.",
  LOG_TEAM_OR_FACILITY_UNAVAILABLE: "No OR availability tonight, we have to decline.",
  LOG_RECOVERY_TEAM_UNAVAILABLE: "We can't field a recovery team for this window.",
  SIZE_MISMATCH: "Size mismatch with our candidate.",
  DONOR_KDPI_TOO_HIGH: "KDPI is higher than our candidate agreed to accept.",
  LOG_TRANSPORTATION_UNAVAILABLE: "We can't arrange transport in time.",
  BLOOD_TYPE_INCOMPATIBLE: "Blood type is not compatible with our candidate.",
};

function prosa(codigo: CodigoRechazo): string {
  return PROSA_RECHAZO[codigo] ?? "We're going to decline this offer.";
}

/** Multiplicadores temporales de §11.3, evaluados sobre la hora de simulación. */
export function multiplicadorTemporal(perfil: Centro["perfil"], t_sim: number): number {
  const horas = (t_sim / 3_600_000) % 24;
  const dia = Math.floor(t_sim / 86_400_000) % 7;
  let m = 1;
  if (horas >= 18 || horas < 6) m *= perfil.multiplicadorNocturno; // H37
  if (dia === 5 || dia === 6) m *= perfil.multiplicadorFinDeSemana; // H38
  return m;
}

/** Semilla del comportamiento: órgano + centro + intento. Nada más. */
export function semillaComportamiento(semilla: string, organoId: string, centroId: string, intento: number): string {
  return `${semilla}::centro::${organoId}::${centroId}::${intento}`;
}

function camposDeCompromiso(azar: Aleatorio, oferta: Oferta): CampoRevelado[] {
  const cirujano = nombreCirujano(azar);
  const sala = `OR-${azar.entero(1, 13)}`;
  const horaOR = oferta.t_sim + azar.entero(3, 10) * 3_600_000;
  const eta = oferta.t_sim + azar.entero(2, 7) * 3_600_000;
  return [
    {
      campo: "cirujanoNombrado",
      valor: cirujano,
      retraso_s: Math.round(azar.rango(20, 90)),
      literal: `${cirujano} will do the recovery.`,
    },
    {
      campo: "quirofanoReservado",
      valor: JSON.stringify({ sala, hora: horaOR }),
      retraso_s: Math.round(azar.rango(40, 160)),
      literal: `We have ${sala} held, in at ${new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(horaOR)} UTC.`, // lint-reloj: permitido — formato, no reloj
    },
    {
      campo: "receptorConfirmadoDisponible",
      valor: "true",
      retraso_s: Math.round(azar.rango(30, 200)),
      literal: "The recipient is in house and cleared to go.",
    },
    {
      campo: "etaEquipoRecuperacion",
      valor: String(eta),
      retraso_s: Math.round(azar.rango(60, 260)),
      literal: `Our recovery team can be wheels-down about ${Math.round((eta - oferta.t_sim) / 3_600_000)} hours from now.`,
    },
  ];
}

/**
 * Decide todo lo que este centro hará ante esta oferta.
 *
 * No recibe quién pregunta. A propósito.
 */
export function generarGuion(
  centro: Centro,
  oferta: Oferta,
  candidatoGrupo: GrupoSanguineo,
  candidatoAceptaDcd: boolean,
  candidatoKdpiMaximo: number,
  semillaBase: string,
): GuionCentro {
  const azar = crearAleatorio(semillaBase);
  const perfil = centro.perfil;

  const base = {
    centroId: centro.id,
    latenciaPrimeraRespuesta_s: Math.round(
      Math.min(900, azar.logNormal(perfil.latenciaRespuesta_s.mu, perfil.latenciaRespuesta_s.sigma)) *
        multiplicadorTemporal(perfil, oferta.t_sim),
    ),
    completara: false,
    camposRevelados: [] as CampoRevelado[],
    camposFaltantes: [] as CampoCompromiso[],
    retrasoRechazoTardio_s: Math.round(azar.normal(1.5 * 3600, 900)), // H07
  };

  const duro = (codigo: CodigoRechazo, regla: string): GuionCentro => ({
    ...base,
    decision: "rechazo",
    codigoRechazo: codigo,
    prosaRespuesta: prosa(codigo),
    reglaDura: regla,
  });

  // --- reglas duras: deterministas, no dependen del azar ni del llamante ---
  if (!compatibleABO(oferta.grupoSanguineo, candidatoGrupo)) {
    return duro("BLOOD_TYPE_INCOMPATIBLE", "ABO incompatible");
  }
  if (oferta.via === "DCD" && (!perfil.aceptaDCD || !candidatoAceptaDcd)) {
    return duro("DONOR_MEDICAL_HISTORY", "el centro o el candidato no acepta DCD");
  }
  if (oferta.kdpi !== null && (oferta.kdpi > perfil.kdpiMaximo || oferta.kdpi > candidatoKdpiMaximo)) {
    return duro("DONOR_KDPI_TOO_HIGH", `KDPI ${oferta.kdpi} sobre el máximo aceptado`);
  }
  if (oferta.citProyectadaAlImplante_h > perfil.citMaximaTolerada_h) {
    return duro(
      "LOG_CIT_TOO_LONG",
      `CIT proyectada ${oferta.citProyectadaAlImplante_h.toFixed(1)} h > tolerada ${perfil.citMaximaTolerada_h.toFixed(1)} h`,
    );
  }
  if (perfil.requiereBiopsia && !oferta.biopsiaRealizada && oferta.tipo.startsWith("rinon")) {
    return duro("BIOPSY_UNACCEPTABLE", "el centro exige biopsia y no la hay");
  }

  // --- parte estocástica calibrada ---
  if (azar.bernoulli(perfil.pProvisionalYes)) {
    // H05: 70 % de los provisional yes terminan en rechazo tardío.
    const completara = azar.bernoulli(perfil.pCompromisoCompletoDadoProvisional);
    const campos = camposDeCompromiso(azar, oferta);
    let revelados = campos;
    let faltantes: CampoCompromiso[] = [];
    if (!completara) {
      // Revela algunos y se queda corto justo en los que importan.
      const cuantos = azar.entero(0, 3);
      revelados = campos.slice(0, cuantos);
      faltantes = campos.slice(cuantos).map((c) => c.campo);
    }
    return {
      ...base,
      decision: "provisional",
      codigoRechazo: null,
      prosaRespuesta: "That could work for our patient — provisional yes, let me check with the team.",
      completara,
      camposRevelados: revelados,
      camposFaltantes: faltantes,
      reglaDura: null,
    };
  }

  // Aceptación directa: rara, y solo si el margen de isquemia es holgado.
  const margen = perfil.citMaximaTolerada_h - oferta.citProyectadaAlImplante_h;
  if (margen > 3 && azar.bernoulli(0.06)) {
    const campos = camposDeCompromiso(azar, oferta);
    return {
      ...base,
      decision: "aceptacion_directa",
      codigoRechazo: null,
      prosaRespuesta: "Yes, we'll take it. Here are our details.",
      completara: true,
      camposRevelados: campos,
      camposFaltantes: [],
      reglaDura: null,
    };
  }

  const codigo = azar.categorico(perfil.distribucionRechazo) as CodigoRechazo;
  return { ...base, decision: "rechazo", codigoRechazo: codigo, prosaRespuesta: prosa(codigo), reglaDura: null };
}

/** Construye la oferta que se presenta a un centro (§8.3 paso 1). */
export function construirOferta(
  donante: Donante,
  organo: Organo,
  secuencia: number,
  citActual_h: number,
  citProyectadaAlImplante_h: number,
  t_sim: number,
): Oferta {
  return {
    organoId: organo.id,
    tipo: organo.tipo,
    via: donante.via,
    edad: donante.edad,
    grupoSanguineo: donante.grupoSanguineo,
    kdpi: organo.tipo.startsWith("rinon") ? donante.kdpi : null,
    serologias: donante.serologias,
    biopsiaRealizada: donante.biopsiaRealizada,
    citActual_h,
    citProyectadaAlImplante_h,
    secuencia,
    t_sim,
  };
}
