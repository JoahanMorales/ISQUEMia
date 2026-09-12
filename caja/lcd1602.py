#!/usr/bin/env python3
"""Driver de LCD 1602A (controlador HD44780) para Jetson Orin Nano.

Tres backends intercambiables, se elige en config.LCD_BACKEND:

  "i2c"  -> la LCD trae soldado atras un modulo PCF8574 ("backpack").
            Solo 4 cables. Es lo recomendado y lo que asume el cableado
            documentado en docs/CABLEADO.md.
  "gpio" -> LCD pelada de 16 pines, conectada en modo 4 bits.
  "sim"  -> no hay hardware; la pantalla se pinta en consola con el mismo
            marco de 16x2, para poder desarrollar sin la caja enfrente.
  "auto" -> intenta i2c, luego gpio, y si nada responde cae a sim sin morir.

El HD44780 no tiene acentos ni enie en su tabla de caracteres, asi que todo
texto pasa por _ascii() antes de escribirse. Por eso los mensajes de la caja
se escriben sin acentos desde el origen: lo que se ve es lo que se manda.
"""
import time

from . import config

# --- Comandos HD44780 ---
LIMPIAR = 0x01
INICIO = 0x02
MODO_ENTRADA = 0x04
CONTROL_PANTALLA = 0x08
DESPLAZAR = 0x10
CONFIG_FUNCION = 0x20
SET_CGRAM = 0x40
SET_DDRAM = 0x80

# Banderas
ENTRADA_IZQ_A_DER = 0x02
PANTALLA_ON = 0x04
CURSOR_OFF = 0x00
PARPADEO_OFF = 0x00
MODO_4BITS = 0x00
DOS_LINEAS = 0x08
PUNTOS_5x8 = 0x00

# Bits del PCF8574 en el backpack estandar de las LCD 1602 IIC
PCF_RS = 0x01
PCF_RW = 0x02
PCF_E = 0x04
PCF_LUZ = 0x08

# Direccion base DDRAM de cada fila
FILA_OFFSET = (0x00, 0x40)

# Caracteres personalizados: 8 patrones de 5x8 pixeles cargables en CGRAM.
# Los usamos para que la LCD comunique estado de un vistazo.
GLIFOS = {
    "grado":     [0x06, 0x09, 0x09, 0x06, 0x00, 0x00, 0x00, 0x00],
    "reloj":     [0x0E, 0x15, 0x15, 0x17, 0x11, 0x0E, 0x00, 0x00],
    "gota":      [0x04, 0x04, 0x0E, 0x0E, 0x1F, 0x1F, 0x0E, 0x00],
    "candado":   [0x0E, 0x11, 0x11, 0x1F, 0x1B, 0x1B, 0x1F, 0x00],
    "abierto":   [0x0E, 0x10, 0x10, 0x1F, 0x1B, 0x1B, 0x1F, 0x00],
    "alerta":    [0x04, 0x0E, 0x0E, 0x0E, 0x1F, 0x00, 0x04, 0x00],
    "corazon":   [0x00, 0x0A, 0x1F, 0x1F, 0x0E, 0x04, 0x00, 0x00],
    "bloque":    [0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F],
}
_ORDEN_GLIFOS = list(GLIFOS.keys())


def _ascii(texto):
    """El HD44780 no tiene acentos. Se sustituyen en vez de mostrar basura."""
    tabla = str.maketrans(
        "aeiouAEIOUnNuUaAeEiIoOuU",
        "aeiouAEIOUnNuUaAeEiIoOuU",
    )
    reemplazos = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U",
        "ñ": "n", "Ñ": "N", "ü": "u", "Ü": "U", "¿": "?", "¡": "!",
        "°": chr(0),  # glifo personalizado 0 = grado
    }
    for k, v in reemplazos.items():
        texto = texto.replace(k, v)
    return texto.translate(tabla)


# ===========================================================================
# Backends de transporte: solo saben mandar 4 bits con RS. Nada mas.
# ===========================================================================
class _BackendI2C:
    """LCD con modulo PCF8574. Cuelga del mismo bus que el PCA9685."""

    nombre = "i2c"

    def __init__(self, bus=None, direccion=None):
        from Adafruit_PureIO.smbus import SMBus

        self._bus_num = bus if bus is not None else config.I2C_BUS
        self._bus = SMBus(self._bus_num)
        self.luz = PCF_LUZ

        if direccion in (None, "auto"):
            self.direccion = self._detectar()
        else:
            self.direccion = direccion
            self._bus.write_byte(self.direccion, 0)

    def _detectar(self):
        """0x27 (PCF8574) y 0x3F (PCF8574A) son las dos de fabrica."""
        for dir_probable in (0x27, 0x3F, 0x20, 0x38):
            try:
                self._bus.write_byte(dir_probable, 0)
                return dir_probable
            except OSError:
                continue
        raise OSError(
            "No hay ninguna LCD I2C en el bus %d. Direcciones probadas: "
            "0x27, 0x3F, 0x20, 0x38. Revisa el cableado o corre "
            "'i2cdetect -y %d'." % (self._bus_num, self._bus_num)
        )

    def _escribir_byte(self, valor):
        self._bus.write_byte(self.direccion, valor | self.luz)

    def enviar_nibble(self, nibble, rs):
        base = ((nibble & 0x0F) << 4) | (PCF_RS if rs else 0)
        self._escribir_byte(base)
        self._escribir_byte(base | PCF_E)   # flanco de subida
        time.sleep(0.000001)
        self._escribir_byte(base)           # flanco de bajada: el dato entra
        time.sleep(0.00005)

    def set_luz(self, encendida):
        self.luz = PCF_LUZ if encendida else 0x00
        self._escribir_byte(0)

    def cerrar(self):
        try:
            self.set_luz(False)
            self._bus.close()
        except Exception:
            pass


class _BackendGPIO:
    """LCD de 16 pines directa al header, en modo 4 bits."""

    nombre = "gpio"

    def __init__(self, pines=None):
        import Jetson.GPIO as GPIO

        self.GPIO = GPIO
        self.pines = pines or config.LCD_PINES_GPIO
        GPIO.setmode(GPIO.BOARD)
        GPIO.setwarnings(False)
        for pin in self.pines.values():
            GPIO.setup(pin, GPIO.OUT, initial=GPIO.LOW)

    def enviar_nibble(self, nibble, rs):
        G = self.GPIO
        G.output(self.pines["RS"], G.HIGH if rs else G.LOW)
        for i, clave in enumerate(("D4", "D5", "D6", "D7")):
            G.output(self.pines[clave], G.HIGH if (nibble >> i) & 1 else G.LOW)
        G.output(self.pines["E"], G.HIGH)
        time.sleep(0.000001)
        G.output(self.pines["E"], G.LOW)
        time.sleep(0.00005)

    def set_luz(self, encendida):
        # Sin backpack, la luz se controla por hardware (pines 15/16 de la LCD).
        pass

    def cerrar(self):
        try:
            for pin in self.pines.values():
                self.GPIO.cleanup(pin)
        except Exception:
            pass


class _BackendSim:
    """Sin hardware: dibuja la pantalla en consola con marco de 16x2."""

    nombre = "sim"

    def __init__(self):
        self._ultimo = None

    def enviar_nibble(self, nibble, rs):
        pass

    def set_luz(self, encendida):
        pass

    def cerrar(self):
        pass

    def pintar(self, buffer_):
        firma = tuple(buffer_)
        if firma == self._ultimo:
            return
        self._ultimo = firma
        print("\n    +" + "-" * config.LCD_COLUMNAS + "+")
        for linea in buffer_:
            print("    |" + linea.ljust(config.LCD_COLUMNAS)[:config.LCD_COLUMNAS] + "|")
        print("    +" + "-" * config.LCD_COLUMNAS + "+")


# ===========================================================================
# La pantalla
# ===========================================================================
class LCD1602:
    """API de alto nivel. El resto del programa solo usa esta clase."""

    def __init__(self, backend=None, bus=None, direccion=None):
        self.columnas = config.LCD_COLUMNAS
        self.filas = config.LCD_FILAS
        self._buffer = [""] * self.filas
        self._backend = self._elegir_backend(
            backend or config.LCD_BACKEND, bus, direccion)
        self.modo = self._backend.nombre
        if self.modo != "sim":
            self._inicializar_hd44780()
            self._cargar_glifos()
        self.limpiar()

    # --- seleccion de backend -------------------------------------------
    def _elegir_backend(self, deseado, bus, direccion):
        intentos = {
            "i2c": lambda: _BackendI2C(bus, direccion or config.LCD_I2C_DIR),
            "gpio": lambda: _BackendGPIO(),
            "sim": lambda: _BackendSim(),
        }
        if deseado != "auto":
            if deseado not in intentos:
                raise ValueError("Backend de LCD desconocido: %r" % deseado)
            return intentos[deseado]()

        # El modo GPIO NO entra en la deteccion automatica: configurar pines de
        # salida siempre "funciona" haya o no una LCD del otro lado, asi que
        # elegirlo solo porque no hubo I2C daria un falso positivo. Se pide a
        # mano con --lcd gpio cuando la LCD esta cableada a los 16 pines.
        try:
            b = intentos["i2c"]()
            print("[lcd] backend i2c activo en 0x%02X" % b.direccion)
            return b
        except Exception as e:
            print("[lcd] i2c no disponible: %s" % e)
        print("[lcd] sin LCD detectada, pantalla simulada en consola"
              " (usa --lcd gpio si la conectaste por los 16 pines)")
        return _BackendSim()

    # --- protocolo HD44780 ----------------------------------------------
    def _inicializar_hd44780(self):
        """Secuencia de arranque obligatoria de la hoja de datos."""
        time.sleep(0.05)                      # espera a que suba la tension
        for _ in range(3):                    # tres veces 0x03: fuerza 8 bits
            self._backend.enviar_nibble(0x03, False)
            time.sleep(0.005)
        self._backend.enviar_nibble(0x02, False)   # y ahora si, a 4 bits
        time.sleep(0.001)

        self._comando(CONFIG_FUNCION | MODO_4BITS | DOS_LINEAS | PUNTOS_5x8)
        self._comando(CONTROL_PANTALLA | PANTALLA_ON | CURSOR_OFF | PARPADEO_OFF)
        self._comando(LIMPIAR)
        time.sleep(0.002)
        self._comando(MODO_ENTRADA | ENTRADA_IZQ_A_DER)

    def _comando(self, valor):
        self._backend.enviar_nibble(valor >> 4, False)
        self._backend.enviar_nibble(valor & 0x0F, False)
        if valor in (LIMPIAR, INICIO):
            time.sleep(0.002)   # estos dos tardan 1.52 ms

    def _dato(self, valor):
        self._backend.enviar_nibble(valor >> 4, True)
        self._backend.enviar_nibble(valor & 0x0F, True)

    def _cargar_glifos(self):
        """Sube los 8 caracteres personalizados a la CGRAM."""
        for i, nombre in enumerate(_ORDEN_GLIFOS[:8]):
            self._comando(SET_CGRAM | (i << 3))
            for fila in GLIFOS[nombre]:
                self._dato(fila)
        self._comando(SET_DDRAM)

    @staticmethod
    def glifo(nombre):
        """Devuelve el caracter que dibuja un glifo personalizado."""
        return chr(_ORDEN_GLIFOS.index(nombre)) if nombre in GLIFOS else "?"

    # --- API publica ------------------------------------------------------
    def limpiar(self):
        self._buffer = [""] * self.filas
        if self.modo != "sim":
            self._comando(LIMPIAR)
        else:
            self._backend.pintar(self._buffer)

    def escribir(self, texto, fila=0, columna=0):
        """Escribe una linea. Recorta a 16 y rellena con espacios el resto."""
        if fila >= self.filas:
            return
        texto = _ascii(str(texto))
        disponible = self.columnas - columna
        texto = texto[:disponible].ljust(disponible)

        anterior = self._buffer[fila].ljust(self.columnas)
        nueva = (anterior[:columna] + texto)[:self.columnas]
        if nueva == self._buffer[fila]:
            return                      # no reescribas lo que ya esta puesto
        self._buffer[fila] = nueva

        if self.modo == "sim":
            self._backend.pintar(self._buffer)
            return
        self._comando(SET_DDRAM | (FILA_OFFSET[fila] + columna))
        for ch in texto:
            self._dato(ord(ch) & 0xFF)

    def mostrar(self, linea1="", linea2=""):
        """Pinta las dos lineas de una vez. Es el metodo que se usa siempre."""
        self.escribir(linea1, 0)
        if self.filas > 1:
            self.escribir(linea2, 1)

    def centrar(self, texto, fila=0):
        texto = _ascii(str(texto))[:self.columnas]
        self.escribir(texto.center(self.columnas), fila)

    def barra(self, fraccion, fila=1, ancho=None):
        """Barra de progreso con el glifo de bloque lleno."""
        ancho = ancho or self.columnas
        fraccion = max(0.0, min(1.0, fraccion))
        llenos = int(round(fraccion * ancho))
        self.escribir(self.glifo("bloque") * llenos + " " * (ancho - llenos), fila)

    def luz(self, encendida=True):
        self._backend.set_luz(encendida)

    def parpadear_luz(self, veces=3, intervalo=0.15):
        for _ in range(veces):
            self.luz(False); time.sleep(intervalo)
            self.luz(True); time.sleep(intervalo)

    def cerrar(self):
        try:
            self.limpiar()
        except Exception:
            pass
        self._backend.cerrar()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.cerrar()
