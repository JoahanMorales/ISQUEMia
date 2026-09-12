/**
 * La corrida completa: los tres relojes en una sola línea de tiempo.
 *
 * reloj 1 · Centinela detecta el criterio y emite el referral
 * reloj 2 · Despachador abre 40 carriles y la línea base corre en paralelo
 * reloj 3 · Ruta puntúa el transporte del centro ganador
 *
 * Todo corre en tiempo de simulación. Nada aquí lee la hora del sistema.
 */

import type { Politica } from "../domain/politica";
import type {
  AlmacenEventos,
  MotorCarriles,
  Observabilidad,
  Reloj,
  RouterModelos,
  Workspace,
} from "../domain/puertos";
import type { Registrador } from "../domain/registro";
import type {
  Actor,
  Carril,
  Cita,
  CriterioDetectado,
  Escalamiento,
  EstadoCaso,
  ExpedienteAOOS,
  NueveMetricas,
} from "../domain/tipos";
import type { Mundo } from "../sim/mundo";
import type { PacienteUci } from "../sim/generadores";
import { evaluarPaciente, medirDesempeno, vigilar, type DesempenoCentinela } from "./centinela";
import { Despachador, type ResultadoCampana } from "./despachador";
import { construirExpediente } from "./escribano";
import { E } from "./eventos";
import { LineaBaseSerial, type EstadoBaseline, type ResultadoBaseline } from "./linea-base";
import { calcularMetricas } from "./metricas";
import { solicitarPlan, type OpcionTransporteExt } from "./ruta";

export interface PuertosCorrida {
  reloj: Reloj;
  almacen: AlmacenEventos;
  registro: Registrador;
  motor: MotorCarriles;
  obs: Observabilidad;
  workspace: Workspace;
  politica: Politica;
  modelos: RouterModelos;
  triage: import("./carril").DepsCarril["triage"];
}

export type FaseCorrida =
  | "inactiva"
  | "vigilancia"
  | "referral"
  | "autorizacion"
  | "recuperacion"
  | "colocacion"
  | "transporte"
  | "expediente"
  | "terminada";

export interface ResultadoCorrida {
  campana: ResultadoCampana;
  baseline: ResultadoBaseline;
  transporte: OpcionTransporteExt[] | null;
  expediente: ExpedienteAOOS | null;
  metricas: NueveMetricas;
  desempenoCentinela: DesempenoCentinela;
}

/** Retrasos del caso, en segundos sim. Fijos: forman parte de la reproducibilidad. */
export const TIEMPOS_CASO = {
  vigilanciaHastaTrigger_s: 15 * 60,
  triggerHastaReferral_s: 8 * 60,
  referralHastaAutorizacion_s: 95 * 60,
  autorizacionHastaCrossClamp_s: 70 * 60,
};

export class CorridaIsquemia {
  fase: FaseCorrida = "inactiva";
  estadoCaso: EstadoCaso = "DETECTADO";
  criterios: CriterioDetectado[] = [];
  escalamientos: Escalamiento[] = [];
  pacienteProtagonista: PacienteUci | null = null;
  desempenoCentinela: DesempenoCentinela | null = null;
  transporte: OpcionTransporteExt[] | null = null;
  expediente: ExpedienteAOOS | null = null;
  resultadoCampana: ResultadoCampana | null = null;
  resultadoBaseline: ResultadoBaseline | null = null;
  metricas: NueveMetricas | null = null;

  readonly despachador: Despachador;
  readonly lineaBase: LineaBaseSerial;

  #p: PuertosCorrida;
  #mundo: Mundo;
  #umbralesEmitidos = new Set<number>();
  #t_aperturaCampana = 0;
  #alTerminar: ((r: ResultadoCorrida) => void) | null = null;
  #cancelarAlertas: (() => void) | null = null;

  constructor(mundo: Mundo, puertos: PuertosCorrida) {
    this.#mundo = mundo;
    this.#p = puertos;
    this.despachador = new Despachador({
      mundo,
      reloj: puertos.reloj,
      registro: puertos.registro,
      motor: puertos.motor,
      obs: puertos.obs,
      politica: puertos.politica,
      modelos: puertos.modelos,
      triage: puertos.triage,
    });
    this.lineaBase = new LineaBaseSerial({
      mundo,
      reloj: puertos.reloj,
      registro: puertos.registro,
      politica: puertos.politica,
    });
  }

  get mundo(): Mundo {
    return this.#mundo;
  }

  get estadoBaseline(): EstadoBaseline {
    return this.lineaBase.estado;
  }

  get carriles(): Carril[] {
    return [...this.despachador.ejecutores.values()].map((e) => e.carril);
  }

  /** CIT transcurrida, derivada del reloj. Nunca almacenada (§6.2). */
  cit_h(): number {
    return this.#mundo.citTranscurrido_h();
  }

  citFraccion(): number {
    const limite = this.#mundo.citLimite_h();
    return limite > 0 ? Math.min(1, this.cit_h() / limite) : 0;
  }

  iniciar(alTerminar?: (r: ResultadoCorrida) => void): void {
    this.#alTerminar = alTerminar ?? null;
    const { registro, reloj } = this.#p;

    registro.emitir("simulador", E.CORRIDA_INICIADA, {
      semilla: this.#mundo.semilla,
      organo: this.#mundo.organo.tipo,
      citLimite_h: this.#mundo.citLimite_h(),
      donante: this.#mundo.donante.id,
      centros: this.#mundo.centros.length,
      matchRun: this.#mundo.matchRun.entradas.length,
    });

    this.#fase("vigilancia");
    reloj.schedule(TIEMPOS_CASO.vigilanciaHastaTrigger_s, () => this.#vigilar());
  }

  // ------------------------------------------------------------- reloj 1

  #vigilar(): void {
    const { registro, reloj } = this.#p;

    // El Centinela corre sobre el conjunto completo: así el panel puede
    // mostrar su desempeño medido (§8.1 criterio de aceptación) y no una
    // afirmación sin respaldo.
    const evaluaciones = this.#mundo.uci.map((p) => evaluarPaciente(p, reloj.now()));
    this.desempenoCentinela = medirDesempeno(this.#mundo.uci, evaluaciones);

    // El protagonista es el primer positivo claro: es el caso que se demuestra.
    const idx = this.#mundo.uci.findIndex((p) => p.clase === "positivo_claro");
    this.pacienteProtagonista = this.#mundo.uci[idx]!;
    const evalua = vigilar([this.pacienteProtagonista], reloj.now(), registro)[0]!;

    this.criterios = evalua.referral?.criterios ?? [];
    if (evalua.escalamiento) this.escalamientos.push(evalua.escalamiento);

    // G7: los limítrofes del conjunto también producen escalamiento visible.
    for (const ev of evaluaciones) {
      if (ev.escalamiento && ev.pacienteId !== this.pacienteProtagonista.id) {
        this.escalamientos.push(ev.escalamiento);
      }
    }

    this.#mundo.donante.t_trigger = reloj.now();
    this.#transicionCaso("REFERIDO");
    this.#fase("referral");

    // Reloj 1 aterriza en manos humanas: correo al OPO con la cita del criterio.
    if (evalua.referral) {
      const citas = evalua.referral.criterios.map((c) => c.cita);
      this.#publicar(
        this.#p.workspace.enviarCorreo({
          para: "opo-coordinator@isquemiaagent-workspace.ambi.cc",
          asunto: `Referral — ${this.pacienteProtagonista.id} · ${evalua.referral.urgencia}`,
          cuerpo: [
            `A clinical trigger was detected for **${this.pacienteProtagonista.id}** (synthetic).`,
            "",
            "Criteria, each with the exact text that fired it:",
            ...citas.map((c) => `- **${c.afirmacion}**\n  > “${c.literal}” \`${c.referencia}\``),
            "",
            `Confidence ${evalua.referral.confianza.toFixed(2)}. Contractual notification window: ${evalua.referral.ventanaMinutos} min.`,
            "",
            "_No prognosis and no determination of death is made by this system. Synthetic data only._",
          ].join("\n"),
          autor: "centinela",
        }),
      );
      this.#anunciar(
        `Referral issued for ${this.pacienteProtagonista.id} — ${evalua.referral.criterios.map((c) => c.tipo).join(", ")}.`,
        citas,
        "centinela",
      );
    }

    // G7: cada escalamiento se convierte en una tarea asignada, no en un aviso.
    for (const esc of this.escalamientos.slice(0, 3)) {
      this.#publicar(
        this.#p.workspace.crearTarea({
          titulo: `Escalation — ${esc.contexto.pacienteId ?? esc.id}`,
          cuerpo: `${esc.motivo}\n\nContext: ${JSON.stringify(esc.contexto)}`,
          asignadoA: "on-call coordinator",
          prioridad: "alta",
          autor: "centinela",
        }),
      );
    }

    reloj.schedule(TIEMPOS_CASO.triggerHastaReferral_s, () => {
      this.#mundo.donante.t_referral = reloj.now();
      this.#fase("autorizacion");
      this.#transicionCaso("EVALUANDO");
      reloj.schedule(TIEMPOS_CASO.referralHastaAutorizacion_s, () => this.#autorizar());
    });
  }

  #autorizar(): void {
    const { registro, reloj } = this.#p;
    this.#mundo.donante.t_autorizacion = reloj.now();
    registro.emitir("simulador", E.AUTORIZACION_OBTENIDA, { donanteId: this.#mundo.donante.id });
    this.#transicionCaso("AUTORIZADO");
    this.#fase("recuperacion");

    if (this.#mundo.donante.via === "DCD") {
      this.#retirarSoporte();
    } else {
      reloj.schedule(TIEMPOS_CASO.autorizacionHastaCrossClamp_s, () => this.#crossClamp());
    }
  }

  /** §7.1 rama DCD — `VENTANA_EXPIRADA` debe estar implementada y lo está. */
  #retirarSoporte(): void {
    const { registro, reloj } = this.#p;
    const d = this.#mundo.donante;
    d.t_retiroSoporte = reloj.now();
    registro.emitir("simulador", E.SOPORTE_RETIRADO, { donanteId: d.id, ventana_min: d.ventanaDCD_min });
    this.#transicionCaso("SOPORTE_RETIRADO");

    const azar = this.#mundo.azar.derivar("dcd");
    const ventana_s = (d.ventanaDCD_min ?? 90) * 60;
    // Con la ventana real, el paro puede no ocurrir a tiempo: eso es el caso
    // que hace creíble la demo ante alguien que conoce el dominio.
    const tiempoAlParo_s = azar.logNormal(Math.log(ventana_s * 0.55), 0.75);

    if (tiempoAlParo_s > ventana_s) {
      reloj.schedule(ventana_s, () => {
        registro.emitir("simulador", E.VENTANA_DCD_EXPIRADA, {
          donanteId: d.id,
          ventana_min: d.ventanaDCD_min,
          motivo: "no hubo paro circulatorio dentro de la ventana",
        });
        this.#transicionCaso("VENTANA_EXPIRADA");
        this.#transicionCaso("SIN_DONACION");
        this.#fase("terminada");
        this.#terminarSinColocacion();
      });
      return;
    }

    reloj.schedule(tiempoAlParo_s, () => {
      d.t_paro = reloj.now();
      this.#transicionCaso("NO_TOUCH_5MIN");
      reloj.schedule(5 * 60, () => this.#crossClamp());
    });
  }

  #crossClamp(): void {
    const { registro, reloj } = this.#p;
    const t = reloj.now();
    this.#mundo.donante.t_crossClamp = t;
    this.#mundo.organo.t_crossClamp = t;
    this.#mundo.organo.estado = "EN_ISQUEMIA_FRIO";

    registro.emitir("simulador", E.CROSS_CLAMP, {
      organoId: this.#mundo.organo.id,
      citLimite_h: this.#mundo.citLimite_h(),
      cit_h: 0,
    });
    registro.emitir("simulador", E.ORGANO_TRANSICION, {
      organoId: this.#mundo.organo.id,
      estado: "EN_ISQUEMIA_FRIO",
    });
    this.#transicionCaso("RECUPERADO");
    this.#anunciar(
      `Cross clamp. Cold ischemia limit ${this.#mundo.citLimite_h()} h for ${this.#mundo.organo.tipo}. Opening ${this.#p.politica.N_CARRILES} evaluation lanes, at most ${this.#p.politica.MAX_CONCURRENTES_POLITICA} verifying at once.`,
      [],
      "simulador",
    );
    this.#armarAlertasCit();
    this.#abrirColocacion();
  }

  /** §7.2 — temporizador de alertas al 50 %, 75 % y 90 % del límite. */
  #armarAlertasCit(): void {
    const { reloj, registro, politica } = this.#p;
    const limite_s = this.#mundo.citLimite_h() * 3600;
    for (const u of politica.UMBRAL_CIT_ALERTA) {
      const cancelar = reloj.schedule(limite_s * u, () => {
        if (this.#umbralesEmitidos.has(u)) return;
        this.#umbralesEmitidos.add(u);
        registro.emitir("simulador", E.ALERTA_CIT, {
          organoId: this.#mundo.organo.id,
          umbral: u,
          cit_h: Number(this.cit_h().toFixed(2)),
          citLimite_h: this.#mundo.citLimite_h(),
        });
        // Al cruzar un umbral, lo que ya no cabe se marca por LOG_CIT_TOO_LONG.
        this.despachador.marcarInviablesPorCit();
      });
      this.#cancelarAlertas = cancelar;
    }
  }

  get umbralCitAlcanzado(): number {
    return Math.max(0, ...[...this.#umbralesEmitidos]);
  }

  // ------------------------------------------------------------- reloj 2

  #abrirColocacion(): void {
    this.#fase("colocacion");
    this.#transicionCaso("ASIGNANDO");
    this.#t_aperturaCampana = this.#p.reloj.now();

    // La línea base arranca en el mismo instante, con la misma semilla y los
    // mismos perfiles. Es la única comparación honesta posible.
    this.lineaBase.arrancar((r) => {
      this.resultadoBaseline = r;
      this.#quizaTerminar();
    });

    this.despachador.abrir((r) => {
      this.resultadoCampana = r;
      this.#alCerrarCampana(r);
    });
  }

  #alCerrarCampana(r: ResultadoCampana): void {
    const { registro, reloj, workspace } = this.#p;

    // reloj 3
    if (r.ganador) {
      this.#fase("transporte");
      this.transporte = solicitarPlan(this.#mundo, registro, reloj, r.ganador.entradaMatchRun.centroId);
    }

    // expediente
    this.#fase("expediente");
    registro.emitir("escribano", E.EXPEDIENTE_SOLICITADO, { organoId: this.#mundo.organo.id });
    this.expediente = construirExpediente({
      mundo: this.#mundo,
      almacen: this.#p.almacen,
      registro,
      carriles: this.carriles,
      ganador: r.ganador,
      aoos: r.aoos,
    });

    // El expediente aterriza en manos humanas: Docs del workspace.
    this.#publicar(workspace.publicarExpediente(this.expediente, "escribano"));

    this.#quizaTerminar();
  }

  #terminarSinColocacion(): void {
    this.resultadoCampana ??= {
      carriles: [], ganador: null, secuenciaFinal: null, aoos: false,
      t_primerCompromiso: null, t_cierre: this.#p.reloj.now(), degradaciones: 0,
      provisionalYesTotales: 0, ofertasEmitidas: 0, horasProtegidas: 0, citFinal_h: null,
    };
    this.resultadoBaseline ??= {
      pasos: [], secuenciaFinal: null, t_colocacion: null, cit_h: null,
      ofertasEmitidas: 0, rechazosTardios: 0,
    };
    this.#quizaTerminar();
  }

  #quizaTerminar(): void {
    if (!this.resultadoCampana || !this.resultadoBaseline) return;
    if (this.fase === "terminada") return;
    this.#fase("terminada");
    this.#cancelarAlertas?.();

    this.metricas = calcularMetricas({
      campana: this.resultadoCampana,
      baseline: this.resultadoBaseline,
      carriles: this.carriles,
      spans: this.#p.obs.spans(),
      eventos: this.#p.almacen.todos(),
      expediente: this.expediente,
      citAgente_h: this.resultadoCampana.citFinal_h,
      t_aperturaCampana: this.#t_aperturaCampana,
    });

    this.#anunciar(
      this.resultadoCampana.ganador
        ? `Placed at match run sequence #${this.resultadoCampana.secuenciaFinal}. ` +
            `${this.resultadoCampana.degradaciones} of ${this.resultadoCampana.provisionalYesTotales} provisional acceptances were intercepted, ` +
            `protecting ${this.resultadoCampana.horasProtegidas.toFixed(1)} h. ` +
            `Serial baseline on the same seed: ${this.resultadoBaseline.secuenciaFinal !== null ? `#${this.resultadoBaseline.secuenciaFinal} after ${this.resultadoBaseline.ofertasEmitidas} offers` : "never placed"}.`
        : `Campaign closed without a verified commitment.`,
      [],
      "despachador",
    );

    this.#publicar(
      this.#p.workspace.escribirHoja({
        hoja: `ISQUEMIA metrics — seed ${this.#mundo.semilla}`,
        filas: [{ semilla: this.#mundo.semilla, ...this.metricas }],
        autor: "escribano",
      }),
    );

    this.#alTerminar?.({
      campana: this.resultadoCampana,
      baseline: this.resultadoBaseline,
      transporte: this.transporte,
      expediente: this.expediente,
      metricas: this.metricas,
      desempenoCentinela: this.desempenoCentinela!,
    });
  }

  // ------------------------------------------------------- workspace humano

  /**
   * Las escrituras al workspace son deliberadamente fire-and-forget: el reloj
   * de isquemia no espera a una API externa. Si fallan, el espejo local ya
   * quedó pintado y la degradación se emite como evento (G9).
   */
  #publicar(promesa: Promise<import("../domain/puertos").ItemWorkspace>, tipo = E.WORKSPACE_ESCRITO): void {
    void promesa
      .then((item) => {
        this.#p.registro.emitir("escribano", tipo, {
          app: item.app,
          titulo: item.titulo,
          url: item.url,
          remoto: item.meta.remoto === true,
        });
      })
      .catch(() => {
        // El adaptador ya emitió su propia degradación; aquí no se hace ruido.
      });
  }

  #anunciar(texto: string, citas: Cita[] = [], autor: Actor = "despachador"): void {
    this.#publicar(this.#p.workspace.publicarEnCanal({ canal: "isquemia-ops", texto, autor, citas }));
  }

  // ------------------------------------------------------------- utilidades

  #fase(f: FaseCorrida): void {
    this.fase = f;
  }

  #transicionCaso(estado: EstadoCaso): void {
    const anterior = this.estadoCaso;
    this.estadoCaso = estado;
    this.#p.registro.emitir("simulador", E.CASO_TRANSICION, { anterior, estado });
  }
}
