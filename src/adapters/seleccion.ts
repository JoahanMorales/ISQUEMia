/**
 * Selección de adaptadores: remoto si existe la credencial, local si no.
 *
 * El resultado se emite como eventos `ADAPTADOR_SELECCIONADO` y se pinta como
 * insignias en el panel. El jurado ve exactamente qué es real y qué está
 * simulado; la honestidad es parte del producto, no una nota al pie.
 */

import type { SeleccionAdaptadores } from "../domain/puertos";

export interface Entorno {
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AMBIGUOUS_API_KEY?: string;
  AMBIGUOUS_MCP_URL?: string;
  EXA_API_KEY?: string;
  AUTH0_DOMAIN?: string;
  AUTH0_CLIENT_ID?: string;
  AUTH0_CLIENT_SECRET?: string;
  TRIGGER_SECRET_KEY?: string;
  DATABASE_URL?: string;
  /**
   * Modelo del copiloto conversacional, con prefijo de proveedor:
   * `openai:gpt-5.4-mini` o `openrouter:dots-studio/dots-3-note-preview:free`.
   * Existe porque una cuenta puede tener llave válida y cero saldo: así se
   * mueve el copiloto a un modelo gratuito sin tocar código.
   */
  COPILOTO_MODELO?: string;
  /** Igual, para los slots de dominio. Ver `composicion.ts`. */
  MODELO_TRIAGE?: string;
  MODELO_NEGOCIACION?: string;
}

export function leerEntorno(env: Record<string, string | undefined> = process.env): Entorno {
  const tomar = (k: keyof Entorno) => {
    const v = env[k];
    return v && v.trim().length > 0 ? v.trim() : undefined;
  };
  return {
    OPENAI_API_KEY: tomar("OPENAI_API_KEY"),
    OPENROUTER_API_KEY: tomar("OPENROUTER_API_KEY"),
    AMBIGUOUS_API_KEY: tomar("AMBIGUOUS_API_KEY"),
    AMBIGUOUS_MCP_URL: tomar("AMBIGUOUS_MCP_URL"),
    EXA_API_KEY: tomar("EXA_API_KEY"),
    AUTH0_DOMAIN: tomar("AUTH0_DOMAIN"),
    AUTH0_CLIENT_ID: tomar("AUTH0_CLIENT_ID"),
    AUTH0_CLIENT_SECRET: tomar("AUTH0_CLIENT_SECRET"),
    TRIGGER_SECRET_KEY: tomar("TRIGGER_SECRET_KEY"),
    DATABASE_URL: tomar("DATABASE_URL"),
    COPILOTO_MODELO: tomar("COPILOTO_MODELO"),
    MODELO_TRIAGE: tomar("MODELO_TRIAGE"),
    MODELO_NEGOCIACION: tomar("MODELO_NEGOCIACION"),
  };
}

export function decidirAdaptadores(env: Entorno): SeleccionAdaptadores[] {
  const fila = (
    slot: string,
    remoto: boolean,
    implRemota: string,
    implLocal: string,
    motivoLocal: string,
    motivoRemoto?: string,
  ): SeleccionAdaptadores => ({
    slot,
    implementacion: remoto ? implRemota : implLocal,
    remoto,
    motivo: remoto ? motivoRemoto ?? "credencial presente" : motivoLocal,
  });

  // Una insignia solo dice «remoto» si existe el adaptador **y** la credencial.
  // Tener la llave no basta: marcar como remoto un slot cuyo adaptador no está
  // escrito sería exactamente la mentira que estas insignias existen para
  // evitar (ARQUITECTURA.md §10).
  const llmRemoto = Boolean(env.OPENAI_API_KEY || env.OPENROUTER_API_KEY);
  const implLlm = env.OPENAI_API_KEY ? "openai" : "openrouter";

  return [
    fila("LLM_NEGOCIACION", llmRemoto, implLlm, "guionado",
      "sin OPENAI_API_KEY: reglas deterministas",
      `${implLlm}; el camino síncrono se sirve de caché y un fallo degrada visible (G9)`),
    fila("LLM_TRIAGE", llmRemoto, implLlm, "reglas",
      "sin OPENAI_API_KEY: mapeo por reglas",
      `${implLlm}; idem`),
    fila("VOZ", false, "openai-realtime", "voz-guionada",
      "adaptador de Realtime no implementado: los seis carriles de voz corren guionados"),
    fila("WORKSPACE", Boolean(env.AMBIGUOUS_API_KEY), "ambiguous", "espejo-local",
      "sin AMBIGUOUS_API_KEY: solo espejo local",
      "Ambiguous AI por MCP, con espejo local en paralelo"),
    fila("BUSQUEDA", Boolean(env.EXA_API_KEY), "exa", "corpus-estatico",
      "sin EXA_API_KEY: solo las tablas estáticas de §11.1.7",
      "Exa corrobora la ruta elegida; el plan sigue saliendo de las tablas deterministas"),
    fila("AUTH", false, "auth0", "identidad-local",
      "adaptador de Auth0 no implementado: identidad local del agente"),
    fila("RUNTIME", false, "trigger.dev", "motor-local",
      "adaptador de Trigger.dev no implementado: la política 40/4 la aplica el motor local"),
    fila("ALMACEN", false, "postgres", "memoria",
      "adaptador de Postgres no implementado: event store en memoria del proceso"),
    { slot: "UI_TRANSPORTE", implementacion: "copilotkit/ag-ui", remoto: true, motivo: "siempre activo" },
    { slot: "OBSERVABILIDAD", implementacion: "spans propios", remoto: false, motivo: "§14.1" },
  ];
}
