/**
 * §8.3 — CARRIL y el protocolo de compromiso verificado.
 *
 * Esta es la contribución técnica del proyecto. La transición
 * `PROVISIONAL → VERIFICANDO → DEGRADADO` es la que justifica el producto
 * entero: un provisional yes que no llena los cuatro campos dentro de
 * `T_VERIFICACION` se degrada y libera el carril, en vez de consumir 1.5 h de
 * isquemia esperando un rechazo tardío (H07).
 *
 * Regla absoluta (§8.3 paso 5): el carril **nunca** rellena un campo que el
 * centro no dijo. Cada campo entra con su `Cita` de origen `respuesta_centro`;
 * `registrarCampo` rechaza cualquier otra cosa (G6).
 */

import { compromisoCompleto } from "../domain/guardrails";
import type { Politica } from "../domain/politica";
import type { MotorCarriles, Observabilidad, Reloj, RouterModelos } from "../domain/puertos";
import type { Registrador } from "../domain/registro";
import type {
  CampoCompromiso,
  Carril,
  Centro,
  Cita,
  CodigoRechazo,
  CompromisoVerificado,
  EntradaMatchRun,
  EstadoCarril,
  Modalidad,
  Turno,
} from "../domain/tipos";
import type { GuionCentro, Oferta } from "../sim/donornet";
import { E } from "./eventos";

export interface DepsCarril {
  reloj: Reloj;
  registro: Registrador;
  motor: MotorCarriles;
  obs: Observabilidad;
  politica: Politica;
  modelos: RouterModelos;
  /** Esquema y validador del triage de rechazo — lo que mide M6. */
  triage: {
    esquema: Record<string, unknown>;
    valida: (v: unknown) => boolean;
    porDefecto: (prosa: string) => { codigo: CodigoRechazo; confianza: number };
  };
}

export interface ResultadoCarril {
  carril: Carril;
  /** Horas de isquemia protegidas si terminó en DEGRADADO (H07). */
  horasProtegidas: number;
}

export class EjecutorCarril {
  readonly carril: Carril;
  #guion: GuionCentro;
  #centro: Centro;
  #oferta: Oferta;
  #d: DepsCarril;
  #cancelaciones: (() => void)[] = [];
  #alTerminar: (r: ResultadoCarril) => void;
  #terminado = false;
  #slotTomado = false;
  /** Cancela el timeout duro de carril; se suelta cuando otro plazo toma el mando. */
  #cancelarTimeoutDuro: (() => void) | null = null;
  #span: { fin: (m?: Record<string, unknown>) => void } | null = null;

  constructor(opciones: {
    id: string;
    organoId: string;
    entrada: EntradaMatchRun;
    modalidad: Modalidad;
    centro: Centro;
    oferta: Oferta;
    guion: GuionCentro;
    deps: DepsCarril;
    alTerminar: (r: ResultadoCarril) => void;
  }) {
    this.#centro = opciones.centro;
    this.#oferta = opciones.oferta;
    this.#guion = opciones.guion;
    this.#d = opciones.deps;
    this.#alTerminar = opciones.alTerminar;
    this.carril = {
      id: opciones.id,
      organoId: opciones.organoId,
      entradaMatchRun: opciones.entrada,
      modalidad: opciones.modalidad,
      estado: "ABIERTO",
      t_abierto: opciones.deps.reloj.now(),
      t_primeraRespuesta: null,
      t_cerrado: null,
      respuestaCruda: null,
      codigoRechazo: null,
      compromiso: null,
      intentos: 0,
      transcripcion: [],
      citas: [],
    };
  }

  get actor(): `carril:${string}` {
    return `carril:${this.carril.id}`;
  }

  // ------------------------------------------------------------- arranque

  arrancar(): void {
    this.#span = this.#d.obs.span("carril", {
      actor: this.actor,
      centroId: this.#centro.id,
      secuencia: this.carril.entradaMatchRun.secuencia,
      modalidad: this.carril.modalidad,
    });

    this.#d.registro.emitir(this.actor, E.CARRIL_ABIERTO, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      centroNombre: this.#centro.nombre,
      secuencia: this.carril.entradaMatchRun.secuencia,
      modalidad: this.carril.modalidad,
    });

    this.#transicion("CONTACTANDO");
    this.#hablar("agente", this.#textoOferta());
    this.carril.intentos++;
    this.#d.registro.emitir(this.actor, E.CARRIL_OFERTA_ENVIADA, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      oferta: this.#oferta,
    });

    this.#transicion("ESPERANDO_RESPUESTA");

    // Timeout duro del carril: cubre el hueco en el que el centro todavía no
    // ha dicho nada. En cuanto hay una respuesta con la que trabajar, el mando
    // pasa al plazo de verificación (ver `#cederElMando`).
    this.#cancelarTimeoutDuro = this.#agendarCancelable(
      this.#d.politica.T_TIMEOUT_CARRIL_s,
      () => this.#timeout(),
    );
    // La respuesta llega cuando el mundo dijo que llegaría.
    this.#agendar(this.#guion.latenciaPrimeraRespuesta_s, () => this.#recibirRespuesta());
  }

  /** El despachador cerró la colocación: este carril ya no sirve. */
  abortar(motivo: string): void {
    if (this.#esTerminal()) return;
    this.#d.registro.emitir(this.actor, E.CARRIL_ABORTADO, { carrilId: this.carril.id, motivo });
    this.#cerrar("ABORTADO");
  }

  // ------------------------------------------------------------- respuesta

  #recibirRespuesta(): void {
    if (this.#esTerminal()) return;
    this.carril.t_primeraRespuesta = this.#d.reloj.now();
    this.carril.respuestaCruda = this.#guion.prosaRespuesta;
    this.#hablar("centro", this.#guion.prosaRespuesta);

    const ev = this.#d.registro.emitir(this.actor, E.CARRIL_RESPUESTA_RECIBIDA, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      decision: this.#guion.decision,
      prosa: this.#guion.prosaRespuesta,
      latencia_s: this.#guion.latenciaPrimeraRespuesta_s,
      reglaDura: this.#guion.reglaDura,
    });

    switch (this.#guion.decision) {
      case "rechazo":
        // §8.3 paso 2: el centro da la razón en prosa; el carril la mapea a
        // código estandarizado y guarda la prosa como cita.
        return this.#rechazar(this.#mapearCodigo(this.#guion.prosaRespuesta), ev.id);
      case "aceptacion_directa":
        this.#cederElMando();
        return this.#pedirSlot(() => this.#verificar(true));
      case "provisional":
        this.#transicion("PROVISIONAL");
        this.#cederElMando();
        // Nivel 2 de concurrencia: solo 4 carriles verifican a la vez (H16).
        return this.#pedirSlot(() => this.#verificar(false));
    }
  }

  /** Llamada de triage: modelo barato, salida estructurada, validada contra esquema. */
  #mapearCodigo(prosa: string): CodigoRechazo {
    const llm = this.#d.modelos.para("triage");
    const span = this.#d.obs.span("triage.mapearCodigoRechazo", { actor: this.actor, modelo: llm.modelo });
    const r = llm.completeSync(
      [
        { rol: "system", contenido: "Map the transplant center's refusal prose to exactly one OPTN refusal code." },
        { rol: "user", contenido: prosa },
      ],
      undefined,
      this.#d.triage.esquema,
    );

    if (r === null) {
      // G9 — la degradación se ve, no se esconde.
      this.#d.registro.emitir(this.actor, E.DEGRADACION_PROVEEDOR, {
        slot: "LLM_TRIAGE",
        motivo: "fallo de caché del modelo remoto; se usa el mapeo por reglas",
        carrilId: this.carril.id,
      });
      span.fin({ resultado: "error", validacionEsquema: false });
      return this.#d.triage.porDefecto(prosa).codigo;
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.content);
    } catch {
      parsed = null;
    }
    const valido = this.#d.triage.valida(parsed);
    span.fin({
      resultado: "ok",
      validacionEsquema: valido,
      tokensEntrada: r.usage.entrada,
      tokensSalida: r.usage.salida,
      costoUSD: r.usage.costoUSD,
    });

    if (!valido) return this.#d.triage.porDefecto(prosa).codigo;
    return (parsed as { codigo: CodigoRechazo }).codigo;
  }

  #rechazar(codigo: CodigoRechazo, eventoId: string): void {
    this.carril.codigoRechazo = codigo;
    this.#citar({
      afirmacion: `el centro rechazó con código ${codigo}`,
      origen: "respuesta_centro",
      referencia: eventoId,
      literal: this.#guion.prosaRespuesta,
    });
    this.#d.registro.emitir(this.actor, E.CARRIL_RECHAZADO, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      codigo,
      literal: this.#guion.prosaRespuesta,
      secuencia: this.carril.entradaMatchRun.secuencia,
    });
    this.#cerrar("RECHAZADO");
  }

  #pedirSlot(alObtener: () => void): void {
    this.#d.motor.solicitarSlotCompromiso(
      this.carril.id,
      this.carril.entradaMatchRun.secuencia,
      () => {
        if (this.#esTerminal()) {
          this.#d.motor.liberarSlotCompromiso(this.carril.id);
          return;
        }
        this.#slotTomado = true;
        alObtener();
      },
    );
  }

  // ---------------------------------------------- protocolo de verificación

  #verificar(directa: boolean): void {
    this.#transicion("VERIFICANDO");
    this.carril.compromiso = {
      cirujanoNombrado: null,
      quirofanoReservado: null,
      receptorConfirmadoDisponible: null,
      etaEquipoRecuperacion: null,
      citTotalProyectada_h: this.#oferta.citProyectadaAlImplante_h,
      completo: false,
      t_verificado: null,
      citas: {},
    };

    // §8.3 paso 3: no se acepta el provisional yes, se pregunta por los cuatro.
    this.#hablar("agente", PREGUNTAS_COMPROMISO.join(" "));
    this.#d.registro.emitir(this.actor, E.CARRIL_VERIFICACION_INICIADA, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      directa,
      preguntas: PREGUNTAS_COMPROMISO,
      plazo_s: this.#d.politica.T_VERIFICACION_s,
    });

    for (const campo of this.#guion.camposRevelados) {
      this.#agendar(campo.retraso_s, () => this.#registrarCampo(campo.campo, campo.valor, campo.literal));
    }

    // El plazo es lo que convierte un provisional yes falso en una degradación
    // temprana en vez de en 1.5 h perdidas.
    this.#agendar(this.#d.politica.T_VERIFICACION_s, () => this.#resolverVerificacion());
  }

  #registrarCampo(campo: CampoCompromiso, valor: string, literal: string): void {
    if (this.#esTerminal() || !this.carril.compromiso) return;
    const c = this.carril.compromiso;

    const ev = this.#d.registro.emitir(this.actor, E.CARRIL_CAMPO_COMPROMISO, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      campo,
      valor,
      literal,
    });

    // G6: el campo solo entra acompañado de la cita de lo que el centro dijo.
    const cita: Cita = {
      afirmacion: `${campo} = ${valor}`,
      origen: "respuesta_centro",
      referencia: ev.id,
      literal,
    };
    c.citas[campo] = cita;
    this.#citar(cita);
    this.#hablar("centro", literal);

    switch (campo) {
      case "cirujanoNombrado":
        c.cirujanoNombrado = valor;
        break;
      case "quirofanoReservado":
        c.quirofanoReservado = JSON.parse(valor) as { sala: string; hora: number };
        break;
      case "receptorConfirmadoDisponible":
        c.receptorConfirmadoDisponible = valor === "true";
        break;
      case "etaEquipoRecuperacion":
        c.etaEquipoRecuperacion = Number(valor);
        break;
    }

    if (compromisoCompleto(c)) this.#resolverVerificacion();
  }

  #resolverVerificacion(): void {
    if (this.#esTerminal() || !this.carril.compromiso) return;
    const c = this.carril.compromiso;

    if (compromisoCompleto(c)) {
      c.completo = true;
      c.t_verificado = this.#d.reloj.now();
      this.#d.registro.emitir(this.actor, E.CARRIL_COMPROMETIDO, {
        carrilId: this.carril.id,
        centroId: this.#centro.id,
        secuencia: this.carril.entradaMatchRun.secuencia,
        compromiso: c,
        t_verificado: c.t_verificado,
      });
      this.#cerrar(this.#guion.decision === "aceptacion_directa" ? "ACEPTADO_DIRECTO" : "COMPROMETIDO");
      return;
    }

    // Degradación: el momento que justifica el producto.
    const faltantes = camposFaltantes(c);
    const horasProtegidas = this.#d.politica.HORAS_SALVADAS_POR_DEGRADACION;
    this.#d.registro.emitir(this.actor, E.CARRIL_DEGRADADO, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      centroNombre: this.#centro.nombre,
      secuencia: this.carril.entradaMatchRun.secuencia,
      camposFaltantes: faltantes,
      horasIsquemiaProtegidas: horasProtegidas,
      citaRespuesta: this.#guion.prosaRespuesta,
      retrasoRechazoTardioEvitado_s: this.#guion.retrasoRechazoTardio_s,
    });
    this.#d.registro.emitir(this.actor, E.DEGRADACION_PROTEGIO_ISQUEMIA, {
      carrilId: this.carril.id,
      horas: horasProtegidas,
    });
    this.#cerrar("DEGRADADO");
  }

  #timeout(): void {
    if (this.#esTerminal()) return;

    // Un centro que nunca contestó dentro de la ventana no es un fallo del
    // sistema: es lo que un OPO registra como no-respuesta y sigue adelante.
    // `TIMEOUT` queda reservado para el caso en que sí hubo conversación y
    // fuimos nosotros los que nos quedamos colgados — que es lo que M5 mide.
    if (this.carril.t_primeraRespuesta === null) {
      const ev = this.#d.registro.emitir(this.actor, E.CARRIL_RESPUESTA_RECIBIDA, {
        carrilId: this.carril.id,
        centroId: this.#centro.id,
        decision: "rechazo",
        prosa: "No response within the offer window.",
        latencia_s: this.#d.politica.T_TIMEOUT_CARRIL_s,
        reglaDura: "sin respuesta dentro de la ventana",
      });
      this.carril.respuestaCruda = "No response within the offer window.";
      this.#guion = { ...this.#guion, prosaRespuesta: "No response within the offer window." };
      return this.#rechazar("NO_REASON_GIVEN", ev.id);
    }

    this.#d.registro.emitir(this.actor, E.CARRIL_TIMEOUT, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      estadoAlExpirar: this.carril.estado,
    });
    this.#cerrar("TIMEOUT");
  }

  // ------------------------------------------------------------- utilidades

  #cerrar(estado: EstadoCarril): void {
    if (this.#terminado) return;
    this.#terminado = true;
    this.#transicion(estado);
    this.carril.t_cerrado = this.#d.reloj.now();
    for (const cancelar of this.#cancelaciones) cancelar();
    this.#cancelaciones = [];
    if (this.#slotTomado) this.#d.motor.liberarSlotCompromiso(this.carril.id);
    this.#d.motor.cancelar(this.carril.id);
    this.#span?.fin({ resultado: estado === "TIMEOUT" ? "timeout" : "ok", estadoFinal: estado });
    this.#alTerminar({
      carril: this.carril,
      horasProtegidas: estado === "DEGRADADO" ? this.#d.politica.HORAS_SALVADAS_POR_DEGRADACION : 0,
    });
  }

  #transicion(estado: EstadoCarril): void {
    const anterior = this.carril.estado;
    this.carril.estado = estado;
    // G8: ninguna transición sin evento.
    this.#d.registro.emitir(this.actor, E.CARRIL_ESTADO, {
      carrilId: this.carril.id,
      centroId: this.#centro.id,
      secuencia: this.carril.entradaMatchRun.secuencia,
      anterior,
      estado,
    });
  }

  #esTerminal(): boolean {
    return this.#terminado;
  }

  /**
   * Suelta el timeout duro del carril.
   *
   * Los dos plazos no pueden correr a la vez. `T_TIMEOUT_CARRIL` se cuenta
   * desde que se abre el carril y `T_VERIFICACION` desde que arranca la
   * verificación, así que un centro que contesta tarde entra a verificar con el
   * timeout duro ya casi vencido: este lo mataba a media verificación y el
   * carril moría en `TIMEOUT` en vez de resolverse en `COMPROMETIDO` o
   * `DEGRADADO`. Perdíamos justo la transición que justifica el producto.
   *
   * A partir de que hay una respuesta con la que trabajar, el carril queda
   * gobernado por el plazo de verificación, y mientras espera turno en la cola
   * de compromiso lo gobierna el cierre de campaña, que lo aborta. Ningún
   * camino queda sin plazo.
   */
  #cederElMando(): void {
    this.#cancelarTimeoutDuro?.();
    this.#cancelarTimeoutDuro = null;
  }

  #agendar(segundos: number, fn: () => void): void {
    this.#agendarCancelable(segundos, fn);
  }

  #agendarCancelable(segundos: number, fn: () => void): () => void {
    const cancelar = this.#d.reloj.schedule(segundos, fn);
    this.#cancelaciones.push(cancelar);
    return cancelar;
  }

  #hablar(hablante: Turno["hablante"], texto: string): void {
    this.carril.transcripcion.push({ t_sim: this.#d.reloj.now(), hablante, texto });
  }

  #citar(cita: Cita): void {
    this.carril.citas.push(cita);
  }

  /** §8.3 paso 1 — datos mínimos, todos provenientes del registro del donante. */
  #textoOferta(): string {
    const o = this.#oferta;
    const partes = [
      `Offer for sequence #${o.secuencia}:`,
      `${etiquetaOrgano(o.tipo)}, ${o.via} donor, age ${o.edad}, blood type ${o.grupoSanguineo}.`,
      o.kdpi !== null ? `KDPI ${(o.kdpi * 100).toFixed(0)}%.` : "",
      `Serologies: HCV ${si(o.serologias.hcv)}, HBV ${si(o.serologias.hbv)}, HIV ${si(o.serologias.hiv)}, CMV ${si(o.serologias.cmv)}.`,
      o.biopsiaRealizada ? "Biopsy done." : "No biopsy on file.",
      `Cold time now ${o.citActual_h.toFixed(1)} h, projected ${o.citProyectadaAlImplante_h.toFixed(1)} h at implant in your center.`,
    ];
    return partes.filter(Boolean).join(" ");
  }
}

export const PREGUNTAS_COMPROMISO = [
  "Which surgeon will do it?",
  "Which OR and at what time?",
  "Is the recipient confirmed and available right now?",
  "What time does your recovery team land?",
];

export function camposFaltantes(c: CompromisoVerificado): CampoCompromiso[] {
  const out: CampoCompromiso[] = [];
  if (c.cirujanoNombrado === null) out.push("cirujanoNombrado");
  if (c.quirofanoReservado === null) out.push("quirofanoReservado");
  if (c.receptorConfirmadoDisponible !== true) out.push("receptorConfirmadoDisponible");
  if (c.etaEquipoRecuperacion === null) out.push("etaEquipoRecuperacion");
  return out;
}

function si(v: boolean): string {
  return v ? "positive" : "negative";
}

export function etiquetaOrgano(tipo: string): string {
  return (
    {
      rinon_izq: "left kidney",
      rinon_der: "right kidney",
      higado: "liver",
      corazon: "heart",
      pulmon_izq: "left lung",
      pulmon_der: "right lung",
      pancreas: "pancreas",
    }[tipo] ?? tipo
  );
}
