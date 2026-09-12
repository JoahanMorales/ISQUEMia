/**
 * Runtime de CopilotKit — el único endpoint AG-UI.
 *
 * Registra dos agentes:
 *   `isquemia` — el orquestador completo (ARQUITECTURA.md §2). Su estado *es*
 *                el panel: P1 a P5 leen de aquí vía `useAgent`.
 *   `copiloto` — asistente de operación sobre el mismo estado, para preguntas
 *                del operador. Solo existe si hay OPENAI_API_KEY; si no, el
 *                panel funciona igual y la insignia lo dice.
 */

import {
  BuiltInAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { IsquemiaAgent } from "../../../../agui/isquemia-agent";
import { sesionPorDefecto } from "../../../../agui/sesion";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const runtime = new CopilotRuntime({
  // Un hilo de ISQUEMIA vive tanto como la corrida: minutos, no un turno de
  // chat. Con el comportamiento por defecto (`throw`), cualquier remontaje del
  // cliente —React StrictMode en desarrollo, un refresco, una segunda pestaña—
  // choca contra el run vivo con "Thread already running" y el panel se queda
  // en blanco para siempre. `supersede` aborta el run anterior y deja entrar al
  // nuevo, que es exactamente lo que queremos: el último que mira, manda.
  runner: new InMemoryAgentRunner({ onConcurrentRun: "supersede" }),
  agents: () => {
    const sesion = sesionPorDefecto();
    const agentes: Record<string, AbstractAgent> = {
      isquemia: new IsquemiaAgent(sesion),
    };
    if (process.env.OPENAI_API_KEY) {
      agentes.copiloto = new BuiltInAgent({
        model: "openai:gpt-5.4-mini",
        // §8.3: temperatura 0 donde sea posible — el copiloto lee estado, no inventa.
        temperature: 0,
        prompt: [
          "You are the operations copilot inside ISQUEMIA, a deceased-donor organ placement console.",
          "The panel state is given to you as context: lanes, the cold ischemia clock, the verified-commitment checkboxes, the transport options and the AOOS file.",
          "Answer from that state. Never invent a clinical value: if it is not in the state, say it is not in the record.",
          "You do not decide allocation, determine death, or predict anything. Those are out of scope by design.",
          "Be terse. The reader is watching a clock.",
        ].join(" "),
      });
    }
    return agentes;
  },
});

const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

export const GET = handler;
export const POST = handler;
