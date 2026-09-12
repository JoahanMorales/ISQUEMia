"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopilotSidebar,
  useAgent,
  useAgentContext,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { EstadoPanel } from "../agui/estado";
import { Rejilla, DetalleCarril } from "./carriles";
import { Registro } from "./registro";
import { Cabecera } from "./cabecera";
import { Cintillo } from "./cintillo";
import { Referral } from "./pantallas/referral";
import { Transporte, TarjetasTransporte } from "./pantallas/transporte";
import { Expediente, TarjetaExpediente } from "./pantallas/expediente";
import { Metricas } from "./pantallas/metricas";
import { PanelWorkspace } from "./pantallas/workspace";

export type Pestana = "sala" | "referral" | "transporte" | "expediente" | "metricas" | "workspace";

export function Consola() {
  // Todo el panel se alimenta del estado del agente AG-UI. No hay un segundo
  // canal ni estado de dominio en el cliente: ARQUITECTURA.md §2.
  const { agent, isReady } = useAgent({
    agentId: "isquemia",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
    throttleMs: 120,
  });

  const [pestana, setPestana] = useState<Pestana>("sala");
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string | null>(null);

  // Respaldo de estado por HTTP. El canal bueno es AG-UI, pero un panel de sala
  // no puede quedarse en blanco porque un stream se cayó: mientras el snapshot
  // del agente no llegue, la consola se pinta con la misma proyección leída por
  // `GET /api/corrida`. Es la misma función `proyectar` y el mismo servidor, no
  // una segunda fuente de verdad.
  const [respaldo, setRespaldo] = useState<EstadoPanel | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const porStream = agent.state as unknown as EstadoPanel | undefined;
  const estado = porStream?.organo ? porStream : respaldo ?? undefined;
  const enRespaldo = !porStream?.organo && respaldo !== null;

  // Arranca la corrida en cuanto la página se monta: el reloj no espera.
  // El guardia es un ref, no un estado: el doble montaje de React StrictMode
  // vuelve a entrar con el mismo render, así que un `useState` no lo detiene y
  // el segundo run chocaría con el primero.
  const corriendoRef = useRef(false);

  const arrancarStream = useCallback(async () => {
    if (corriendoRef.current) return;
    corriendoRef.current = true;
    try {
      await agent.runAgent({});
      setFallo(null);
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e));
    } finally {
      corriendoRef.current = false;
    }
  }, [agent]);

  useEffect(() => {
    // La sesión del servidor se crea perezosa y sin arrancar, para que el
    // reloj de isquemia empiece cuando alguien está mirando y no cuando el
    // proceso de Next se levantó.
    void fetch("/api/corrida", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accion: "arrancar" }),
    }).catch(() => {});
    void arrancarStream();
  }, [arrancarStream]);

  // Sondeo de respaldo: barato, y solo mientras el stream no haya entregado
  // estado. En cuanto AG-UI manda su snapshot, esto se apaga solo.
  const streamVivoRef = useRef(false);
  streamVivoRef.current = Boolean(porStream?.organo);

  useEffect(() => {
    let vivo = true;
    const leer = async () => {
      try {
        const r = await fetch("/api/corrida", { cache: "no-store" });
        const j = (await r.json()) as { estado: EstadoPanel };
        if (vivo && j?.estado) setRespaldo(j.estado);
      } catch {
        /* el siguiente tick reintenta */
      }
    };
    void leer();
    // lint-reloj: permitido — sondeo de respaldo en el navegador; es tiempo de
    // pared de la interfaz, no tiempo de simulación.
    const id = setInterval(() => { // lint-reloj: permitido — tiempo de pared de la interfaz
      if (!vivo || streamVivoRef.current) return;
      void leer();
    }, 1000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  // ---------------------------------------------------------------- contexto
  // El copiloto ve el panel sin que el operador se lo cuente.
  useAgentContext({
    description: "Live ISQUEMIA console state",
    // Durante el render del servidor el estado aún no ha llegado: todo aquí
    // tiene que tolerar un objeto vacío sin romper la página.
    value: (estado?.organo
      ? {
          fase: estado.fase,
          organo: estado.organo,
          resumen: estado.resumen,
          baseline: estado.baseline,
          metricas: estado.metricas,
          carriles: (estado.carriles ?? []).map((c) => ({
            secuencia: c.secuencia,
            centro: c.centroNombre,
            estado: c.estado,
            codigoRechazo: c.codigoRechazo,
            camposFaltantes: c.camposFaltantes,
          })),
          escalamientos: estado.escalamientos ?? [],
        }
      : { fase: "connecting" }) as unknown as Parameters<typeof useAgentContext>[0]["value"],
  });

  // ------------------------------------------------------- herramientas de UI
  // El copiloto opera el panel: enfoca carriles, filtra, cambia de pantalla,
  // mueve el reloj. Son acciones reales, no respuestas de texto.

  useFrontendTool({
    name: "enfocarCarril",
    description: "Focus one lane in the grid by its match run sequence number and open its detail panel.",
    parameters: z.object({ secuencia: z.number().int().describe("Match run sequence, 1-based") }),
    handler: async ({ secuencia }) => {
      const c = estado?.carriles?.find((x) => x.secuencia === secuencia);
      if (!c) return `No lane at sequence #${secuencia}.`;
      setPestana("sala");
      setSeleccionado(c.id);
      return `Focused lane #${secuencia} (${c.centroNombre}), state ${c.estado}.`;
    },
  }, [estado]);

  useFrontendTool({
    name: "filtrarCarriles",
    description: "Filter the 40-lane grid by lane state, or clear the filter.",
    parameters: z.object({
      estado: z
        .enum(["ABIERTO", "CONTACTANDO", "ESPERANDO_RESPUESTA", "PROVISIONAL", "VERIFICANDO",
               "RECHAZADO", "COMPROMETIDO", "DEGRADADO", "ACEPTADO_DIRECTO", "TIMEOUT", "ABORTADO", "TODOS"])
        .describe("Lane state to show, or TODOS to clear"),
    }),
    handler: async ({ estado: e }) => {
      setPestana("sala");
      setFiltro(e === "TODOS" ? null : e);
      const n = e === "TODOS" ? estado?.carriles?.length : estado?.carriles?.filter((c) => c.estado === e).length;
      return `Showing ${n ?? 0} lanes${e === "TODOS" ? "" : ` in ${e}`}.`;
    },
  }, [estado]);

  useFrontendTool({
    name: "abrirPantalla",
    description: "Switch the console to another screen: the placement room, the referral clock, transport routing, the AOOS file, the metrics panel, or the workspace mirror.",
    parameters: z.object({
      pantalla: z.enum(["sala", "referral", "transporte", "expediente", "metricas", "workspace"]),
    }),
    handler: async ({ pantalla }) => {
      setPestana(pantalla as Pestana);
      return `Opened ${pantalla}.`;
    },
  });

  useFrontendTool({
    name: "controlarReloj",
    description: "Control the simulation clock: freeze it, resume it, change the acceleration factor, or run the whole campaign to completion.",
    parameters: z.object({
      accion: z.enum(["congelar", "reanudar", "factor", "adelantar"]),
      factor: z.number().optional().describe("Acceleration, 1 to 600, only for accion=factor"),
    }),
    handler: async ({ accion, factor }) => {
      await fetch("/api/corrida", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion, factor }),
      });
      return accion === "factor" ? `Clock now running at ${factor}×.` : `Clock ${accion}.`;
    },
  });

  useFrontendTool({
    name: "compararConBaseline",
    description: "Report the agent run against the serial human baseline on the same seed.",
    parameters: z.object({}),
    handler: async () => {
      if (!estado) return "No state yet.";
      const m = estado.metricas;
      return JSON.stringify({
        agente: { secuencia: estado.resumen.mejorSecuencia, ofertas: estado.resumen.ofertasEmitidas },
        baseline: {
          secuencia: estado.baseline.secuenciaFinal,
          ofertas: estado.baseline.ofertas,
          rechazosTardios: estado.baseline.rechazosTardios,
        },
        horasAhorradas: m?.M1_horasIsquemiaAhorradas ?? null,
        provisionalYesInterceptados: `${estado.resumen.degradaciones}/${estado.resumen.provisionalYes}`,
      });
    },
  }, [estado]);

  // ------------------------------------------------- humano en el bucle (G7)
  // El escalamiento no es una notificación: el agente se detiene y espera.

  useHumanInTheLoop({
    name: "escalarAHumano",
    description:
      "Escalate an ambiguous case to the human coordinator and wait for their decision. Required by guardrail G7 whenever the Sentinel's confidence is below 0.8.",
    parameters: z.object({
      pacienteId: z.string(),
      motivo: z.string().describe("Why this needs a human"),
      contexto: z.string().optional(),
    }),
    render: ({ args, respond, status }) => (
      <div className="tarjeta" style={{ borderColor: "var(--aviso-borde)", background: "var(--aviso-suave)" }}>
        <h4>Escalation — human decision required</h4>
        <div style={{ fontSize: 12, color: "var(--texto-2)", marginBottom: 4 }}>
          Patient <span className="num">{String(args.pacienteId ?? "—")}</span>
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 10 }}>{String(args.motivo ?? "")}</div>
        {args.contexto && <div className="cita">{String(args.contexto)}</div>}
        {status === "executing" && respond ? (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn on" onClick={() => respond({ decision: "refer", nota: "Coordinator approved referral" })}>
              Refer to OPO
            </button>
            <button className="btn" onClick={() => respond({ decision: "hold", nota: "Coordinator will re-assess" })}>
              Hold and re-assess
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--texto-3)", marginTop: 8 }}>Answered.</div>
        )}
      </div>
    ),
  });

  useHumanInTheLoop({
    name: "autorizarFueraDeSecuencia",
    description:
      "Ask the coordinator to authorize an out-of-sequence (AOOS) placement. The system never reorders the match run on its own — guardrail G4.",
    parameters: z.object({
      secuencia: z.number().int(),
      centro: z.string(),
      justificacion: z.string(),
    }),
    render: ({ args, respond, status }) => (
      <div className="tarjeta" style={{ borderColor: "var(--critico-borde)", background: "var(--critico-suave)" }}>
        <h4>Out-of-sequence placement — authorization required</h4>
        <div style={{ fontSize: 12.5, marginBottom: 8 }}>
          Sequence <span className="num">#{String(args.secuencia ?? "—")}</span> · {String(args.centro ?? "")}
        </div>
        <div className="cita">{String(args.justificacion ?? "")}</div>
        {status === "executing" && respond ? (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn on" onClick={() => respond({ autorizado: true })}>Authorize with written justification</button>
            <button className="btn" onClick={() => respond({ autorizado: false })}>Refuse</button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--texto-3)", marginTop: 8 }}>Answered.</div>
        )}
      </div>
    ),
  });

  // ------------------------------------------------------------ generative UI
  // El agente emite tool calls y el catálogo de componentes los renderiza.
  // Nunca se genera HTML crudo (§12.1).

  useRenderTool({
    name: "mostrarPlanTransporte",
    parameters: z.object({ centroId: z.string().optional(), opciones: z.array(z.any()).optional() }),
    render: ({ parameters }) => <TarjetasTransporte opciones={(parameters?.opciones ?? []) as never} compacto />,
  });

  useRenderTool({
    name: "mostrarExpediente",
    parameters: z.object({}).passthrough(),
    render: ({ parameters }) => <TarjetaExpediente expediente={parameters as never} />,
  });

  const carrilSeleccionado = useMemo(
    () => estado?.carriles?.find((c) => c.id === seleccionado) ?? null,
    [estado, seleccionado],
  );

  const accion = useCallback(
    async (accion: string, extra: Record<string, unknown> = {}) => {
      await fetch("/api/corrida", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion, ...extra }),
      });
      // Reiniciar crea una sesión nueva; el stream vivo sigue atado a la vieja,
      // así que hay que volver a engancharlo o el panel se queda en la corrida
      // anterior.
      if (accion === "reiniciar") {
        setSeleccionado(null);
        setFiltro(null);
        void arrancarStream();
      }
    },
    [arrancarStream],
  );

  // El copiloto conversacional solo existe si hay credencial de modelo. Sin
  // ella el panel funciona igual y el hueco se explica en vez de quedar vacío.
  const hayCopiloto = Boolean(estado?.adaptadores?.find((a) => a.slot === "LLM_NEGOCIACION")?.remoto);

  if (!estado?.organo || !estado.carriles) {
    return (
      <div className="vacio" style={{ paddingTop: 120, display: "grid", gap: 12, justifyItems: "center" }}>
        <div>Connecting to the placement agent…</div>
        {fallo && (
          <>
            <div style={{ fontSize: 12, color: "var(--critico)" }}>{fallo}</div>
            <button className="btn on" onClick={() => void arrancarStream()}>
              Retry
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="app" style={{ paddingRight: hayCopiloto ? 380 : 0 }}>
      <Cabecera
        estado={estado}
        pestana={pestana}
        setPestana={setPestana}
        accion={accion}
        corriendo={isReady && !enRespaldo}
      />

      {pestana === "sala" && (
        <>
          <div className="cuerpo">
            <div>
              <div className="panel">
                <div className="panel-cab">
                  <span className="panel-tit">
                    Match run · {estado.carriles.length} lanes
                    {filtro ? ` · filtered: ${filtro.toLowerCase().replace(/_/g, " ")}` : ""}
                  </span>
                  <span className="kpi-nota">
                    {estado.resumen.verificandoAhora}/{estado.resumen.maxConcurrentes} verifying
                    {estado.resumen.enColaDeCompromiso > 0 ? ` · ${estado.resumen.enColaDeCompromiso} queued` : ""}
                  </span>
                </div>
                <Rejilla
                  carriles={estado.carriles}
                  seleccionado={seleccionado}
                  onSeleccionar={setSeleccionado}
                  filtro={filtro}
                />
              </div>
              {carrilSeleccionado && <DetalleCarril carril={carrilSeleccionado} />}
            </div>
            <Registro eventos={estado.eventos} />
          </div>
          <Cintillo estado={estado} />
        </>
      )}

      {pestana === "referral" && <Referral estado={estado} />}
      {pestana === "transporte" && <Transporte estado={estado} />}
      {pestana === "expediente" && <Expediente estado={estado} />}
      {pestana === "metricas" && <Metricas estado={estado} />}
      {pestana === "workspace" && <PanelWorkspace estado={estado} />}

      {hayCopiloto && (
        <div className="copilot-slot">
          <CopilotSidebar defaultOpen agentId="copiloto" header={{ title: "Operations copilot" } as never} />
        </div>
      )}
    </div>
  );
}
