#!/usr/bin/env python3
"""Pestillo y tapa de la caja, sobre el PCA9685 ya montado (i2c-7, 0x40).

Dos servos:
  canal 2 -> pestillo: el seguro que impide levantar la tapa
  canal 3 -> tapa:     el brazo que la levanta

Los canales 0 y 1 NO se tocan aqui: son el pan-tilt de la camara. Moverlos
como si fueran el pestillo la deja mirando al techo, ciega para identificar
al receptor. Para apuntarla esta la clase PanTiltCamara, mas abajo.

Regla de la caja (ISQUEMIA.md 13.2): el pestillo SOLO cede tras un traspaso
verificado, y cada apertura queda como evento de custodia autenticado. El
metodo abrir() no acepta un booleano: exige el resultado de identificacion
completo, para que sea imposible abrirla "por error" desde otro modulo.
"""
import time

from . import config


class _PCA9685:
    """Driver directo del PCA9685 por SMBus, sin Blinka.

    adafruit_servokit funciona, pero arrastra Blinka, que a su vez toma
    Jetson.GPIO y le fija un modo de numeracion. Si la LCD ya esta corriendo
    por GPIO, el segundo en llegar revienta con "A different mode has already
    been set!" y los servos se quedan sin moverse en plena demo.

    Hablarle al chip por I2C evita el choque: son cuatro registros.
    """

    MODE1 = 0x00
    PRESCALE = 0xFE
    LED0_ON_L = 0x06
    FRECUENCIA_HZ = 50           # estandar de servo: periodo de 20 ms

    def __init__(self, bus=None, direccion=None):
        from Adafruit_PureIO.smbus import SMBus

        self.direccion = direccion if direccion is not None else config.SERVO_I2C_DIR
        self.bus = SMBus(bus if bus is not None else config.I2C_BUS)
        self._configurar_frecuencia(self.FRECUENCIA_HZ)

    def _escribir(self, registro, valor):
        self.bus.write_byte_data(self.direccion, registro, valor & 0xFF)

    def _leer(self, registro):
        return self.bus.read_byte_data(self.direccion, registro)

    def _configurar_frecuencia(self, hz):
        prescale = int(round(25000000.0 / (4096 * hz)) - 1)
        anterior = self._leer(self.MODE1)
        self._escribir(self.MODE1, (anterior & 0x7F) | 0x10)   # dormir
        self._escribir(self.PRESCALE, prescale)
        self._escribir(self.MODE1, anterior)
        time.sleep(0.005)
        self._escribir(self.MODE1, anterior | 0xA0)            # reiniciar + autoincremento

    def pulso_us(self, canal, microsegundos):
        """Ancho de pulso en microsegundos sobre un periodo de 20 ms."""
        cuentas = int(round(microsegundos * 4096 / 20000.0))
        cuentas = max(0, min(4095, cuentas))
        base = self.LED0_ON_L + 4 * canal
        self._escribir(base, 0)
        self._escribir(base + 1, 0)
        self._escribir(base + 2, cuentas & 0xFF)
        self._escribir(base + 3, cuentas >> 8)

    def angulo(self, canal, grados, rango_us):
        minimo, maximo = rango_us
        grados = max(0, min(180, grados))
        self.pulso_us(canal, minimo + (grados / 180.0) * (maximo - minimo))

    def soltar(self, canal):
        """Deja de mandar pulso: el servo suelta el par y deja de zumbar."""
        base = self.LED0_ON_L + 4 * canal
        for i, v in enumerate((0, 0, 0, 0x10)):
            self._escribir(base + i, v)

    def cerrar(self):
        try:
            self.bus.close()
        except Exception:
            pass


class PestilloCaja:
    def __init__(self, bus=None):
        self.bus = bus
        self.real = False
        self.abierta = False
        try:
            self.pca = _PCA9685()
            self.real = True
            print("[servos] PCA9685 activo en 0x%02X (canales %d y %d)"
                  % (config.SERVO_I2C_DIR, config.SERVO_CANAL_PESTILLO,
                     config.SERVO_CANAL_TAPA))
        except Exception as e:
            self.pca = None
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
                rango = (config.SERVO_PULSO_PAN
                         if canal == config.SERVO_CANAL_PAN
                         else config.SERVO_PULSO_TILT
                         if canal == config.SERVO_CANAL_TILT
                         else config.SERVO_PULSO_US)
                self.pca.angulo(canal, angulo, rango)
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
                    self.pca.soltar(canal)
                self.pca.cerrar()
            except Exception:
                pass


class PanTiltCamara:
    """Los canales 0 y 1: orientan la camara, no abren nada.

    Se separa del pestillo a proposito. Al terminar cualquier corrida hay que
    llamar a reposo(): una camara que se queda apuntando al techo no falla
    ruidosamente, simplemente deja de ver, y eso cuesta encontrarlo.
    """

    def __init__(self):
        self.real = False
        try:
            self.pca = _PCA9685()
            self.real = True
        except Exception as e:
            self.pca = None
            print("[pantilt] sin hardware: %s" % e)

    def apuntar(self, pan=None, tilt=None):
        if not self.real:
            return
        if pan is not None:
            self.pca.angulo(config.SERVO_CANAL_PAN, int(pan), config.SERVO_PULSO_PAN)
        if tilt is not None:
            self.pca.angulo(config.SERVO_CANAL_TILT, int(tilt), config.SERVO_PULSO_TILT)

    def reposo(self):
        self.apuntar(config.SERVO_PAN_REPOSO, config.SERVO_TILT_REPOSO)
