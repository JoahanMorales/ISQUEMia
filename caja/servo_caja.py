#!/usr/bin/env python3
"""Pestillo y tapa de la caja, sobre el PCA9685 ya montado (i2c-7, 0x40).

Dos servos:
  canal 0 -> pestillo: el seguro que impide levantar la tapa
  canal 1 -> tapa:     el brazo que la levanta

Regla de la caja (ISQUEMIA.md 13.2): el pestillo SOLO cede tras un traspaso
verificado, y cada apertura queda como evento de custodia autenticado. El
metodo abrir() no acepta un booleano: exige el resultado de identificacion
completo, para que sea imposible abrirla "por error" desde otro modulo.
"""
import time

from . import config


class PestilloCaja:
    def __init__(self, bus=None):
        self.bus = bus
        self.real = False
        self.abierta = False
        try:
            from adafruit_servokit import ServoKit
            self.kit = ServoKit(channels=16, address=config.SERVO_I2C_DIR)
            for canal in (config.SERVO_CANAL_PESTILLO, config.SERVO_CANAL_TAPA):
                self.kit.servo[canal].set_pulse_width_range(*config.SERVO_PULSO_US)
            self.real = True
            print("[servos] PCA9685 activo en 0x%02X" % config.SERVO_I2C_DIR)
        except Exception as e:
            self.kit = None
            print("[servos] sin hardware, movimientos simulados: %s" % e)

        self._angulos = {config.SERVO_CANAL_PESTILLO: config.SERVO_ANG_CERRADO,
                         config.SERVO_CANAL_TAPA: config.SERVO_ANG_TAPA_ABAJO}
        self.cerrar(silencioso=True)

    # --- movimiento -------------------------------------------------------
    def _mover(self, canal, destino, suave=True):
        """Rampa a velocidad constante: un servo de golpe brinca y hace ruido."""
        origen = self._angulos.get(canal, destino)
        destino = max(0, min(180, int(destino)))
        if not suave or origen == destino:
            self._escribir(canal, destino)
            return
        paso = 2 if destino > origen else -2
        espera = 2.0 / config.SERVO_VELOCIDAD_GRADOS_S
        for ang in range(int(origen), int(destino), paso):
            self._escribir(canal, ang)
            time.sleep(espera)
        self._escribir(canal, destino)

    def _escribir(self, canal, angulo):
        self._angulos[canal] = angulo
        if self.real:
            try:
                self.kit.servo[canal].angle = angulo
            except Exception as e:
                print("[servos] error en canal %d: %s" % (canal, e))
                self.real = False

    # --- API de custodia --------------------------------------------------
    def abrir(self, identificacion, organo=None):
        """Libera el pestillo y levanta la tapa.

        Exige un ResultadoIdentificacion autorizado. Si llega cualquier otra
        cosa, no abre y lo registra: un pestillo que se puede abrir pasandole
        True no es un pestillo.
        """
        if identificacion is None or not getattr(identificacion, "autorizado", False):
            self._evento("APERTURA_DENEGADA", {
                "motivo": getattr(identificacion, "motivo", "sin identificacion"),
                "modo": getattr(identificacion, "modo", None),
            })
            return False

        self._mover(config.SERVO_CANAL_PESTILLO, config.SERVO_ANG_ABIERTO)
        time.sleep(0.25)
        self._mover(config.SERVO_CANAL_TAPA, config.SERVO_ANG_TAPA_ARRIBA)
        self.abierta = True

        self._evento("CUSTODIA_TRASPASADA", {
            "deQuien": "caja:%s" % (organo or "organo"),
            "aQuien": identificacion.nombre or identificacion.identificador or "receptor",
            "metodoVerificacion": identificacion.modo,
            "puntaje": identificacion.puntaje,
            "servoReal": self.real,
        })
        return True

    def cerrar(self, silencioso=False):
        self._mover(config.SERVO_CANAL_TAPA, config.SERVO_ANG_TAPA_ABAJO)
        time.sleep(0.2)
        self._mover(config.SERVO_CANAL_PESTILLO, config.SERVO_ANG_CERRADO)
        self.abierta = False
        if not silencioso:
            self._evento("CAJA_SELLADA", {"servoReal": self.real})

    def denegar(self, motivo):
        """Gesto fisico de rechazo: el pestillo se tensa y vuelve. No abre."""
        for _ in range(2):
            self._mover(config.SERVO_CANAL_PESTILLO,
                        config.SERVO_ANG_CERRADO + 12, suave=False)
            time.sleep(0.12)
            self._mover(config.SERVO_CANAL_PESTILLO,
                        config.SERVO_ANG_CERRADO, suave=False)
            time.sleep(0.12)
        self._evento("APERTURA_DENEGADA", {"motivo": motivo})

    def _evento(self, tipo, payload):
        if self.bus:
            self.bus.emitir(tipo, payload, actor="caja:pestillo")
        else:
            print("[servos] %s %s" % (tipo, payload))

    def liberar(self):
        if self.real:
            try:
                for canal in (config.SERVO_CANAL_PESTILLO, config.SERVO_CANAL_TAPA):
                    self.kit.servo[canal].angle = None   # deja de dar par
            except Exception:
                pass
