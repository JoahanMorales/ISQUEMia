#!/usr/bin/env python3
"""Configuracion central de la caja ISQUEMIA.

Todo parametro ajustable vive aqui. Ningun otro modulo define constantes
de dominio ni pinout: si hay que recablear o recalibrar, se toca este archivo
y nada mas.

Referencias al documento de especificacion (ISQUEMIA.md):
  - Limites de isquemia por organo:  seccion 2.5
  - Eventos de custodia:             seccion 13.4
  - Modo sin red:                    seccion 13.3
"""
import os

RAIZ = os.path.dirname(os.path.abspath(__file__))
MODELOS = os.path.join(RAIZ, "modelos")
DATOS = os.path.join(RAIZ, "..", "datos")

# ---------------------------------------------------------------------------
# 1. Bus I2C
# ---------------------------------------------------------------------------
# En la Jetson Orin Nano el header de 40 pines expone dos buses I2C:
#   bus 7 -> pin 3 (SDA) / pin 5 (SCL)    <- aqui vive el PCA9685 (0x40)
#   bus 1 -> pin 27 (SDA) / pin 28 (SCL)  <- ocupado por el sistema
# La LCD cuelga del MISMO bus 7 en paralelo: las direcciones no chocan.
I2C_BUS = 7

# ---------------------------------------------------------------------------
# 2. LCD 1602A
# ---------------------------------------------------------------------------
# backend: "i2c"  -> modulo PCF8574 soldado atras de la LCD (4 cables)
#          "gpio" -> LCD pelada de 16 pines en modo 4 bits (6 cables de datos)
#          "auto" -> intenta i2c, luego gpio, y si nada responde cae a consola
#          "sim"  -> solo consola, para trabajar sin hardware
LCD_BACKEND = os.environ.get("ISQ_LCD", "auto")

# Direccion del PCF8574. Los dos valores de fabrica son 0x27 y 0x3F segun el
# chip (PCF8574 vs PCF8574A). "auto" prueba ambos y se queda con el que responda.
LCD_I2C_DIR = "auto"

# Pinout para el modo GPIO, en numeracion BOARD (numero fisico de pin del header).
# Elegidos para no chocar con el I2C del PCA9685 (pines 3 y 5).
LCD_PINES_GPIO = {
    "RS": 15,   # Register Select
    "E":  16,   # Enable
    "D4": 18,
    "D5": 22,
    "D6": 29,
    "D7": 31,
}

LCD_COLUMNAS = 16
LCD_FILAS = 2
LCD_SEGUNDOS_POR_PANTALLA = 3.0   # rotacion del carrusel de informacion

# ---------------------------------------------------------------------------
# 3. Servos (pestillo de la caja)
# ---------------------------------------------------------------------------
# El PCA9685 ya esta montado y respondiendo en 0x40. Los canales 0 y 1 son los
# del pan-tilt existente; se reutilizan como "tapa" para la demo.
SERVO_I2C_DIR = 0x40
SERVO_CANAL_PESTILLO = 0      # servo que libera el seguro
SERVO_CANAL_TAPA = 1          # servo que levanta la tapa
SERVO_PULSO_US = (500, 2380)  # rango de pulso calibrado del pan-tilt existente

SERVO_ANG_CERRADO = 20        # pestillo echado
SERVO_ANG_ABIERTO = 160       # pestillo liberado
SERVO_ANG_TAPA_ABAJO = 15
SERVO_ANG_TAPA_ARRIBA = 110
SERVO_VELOCIDAD_GRADOS_S = 90 # movimiento suave, no de golpe

# ---------------------------------------------------------------------------
# 4. Vision / Face ID
# ---------------------------------------------------------------------------
MODELO_DETECTOR = os.path.join(MODELOS, "yunet.onnx")   # YuNet: encuentra caras
MODELO_RECONOCEDOR = os.path.join(MODELOS, "sface.onnx")  # SFace: vector de 128d
ROSTROS_REGISTRADOS = os.path.join(RAIZ, "rostros.json")

CAM_ANCHO, CAM_ALTO = 640, 480
CAM_FLIP_180 = True           # la camara del prototipo esta montada al reves

# Pipeline GStreamer para la camara CSI IMX219. Por V4L2 entrega Bayer crudo,
# asi que nvarguscamerasrc no es opcional en esta placa.
CAM_PIPELINE = (
    "nvarguscamerasrc ! video/x-raw(memory:NVMM),width=1280,height=720,framerate=30/1"
    " ! nvvidconv ! video/x-raw,format=BGRx ! videoconvert ! video/x-raw,format=BGR"
    " ! appsink drop=true max-buffers=1"
)

DETECTOR_UMBRAL = 0.60        # confianza minima para considerar que hay una cara
SFACE_UMBRAL_COSENO = 0.363   # umbral recomendado por OpenCV para SFace
FRAMES_PARA_CONFIRMAR = 3     # cuadros consecutivos coincidiendo antes de abrir

# Modo demo: cualquier cara detectada autoriza la apertura, sin comparar
# contra el receptor registrado. Util cuando no hay tiempo de registrar en sitio.
# Se registra como evento AUTORIZACION_MODO_DEMO para que quede en la auditoria.
MODO_DEMO_CUALQUIER_CARA = os.environ.get("ISQ_DEMO", "0") == "1"

# ---------------------------------------------------------------------------
# 5. Dominio: limites de isquemia por organo (ISQUEMIA.md seccion 2.5)
# ---------------------------------------------------------------------------
CIT_LIMITE_H = {
    "corazon":     4.0,
    "pulmon_izq":  6.0,
    "pulmon_der":  6.0,
    "higado":     12.0,
    "pancreas":   18.0,
    "rinon_izq":  30.0,
    "rinon_der":  30.0,
}

# Etiqueta corta para caber en 16 columnas de LCD
CIT_ETIQUETA = {
    "corazon": "CORAZON", "pulmon_izq": "PULMON I", "pulmon_der": "PULMON D",
    "higado": "HIGADO", "pancreas": "PANCREAS",
    "rinon_izq": "RINON I", "rinon_der": "RINON D",
}

UMBRALES_ALERTA_CIT = (0.50, 0.75, 0.90)   # fraccion del limite

# ---------------------------------------------------------------------------
# 6. Rangos de sensores
# ---------------------------------------------------------------------------
# El transporte hipotermico estatico se mantiene entre 2 y 8 grados; fuera de
# ese rango el organo se compromete y hay que escalar.
TEMP_RANGO_OK = (2.0, 8.0)
TEMP_MINUTOS_TOLERADOS_FUERA = 10   # antes de emitir excepcion critica

HUMEDAD_RANGO_OK = (30.0, 70.0)
CHOQUE_G_MAXIMO = 3.0               # aceleracion pico tolerada
BATERIA_MINIMA_PCT = 15.0
LUZ_UMBRAL_SELLO = 50               # lux; por encima, la tapa se abrio

# ---------------------------------------------------------------------------
# 7. Simulacion
# ---------------------------------------------------------------------------
SEMILLA = int(os.environ.get("ISQ_SEMILLA", "42"))
FACTOR_TIEMPO = float(os.environ.get("ISQ_FACTOR", "60"))  # 60x = 1 min real = 1 h sim

# ---------------------------------------------------------------------------
# 8. Almacen de eventos
# ---------------------------------------------------------------------------
ARCHIVO_EVENTOS = os.path.join(RAIZ, "..", "eventos.jsonl")
