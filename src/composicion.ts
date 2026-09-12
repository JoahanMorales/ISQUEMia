/**
 * Composición — el único lugar donde el dominio se ata a implementaciones
 * concretas. Cambiar un slot `[STACK]` (§5.4) se hace aquí y en ningún otro
 * archivo. Es también la única capa que puede importar de `adapters/`.
 */

import { AlmacenMemoria } from "./adapters/almacen-memoria";
import { BusMemoria } from "./adapters/bus-memoria";
import { IdentidadLocal } from "./adapters/identidad-local";
import {
  ESQUEMA_CODIGO_RECHAZO,
  mapearProsaACodigo,
  RouterLocal,
  validaEsquemaCodigo,
} from "./adapters/llm-guionado";
import { MotorLocal } from "./adapters/motor-local";
import { ObservabilidadMemoria } from "./adapters/observabilidad-memoria";
import { RuntimeAsync } from "./adapters/runtime-async";
import { decidirAdaptadores, leerEntorno, type Entorno } from "./adapters/seleccion";
import { WorkspaceAmbiguous } from "./adapters/workspace-ambiguous";
import { WorkspaceEspejo } from "./adapters/workspace-espejo";
import { crearAleatorio, type Aleatorio } from "./domain/aleatorio";
import { POLITICA_POR_DEFECTO, type Politica } from "./domain/politica";
import type { IdentidadAgente, SeleccionAdaptadores, Workspace } from "./domain/puertos";
import { Registrador } from "./domain/registro";
import type { Perfusion, TipoOrgano } from "./domain/tipos";
import { CorridaIsquemia } from "./orquestacion/corrida";
import { E } from "./orquestacion/eventos";
import { Mundo } from "./sim/mundo";
import { RelojSimulacion } from "./sim/reloj";

export interface Corrida {
  corridaId: string;
  semilla: string;
  politica: Politica;
  reloj: RelojSimulacion;
  almacen: AlmacenMemoria;
  bus: BusMemoria;
  obs: ObservabilidadMemoria;
  runtime: RuntimeAsync;
  motor: MotorLocal;
  registro: Registrador;
  azar: Aleatorio;
  workspace: Workspace;
  identidad: IdentidadAgente;
  mundo: Mundo;
  isquemia: CorridaIsquemia;
  adaptadores: SeleccionAdaptadores[];
}

export interface OpcionesCorrida {
  semilla: string;
  corridaId?: string;
  politica?: Partial<Politica>;
  t0?: number;
  factor?: number;
  tipoOrgano?: TipoOrgano;
  perfusion?: Perfusion | null;
  entorno?: Entorno;
}

export function crearCorrida(opciones: OpcionesCorrida): Corrida {
  const { semilla } = opciones;
  const corridaId = opciones.corridaId ?? `run-${semilla}`;
  const politica = { ...POLITICA_POR_DEFECTO, ...opciones.politica };
  const entorno = opciones.entorno ?? leerEntorno();

  const reloj = new RelojSimulacion({ t0: opciones.t0 ?? 0, factor: opciones.factor ?? 1 });
  const bus = new BusMemoria();
  const almacen = new AlmacenMemoria({ corridaId, semilla });
  const obs = new ObservabilidadMemoria(reloj, corridaId, semilla);
  const runtime = new RuntimeAsync();
  const registro = new Registrador(reloj, almacen, bus);
  const azar = crearAleatorio(semilla);
  // Slot WORKSPACE: Ambiguous AI si hay credencial, espejo local si no. El
  // adaptador remoto escribe también en el espejo, así que el panel se ve
  // igual en los dos casos y la insignia dice cuál está activo.
  const workspace: Workspace = entorno.AMBIGUOUS_API_KEY
    ? new WorkspaceAmbiguous({
        reloj,
        apiKey: entorno.AMBIGUOUS_API_KEY,
        baseUrl: entorno.AMBIGUOUS_MCP_URL,
        alDegradar: ({ operacion, error }) => {
          // G9: la degradación se ve, no se esconde.
          registro.emitir("escribano", E.DEGRADACION_PROVEEDOR, {
            slot: "WORKSPACE",
            motivo: `${operacion} falló contra Ambiguous; queda el espejo local`,
            error,
          });
        },
      })
    : new WorkspaceEspejo(reloj);
  const modelos = new RouterLocal();
  const triage = {
    esquema: ESQUEMA_CODIGO_RECHAZO as unknown as Record<string, unknown>,
    valida: validaEsquemaCodigo,
    porDefecto: mapearProsaACodigo,
  };
  const identidad = new IdentidadLocal();

  const motor = new MotorLocal({
    maxEvaluaciones: politica.N_CARRILES,
    maxCompromisos: politica.MAX_CONCURRENTES_POLITICA,
    alCambiar: (estado) => {
      registro.emitir("despachador", E.CONCURRENCIA_CAMBIO, { motivo: "motor", ...estado });
    },
  });

  const mundo = new Mundo({
    semilla,
    reloj,
    tipoOrgano: opciones.tipoOrgano ?? "higado",
    perfusion: opciones.perfusion ?? null,
    nCentros: politica.N_CARRILES,
  });

  const isquemia = new CorridaIsquemia(mundo, {
    reloj, almacen, registro, motor, obs, workspace, politica, modelos, triage,
  });

  const adaptadores = decidirAdaptadores(entorno);
  for (const a of adaptadores) {
    registro.emitir("simulador", E.ADAPTADOR_SELECCIONADO, { ...a });
  }

  return {
    corridaId, semilla, politica, reloj, almacen, bus, obs, runtime, motor,
    registro, azar, workspace, identidad, mundo, isquemia, adaptadores,
  };
}
