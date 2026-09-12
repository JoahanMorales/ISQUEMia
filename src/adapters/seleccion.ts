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
  };
}

export function decidirAdaptadores(env: Entorno): SeleccionAdaptadores[] {
  const fila = (slot: string, remoto: boolean, implRemota: string, implLocal: string, llave: string): SeleccionAdaptadores => ({
    slot,
    implementacion: remoto ? implRemota : implLocal,
    remoto,
    motivo: remoto ? `${llave} presente` : `sin ${llave}: se usa la implementación local determinista`,
  });

  const auth0 = Boolean(env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET);
  const llm = Boolean(env.OPENAI_API_KEY || env.OPENROUTER_API_KEY);

  return [
    fila("LLM_NEGOCIACION", llm, env.OPENROUTER_API_KEY ? "openrouter" : "openai", "guionado", "OPENAI_API_KEY"),
    fila("LLM_TRIAGE", llm, env.OPENROUTER_API_KEY ? "openrouter" : "openai", "reglas", "OPENAI_API_KEY"),
    fila("VOZ", Boolean(env.OPENAI_API_KEY), "openai-realtime", "voz-guionada", "OPENAI_API_KEY"),
    fila("WORKSPACE", Boolean(env.AMBIGUOUS_API_KEY), "ambiguous", "espejo-local", "AMBIGUOUS_API_KEY"),
    fila("BUSQUEDA", Boolean(env.EXA_API_KEY), "exa", "corpus-estatico", "EXA_API_KEY"),
    fila("AUTH", auth0, "auth0", "identidad-local", "AUTH0_*"),
    fila("RUNTIME", Boolean(env.TRIGGER_SECRET_KEY), "trigger.dev", "motor-local", "TRIGGER_SECRET_KEY"),
    fila("ALMACEN", Boolean(env.DATABASE_URL), "postgres", "memoria", "DATABASE_URL"),
    { slot: "UI_TRANSPORTE", implementacion: "copilotkit/ag-ui", remoto: true, motivo: "siempre activo" },
    { slot: "OBSERVABILIDAD", implementacion: "spans propios", remoto: false, motivo: "§14.1" },
  ];
}
