/**
 * SSE crudo del event store — ARQUITECTURA.md §8.
 *
 * El panel se alimenta de AG-UI; esto es el otro extremo: el registro sin
 * proyectar, evento por evento, para el inspector y para cualquiera que quiera
 * auditar la corrida en vivo con `curl`. Es la misma propiedad que hace posible
 * el expediente — todo está en el registro — expuesta directamente.
 *
 *   curl -N http://localhost:3000/api/eventos
 */

import { sesionPorDefecto } from "../../../agui/sesion";
import type { Evento } from "../../../domain/tipos";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sesion = sesionPorDefecto();
  const codificador = new TextEncoder();

  const flujo = new ReadableStream<Uint8Array>({
    start(controlador) {
      let cerrado = false;
      const enviar = (tipo: string, dato: unknown) => {
        if (cerrado) return;
        try {
          controlador.enqueue(codificador.encode(`event: ${tipo}\ndata: ${JSON.stringify(dato)}\n\n`));
        } catch {
          cerrado = true;
        }
      };

      // Primero el histórico, para que quien se conecte tarde vea la corrida
      // completa y no solo la cola.
      for (const e of sesion.corrida.almacen.todos()) enviar("historico", e);
      enviar("sincronizado", {
        corridaId: sesion.corrida.corridaId,
        semilla: sesion.corrida.semilla,
        eventos: sesion.corrida.almacen.todos().length,
      });

      const desuscribir = sesion.suscribir((e: Evento) => enviar("evento", e));

      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        desuscribir();
        try {
          controlador.close();
        } catch {
          /* ya estaba cerrado */
        }
      };
      request.signal.addEventListener("abort", cerrar);
    },
  });

  return new Response(flujo, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
