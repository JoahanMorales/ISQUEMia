#!/usr/bin/env python3
"""ISQUEMIA - la caja. Programa principal del dispositivo de a bordo.

La Jetson hace de caja de transporte de organos: monitorea el estado del
organo durante el trayecto, lo muestra en la LCD, y al llegar identifica al
receptor con la camara antes de liberar el pestillo.

Uso tipico:
    python3 -m caja.app --organo rinon_izq --llegada 25
    python3 -m caja.app --organo corazon --factor 300 --llegada 15

Durante la corrida:
    ENTER  fuerza la llegada a destino (util si la demo va con prisa)
    Ctrl+C cierra todo dejando la caja sellada y el reloj congelado

Hilos:
    sensores  lee el banco cada segundo y evalua excepciones
    pantalla  rota el carrusel de la LCD
    vision    solo se enciende al llegar a destino; antes la camara esta apagada
    principal la maquina de estados

Todo lo que pasa se escribe en eventos.jsonl. Ese archivo es la auditoria:
si no esta ahi, no ocurrio.
"""
import argparse
import os
import sys
import threading
import time

from . import config
from .custodia import Custodia
from .eventos import BusEventos
from .lcd1602 import LCD1602
from .reloj_isquemia import RelojIsquemia
from .sensores import BancoSensores
from .servo_caja import PestilloCaja


class CajaISQUEMIA:
    def __init__(self, args):
        self.args = args
        self.corriendo = True
        self.indice_carrusel = 0

        print("=" * 52)
        print("  ISQUEMIA - caja de transporte de organos")
        print("  DATOS SINTETICOS - NO CLINICOS")
        print("=" * 52)

        self.bus = BusEventos()
        self.lcd = LCD1602()
        self.lcd.mostrar("ISQUEMIA", "INICIANDO...")

        self.reloj = RelojIsquemia(args.organo, factor=args.factor, bus=self.bus)
        self.sensores = BancoSensores(bus=self.bus, semilla=args.semilla)
        self.pestillo = PestilloCaja(bus=self.bus)

        self.caso = {
            "id": args.caso,
            "organo": args.organo,
            "origen": args.origen,
            "destino": args.destino,
            "receptor": args.receptor,
        }
        self.custodia = Custodia(self.caso, self.reloj, bus=self.bus)

        # La camara se construye tarde: no tiene por que estar encendida
        # mientras la caja viaja, y encenderla consume energia y calienta.
        self.camara = None
        self.identificador = None

        self.bus.emitir("CAJA_INICIADA", {
            "caso": self.caso,
            "organo": args.organo,
            "citLimiteHoras": self.reloj.limite_h,
            "factorTiempo": args.factor,
            "lcd": self.lcd.modo,
            "servosReales": self.pestillo.real,
        })
        print("\n  caso %s | %s | limite %.0f h | factor %gx"
              % (args.caso, args.organo, self.reloj.limite_h, args.factor))
        print("  LCD: %s | servos: %s\n"
              % (self.lcd.modo, "PCA9685" if self.pestillo.real else "simulados"))

    # --- hilos ------------------------------------------------------------
    def hilo_sensores(self):
        while self.corriendo:
            try:
                lectura = self.sensores.leer_todo()
                self.custodia.ultima_lectura = lectura
                self.custodia.excepciones = self.sensores.revisar(lectura)
                self.reloj.revisar_alertas()
                if not self.reloj.viable and self.custodia.estado not in ("ABIERTA", "VENCIDA"):
                    self.custodia.transicionar("VENCIDA")
            except Exception as e:
                print("[sensores] error en el ciclo:", e)
            time.sleep(1.0)

    def hilo_pantalla(self):
        ultimo_cambio = 0.0
        while self.corriendo:
            try:
                ahora = time.time()
                if ahora - ultimo_cambio >= config.LCD_SEGUNDOS_POR_PANTALLA:
                    self.indice_carrusel += 1
                    ultimo_cambio = ahora
                l1, l2 = self.custodia.pantalla_actual(self.indice_carrusel)
                self.lcd.mostrar(l1, l2)
            except Exception as e:
                print("[lcd] error:", e)
            time.sleep(0.25)

    def hilo_vision(self):
        """Se enciende al llegar a destino y solo entonces."""
        from .face_id import Camara, IdentificadorReceptor

        try:
            self.identificador = IdentificadorReceptor(bus=self.bus)
            self.camara = Camara()
            self.bus.emitir("CAMARA_ENCENDIDA",
                            {"origen": self.camara.origen,
                             "modo": self.identificador.modo})
            print("[vision] camara %s, modo %s"
                  % (self.camara.origen, self.identificador.modo))
        except Exception as e:
            print("[vision] no se pudo iniciar:", e)
            self.bus.emitir("CAMARA_FALLO", {"error": str(e)})
            return

        while self.corriendo and self.custodia.estado not in ("ABIERTA", "VENCIDA"):
            frame = self.camara.leer()
            if frame is None:
                time.sleep(0.05)
                continue

            ident = self.identificador.identificar(frame)
            self.custodia.identificacion = ident

            if ident.caja and self.custodia.estado == "EN_DESTINO":
                self.custodia.transicionar("IDENTIFICANDO",
                                           {"puntaje": ident.puntaje})

            if ident.autorizado:
                self._autorizar(ident)
                break

            # Cara presente pero sin coincidir: es un intento fallido real,
            # no ruido. Solo cuenta si el modo es verificacion.
            if (ident.caja and ident.motivo and "no coincide" in ident.motivo
                    and self.custodia.estado == "IDENTIFICANDO"):
                self.custodia.intentos_fallidos += 1
                self.custodia.transicionar("DENEGADA")
                self.pestillo.denegar(ident.motivo)
                time.sleep(2.0)
                self.custodia.transicionar("EN_DESTINO")
                self.identificador.reiniciar()

            time.sleep(0.08)

        if self.camara:
            self.camara.cerrar()
            self.bus.emitir("CAMARA_APAGADA", {})

    # --- acciones ---------------------------------------------------------
    def _autorizar(self, ident):
        self.custodia.transicionar("AUTORIZADA", {
            "modo": ident.modo, "puntaje": ident.puntaje,
            "nombre": ident.nombre,
        })
        self.lcd.mostrar("RECEPTOR OK", (ident.nombre or "RECEPTOR")[:16])
        self.lcd.parpadear_luz(2)
        time.sleep(0.4)

        self.lcd.mostrar("ABRIENDO CAJA", "")
        for i in range(17):
            self.lcd.barra(i / 16.0, fila=1)
            time.sleep(0.04)

        if self.pestillo.abrir(ident, organo=self.caso["organo"]):
            self.reloj.congelar()
            self.custodia.transicionar("ABIERTA")
            print("\n  >> CUSTODIA TRASPASADA a %s (%s, puntaje %s)"
                  % (ident.nombre, ident.modo, ident.puntaje))
            print("  >> CIT final: %s de %0.0f h\n"
                  % (self.reloj.texto_transcurrido(), self.reloj.limite_h))
        else:
            self.custodia.transicionar("DENEGADA")

    def _hilo_tecla(self):
        """ENTER fuerza la llegada. Sin esto la demo depende del cronometro."""
        try:
            for _ in sys.stdin:
                if self.custodia.estado == "EN_TRANSITO":
                    print("  [llegada forzada por el operador]")
                    self._llegar()
                    break
        except Exception:
            pass

    def _llegar(self):
        if self.custodia.estado != "EN_TRANSITO":
            return
        self.custodia.transicionar("EN_DESTINO",
                                   {"destino": self.caso["destino"]})
        threading.Thread(target=self.hilo_vision, daemon=True).start()

    # --- corrida ----------------------------------------------------------
    def correr(self):
        hilos = [
            threading.Thread(target=self.hilo_sensores, daemon=True),
            threading.Thread(target=self.hilo_pantalla, daemon=True),
        ]
        for h in hilos:
            h.start()
        if sys.stdin.isatty():
            threading.Thread(target=self._hilo_tecla, daemon=True).start()

        time.sleep(1.5)
        self.custodia.transicionar("EN_TRANSITO", {"origen": self.caso["origen"]})
        print("  en transito. ENTER para forzar la llegada"
              " (automatica en %ds)\n" % self.args.llegada)

        t_salida = time.time()
        try:
            while self.corriendo:
                if (self.custodia.estado == "EN_TRANSITO"
                        and time.time() - t_salida >= self.args.llegada):
                    self._llegar()
                if self.custodia.estado == "ABIERTA":
                    time.sleep(6)   # deja el mensaje final visible en la LCD
                    break
                if self.custodia.estado == "VENCIDA":
                    print("\n  >> CIT EXCEDIDO: el organo dejo de ser viable\n")
                    time.sleep(4)
                    break
                time.sleep(0.2)
        except KeyboardInterrupt:
            print("\n  interrumpido por el operador")
        finally:
            self.cerrar()

    def cerrar(self):
        self.corriendo = False
        self.reloj.congelar()
        self.bus.emitir("CAJA_APAGADA", self.custodia.resumen())
        time.sleep(0.4)
        try:
            self.lcd.mostrar("ISQUEMIA", "FIN DE CORRIDA")
            time.sleep(1.2)
            self.lcd.cerrar()
        except Exception:
            pass
        self.pestillo.liberar()
        print("  eventos en %s (%d registrados)"
              % (self.bus.archivo, len(self.bus.leer())))


def main():
    p = argparse.ArgumentParser(description="ISQUEMIA - caja de transporte")
    p.add_argument("--organo", default="rinon_izq", choices=list(config.CIT_LIMITE_H))
    p.add_argument("--caso", default="SYN-0912")
    p.add_argument("--origen", default="GDL-HG")
    p.add_argument("--destino", default="CDMX-C14")
    p.add_argument("--receptor", default="RX-0912")
    p.add_argument("--factor", type=float, default=config.FACTOR_TIEMPO,
                   help="aceleracion del reloj de isquemia (60 = 1 min real es 1 h)")
    p.add_argument("--llegada", type=int, default=25,
                   help="segundos reales hasta llegar a destino")
    p.add_argument("--semilla", type=int, default=config.SEMILLA)
    p.add_argument("--lcd", default=None, choices=["auto", "i2c", "gpio", "sim"])
    args = p.parse_args()

    if args.lcd:
        config.LCD_BACKEND = args.lcd
    config.FACTOR_TIEMPO = args.factor
    config.SEMILLA = args.semilla

    CajaISQUEMIA(args).correr()


if __name__ == "__main__":
    main()
