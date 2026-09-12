#!/usr/bin/env python3
"""Sensores de la caja de transporte de organos.

CADA SENSOR TIENE DOS IMPLEMENTACIONES:

  - La real, que habla con el chip concreto que iria montado en la caja.
    El chip, su bus y su direccion estan escritos en la docstring de cada
    clase; comprar el sensor y conectarlo es todo lo que falta.
  - La simulada, determinista por semilla, que produce una serie coherente
    con la fisica del transporte hipotermico.

El sistema arranca preguntando a cada sensor si su hardware responde. Si no
responde, cae a la simulacion y lo registra como evento. Nunca miente sobre
cual de las dos esta usando: eso se ve en la LCD y queda en la auditoria.

INVENTARIO DE HARDWARE DE LA CAJA COMPLETA
-------------------------------------------------------------------------
  MONTADO Y FUNCIONANDO en este prototipo:
    - Camara CSI IMX219            -> identificacion del receptor
    - PCA9685 @ i2c-7 0x40         -> servos del pestillo y la tapa
    - LCD 1602A (PCF8574 @ 0x27)   -> panel de estado
  PENDIENTE DE MONTAR (simulado por ahora):
    - DS18B20    1-Wire            -> temperatura del organo (sonda sumergible)
    - SHT31-D    i2c 0x44          -> temperatura y humedad de la camara interna
    - BMP280     i2c 0x76          -> presion barometrica -> altitud de vuelo
    - MPU6050    i2c 0x68          -> acelerometro: golpes y volteo de la caja
    - BH1750     i2c 0x23          -> luz interior: delata que la tapa se abrio
    - Reed switch GPIO pin 7       -> sello magnetico de la tapa
    - INA219     i2c 0x41          -> voltaje, corriente y carga de bateria
    - NEO-6M     UART /dev/ttyTHS1 -> GPS: posicion y ETA
-------------------------------------------------------------------------
"""
import math
import os
import random
import time

from . import config


class Sensor:
    """Interfaz comun. Un sensor sabe leerse y sabe si su hardware existe."""

    nombre = "sensor"
    unidad = ""
    clave = "valor"

    def __init__(self, semilla=None):
        self.rng = random.Random((semilla or config.SEMILLA) ^ hash(self.nombre) & 0xFFFF)
        self.real = self._probar_hardware()
        self._t0 = time.time()

    def _probar_hardware(self):
        """Sobrescribir en cada sensor. True si el chip responde de verdad."""
        return False

    def _leer_real(self):
        raise NotImplementedError

    def _leer_simulado(self):
        raise NotImplementedError

    def leer(self):
        if self.real:
            try:
                return self._leer_real()
            except Exception as e:
                print("[sensores] %s fallo, paso a simulacion: %s" % (self.nombre, e))
                self.real = False
        return self._leer_simulado()

    @property
    def minutos(self):
        """Minutos de simulacion transcurridos, ya acelerados."""
        return ((time.time() - self._t0) * config.FACTOR_TIEMPO) / 60.0


# ---------------------------------------------------------------------------
def _hay_i2c(direccion, bus=None):
    """Devuelve True si algo contesta en esa direccion del bus."""
    try:
        from Adafruit_PureIO.smbus import SMBus
        b = SMBus(bus if bus is not None else config.I2C_BUS)
        try:
            b.write_byte(direccion, 0)
            return True
        finally:
            b.close()
    except Exception:
        return False


# ===========================================================================
# Temperatura del organo: EL SENSOR CRITICO
# ===========================================================================
class TemperaturaOrgano(Sensor):
    """DS18B20 en 1-Wire, sonda de acero sumergible en la solucion de perfusion.

    Conexion real: dato -> GPIO pin 7, con resistencia pull-up de 4.7k a 3.3V.
    El kernel lo expone en /sys/bus/w1/devices/28-*/w1_slave tras cargar los
    modulos w1-gpio y w1-therm.

    Es el sensor critico de la caja: fuera del rango 2-8 grados el organo se
    compromete, y la excursion termica es de las pocas cosas que el equipo
    puede corregir en ruta si se entera a tiempo.
    """

    nombre = "temp_organo"
    unidad = "C"
    clave = "temperatura"
    RUTA_1WIRE = "/sys/bus/w1/devices"

    def _probar_hardware(self):
        if not os.path.isdir(self.RUTA_1WIRE):
            return False
        self._dispositivo = None
        for d in os.listdir(self.RUTA_1WIRE):
            if d.startswith("28-"):
                self._dispositivo = os.path.join(self.RUTA_1WIRE, d, "w1_slave")
                return True
        return False

    def _leer_real(self):
        with open(self._dispositivo) as f:
            crudo = f.read()
        if "YES" not in crudo:
            raise IOError("CRC invalido del DS18B20")
        return round(int(crudo.split("t=")[-1]) / 1000.0, 2)

    def _leer_simulado(self):
        """Deriva lenta alrededor de 4 grados, con una excursion termica
        programada para que la demo tenga una excepcion real que mostrar."""
        m = self.minutos
        base = 4.0 + 0.6 * math.sin(m / 25.0)          # oscilacion del hielo
        deriva = min(1.2, m / 300.0)                    # el hielo se va gastando
        excursion = 0.0
        if 55.0 <= m <= 75.0:                           # falla del refrigerante
            excursion = 5.5 * math.sin(math.pi * (m - 55.0) / 20.0)
        ruido = self.rng.gauss(0, 0.08)
        return round(base + deriva + excursion + ruido, 2)


class TemperaturaAmbiente(Sensor):
    """SHT31-D en i2c 0x44. Temperatura del aire dentro de la caja, no del organo.

    La diferencia entre ambas delata que el aislamiento se rompio antes de que
    el organo alcance a calentarse: da margen de reaccion.
    """

    nombre = "temp_ambiente"
    unidad = "C"
    clave = "temperatura"
    DIR = 0x44

    def _probar_hardware(self):
        return _hay_i2c(self.DIR)

    def _leer_real(self):
        import adafruit_sht31d, board, busio
        s = adafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))
        return round(s.temperature, 2)

    def _leer_simulado(self):
        return round(8.5 + 1.5 * math.sin(self.minutos / 40.0) + self.rng.gauss(0, 0.2), 2)


class Humedad(Sensor):
    """SHT31-D en i2c 0x44 (mismo chip que la temperatura ambiente).

    Humedad alta dentro de la caja significa condensacion; condensacion sobre
    los contactos electricos es como se pierde la telemetria en pleno vuelo.
    """

    nombre = "humedad"
    unidad = "%"
    clave = "humedad"
    DIR = 0x44

    def _probar_hardware(self):
        return _hay_i2c(self.DIR)

    def _leer_real(self):
        import adafruit_sht31d, board, busio
        s = adafruit_sht31d.SHT31D(busio.I2C(board.SCL, board.SDA))
        return round(s.relative_humidity, 1)

    def _leer_simulado(self):
        return round(52.0 + 8.0 * math.sin(self.minutos / 33.0) + self.rng.gauss(0, 1.0), 1)


class PresionAltitud(Sensor):
    """BMP280 en i2c 0x76. Presion barometrica convertida a altitud.

    Sirve para dos cosas: saber si la caja va en avion sin depender del GPS, y
    detectar despresurizacion de bodega, que altera la solucion de perfusion.
    """

    nombre = "altitud"
    unidad = "m"
    clave = "altitud"
    DIR = 0x76

    def _probar_hardware(self):
        return _hay_i2c(self.DIR) or _hay_i2c(0x77)

    def _leer_real(self):
        import adafruit_bmp280, board, busio
        s = adafruit_bmp280.Adafruit_BMP280_I2C(busio.I2C(board.SCL, board.SDA))
        return round(s.altitude, 1)

    def _leer_simulado(self):
        """Perfil de vuelo: rodaje, ascenso, crucero, descenso."""
        m = self.minutos
        if m < 12:
            return round(420 + self.rng.gauss(0, 5), 1)
        if m < 25:
            return round(420 + (m - 12) * 720 + self.rng.gauss(0, 40), 1)
        if m < 70:
            return round(9800 + self.rng.gauss(0, 60), 1)
        return round(max(420, 9800 - (m - 70) * 640) + self.rng.gauss(0, 40), 1)


class Choque(Sensor):
    """MPU6050 en i2c 0x68. Aceleracion pico en g y orientacion de la caja.

    Un golpe por encima de 3 g es un evento reportable: el receptor tiene
    derecho a saber que la caja se cayo, y hoy esa informacion sencillamente
    no existe (HRSA documento que no hay visibilidad del organo en transito).
    """

    nombre = "choque"
    unidad = "g"
    clave = "g_pico"
    DIR = 0x68

    def _probar_hardware(self):
        return _hay_i2c(self.DIR)

    def _leer_real(self):
        import adafruit_mpu6050, board, busio
        s = adafruit_mpu6050.MPU6050(busio.I2C(board.SCL, board.SDA))
        x, y, z = s.acceleration
        return round(math.sqrt(x * x + y * y + z * z) / 9.81, 2)

    def _leer_simulado(self):
        """Reposo en 1 g, con dos golpes fuertes en el traspaso a la aeronave."""
        m = self.minutos
        base = 1.0 + abs(self.rng.gauss(0, 0.05))
        if 26.0 <= m <= 27.5 or 71.0 <= m <= 72.5:
            base += abs(self.rng.gauss(2.2, 0.7))
        return round(base, 2)


class LuzInterior(Sensor):
    """BH1750 en i2c 0x23. Luz dentro de la caja cerrada.

    Una caja sellada esta a oscuras. Si entra luz y nadie autorizo la apertura,
    eso es un SELLO_ALTERADO: es la prueba fisica de que alguien la abrio.
    """

    nombre = "luz"
    unidad = "lux"
    clave = "lux"
    DIR = 0x23

    def _probar_hardware(self):
        return _hay_i2c(self.DIR) or _hay_i2c(0x5C)

    def _leer_real(self):
        import adafruit_bh1750, board, busio
        s = adafruit_bh1750.BH1750(busio.I2C(board.SCL, board.SDA))
        return round(s.lux, 1)

    def _leer_simulado(self):
        return round(abs(self.rng.gauss(1.5, 0.8)), 1)


class SelloTapa(Sensor):
    """Reed switch magnetico en GPIO pin 7, con pull-up interno.

    Cerrado (LOW) = tapa asentada. Es redundante a proposito con la LuzInterior:
    un sensor se puede burlar con un iman, los dos a la vez ya cuesta trabajo.
    """

    nombre = "sello"
    unidad = ""
    clave = "cerrado"
    PIN = 7

    def _probar_hardware(self):
        # Un pin de entrada sin nada conectado flota y lee ruido, asi que no
        # hay forma de autodetectar el reed switch: se declara cuando ya esta
        # soldado, con ISQ_REED=1. Mejor simulado honesto que real inventado.
        if os.environ.get("ISQ_REED", "0") != "1":
            return False
        try:
            import Jetson.GPIO as GPIO
            GPIO.setmode(GPIO.BOARD)
            GPIO.setwarnings(False)
            GPIO.setup(self.PIN, GPIO.IN)
            self._GPIO = GPIO
            return True
        except Exception:
            return False

    def _leer_real(self):
        return self._GPIO.input(self.PIN) == self._GPIO.LOW

    def _leer_simulado(self):
        return True     # la caja va sellada hasta que la custodia la abre


class Bateria(Sensor):
    """INA219 en i2c 0x41. Voltaje, corriente y porcentaje de carga.

    La caja tiene que sobrevivir el vuelo entero sin enchufe. Si la bateria no
    alcanza para el trayecto restante, eso hay que saberlo en tierra.
    """

    nombre = "bateria"
    unidad = "%"
    clave = "porcentaje"
    DIR = 0x41

    def _probar_hardware(self):
        return _hay_i2c(self.DIR) or _hay_i2c(0x40 + 1)

    def _leer_real(self):
        import adafruit_ina219, board, busio
        s = adafruit_ina219.INA219(busio.I2C(board.SCL, board.SDA))
        v = s.bus_voltage
        return round(max(0.0, min(100.0, (v - 3.0) / (4.2 - 3.0) * 100.0)), 1)

    def _leer_simulado(self):
        nivel = 100.0 - self.minutos * 0.38 + self.rng.gauss(0, 0.3)
        return round(max(4.0, min(100.0, nivel)), 1)


class GPS(Sensor):
    """NEO-6M por UART en /dev/ttyTHS1 a 9600 baudios, sentencias NMEA.

    Da posicion y velocidad; con el destino fijo, el ETA. Es lo que permite
    contrastar el reloj de isquemia contra el tiempo que falta de viaje: la
    pregunta que importa no es que hora es, sino si va a llegar a tiempo.
    """

    nombre = "gps"
    unidad = ""
    clave = "posicion"
    PUERTO = "/dev/ttyTHS1"

    def _probar_hardware(self):
        # Existir no basta: en la Jetson el UART pertenece al grupo dialout.
        return os.path.exists(self.PUERTO) and os.access(self.PUERTO, os.R_OK)

    def _leer_real(self):
        import serial
        with serial.Serial(self.PUERTO, 9600, timeout=1) as s:
            for _ in range(20):
                linea = s.readline().decode("ascii", "ignore")
                if linea.startswith("$GPGGA"):
                    p = linea.split(",")
                    if p[2] and p[4]:
                        lat = (int(p[2][:2]) + float(p[2][2:]) / 60) * (1 if p[3] == "N" else -1)
                        lon = (int(p[4][:3]) + float(p[4][3:]) / 60) * (1 if p[5] == "E" else -1)
                        return {"lat": round(lat, 5), "lon": round(lon, 5), "fix": True}
        raise IOError("sin fix de GPS")

    def _leer_simulado(self):
        """Trayecto recto de Guadalajara a Ciudad de Mexico."""
        origen = (20.6597, -103.3496)
        destino = (19.4326, -99.1332)
        f = max(0.0, min(1.0, self.minutos / 95.0))
        return {
            "lat": round(origen[0] + (destino[0] - origen[0]) * f, 5),
            "lon": round(origen[1] + (destino[1] - origen[1]) * f, 5),
            "fix": True,
            "avance": round(f, 3),
        }


# ===========================================================================
class BancoSensores:
    """Lee todos los sensores de golpe y decide que amerita una excepcion."""

    def __init__(self, bus=None, semilla=None):
        self.bus = bus
        self.sensores = {
            s.nombre: s for s in (
                TemperaturaOrgano(semilla), TemperaturaAmbiente(semilla),
                Humedad(semilla), PresionAltitud(semilla), Choque(semilla),
                LuzInterior(semilla), SelloTapa(semilla), Bateria(semilla),
                GPS(semilla),
            )
        }
        self._minutos_fuera_rango = 0.0
        self._ultima_lectura_t = None
        self._excepciones_emitidas = set()

        reales = [n for n, s in self.sensores.items() if s.real]
        simulados = [n for n, s in self.sensores.items() if not s.real]
        print("[sensores] hardware real: %s" % (", ".join(reales) or "ninguno"))
        print("[sensores] simulados:     %s" % ", ".join(simulados))
        if self.bus:
            self.bus.emitir("SENSORES_INICIADOS",
                            {"reales": reales, "simulados": simulados})

    def leer_todo(self):
        return {n: s.leer() for n, s in self.sensores.items()}

    def revisar(self, lectura=None):
        """Evalua la lectura contra los rangos y emite las excepciones.

        Devuelve la lista de excepciones activas para que la LCD las muestre.
        """
        L = lectura if lectura is not None else self.leer_todo()
        ahora = time.time()
        dt_min = 0.0
        if self._ultima_lectura_t is not None:
            dt_min = ((ahora - self._ultima_lectura_t) * config.FACTOR_TIEMPO) / 60.0
        self._ultima_lectura_t = ahora

        excepciones = []
        t = L["temp_organo"]
        tmin, tmax = config.TEMP_RANGO_OK

        if not (tmin <= t <= tmax):
            self._minutos_fuera_rango += dt_min
            excepciones.append(("TEMP", "%.1fC FUERA" % t))
            if self._minutos_fuera_rango >= config.TEMP_MINUTOS_TOLERADOS_FUERA \
                    and "temp" not in self._excepciones_emitidas:
                self._excepciones_emitidas.add("temp")
                self._emitir("TEMPERATURA_FUERA_DE_RANGO", {
                    "valor": t, "rango": list(config.TEMP_RANGO_OK),
                    "duracion_min": round(self._minutos_fuera_rango, 1),
                })
        else:
            if self._minutos_fuera_rango > 0:
                self._emitir("TEMPERATURA_NORMALIZADA", {
                    "valor": t,
                    "duracion_fuera_min": round(self._minutos_fuera_rango, 1),
                })
            self._minutos_fuera_rango = 0.0
            self._excepciones_emitidas.discard("temp")

        if L["choque"] > config.CHOQUE_G_MAXIMO:
            excepciones.append(("GOLPE", "%.1fg IMPACTO" % L["choque"]))
            self._emitir("IMPACTO_DETECTADO", {"g_pico": L["choque"]})

        if L["luz"] > config.LUZ_UMBRAL_SELLO or not L["sello"]:
            excepciones.append(("SELLO", "SELLO ABIERTO"))
            if "sello" not in self._excepciones_emitidas:
                self._excepciones_emitidas.add("sello")
                self._emitir("SELLO_ALTERADO",
                             {"lux": L["luz"], "tapaCerrada": L["sello"]})

        if L["bateria"] < config.BATERIA_MINIMA_PCT:
            excepciones.append(("BATERIA", "BAT %.0f%% BAJA" % L["bateria"]))
            if "bateria" not in self._excepciones_emitidas:
                self._excepciones_emitidas.add("bateria")
                self._emitir("BATERIA_BAJA", {"porcentaje": L["bateria"]})

        h = L["humedad"]
        if not (config.HUMEDAD_RANGO_OK[0] <= h <= config.HUMEDAD_RANGO_OK[1]):
            excepciones.append(("HUMEDAD", "HR %.0f%% FUERA" % h))

        return excepciones

    def _emitir(self, tipo, payload):
        if self.bus:
            self.bus.emitir(tipo, payload, actor="caja:sensores")
        else:
            print("[sensores] %s %s" % (tipo, payload))
