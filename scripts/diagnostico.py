#!/usr/bin/env python3
"""Revisa que hay conectado a la caja y que falta. Correr antes de la demo."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from caja import config


def titulo(t):
    print("\n" + t)
    print("-" * len(t))


def escanear_i2c(bus):
    try:
        salida = subprocess.run(["i2cdetect", "-y", "-r", str(bus)],
                                capture_output=True, text=True, timeout=10).stdout
    except Exception as e:
        return None, str(e)
    encontrados = []
    for linea in salida.splitlines()[1:]:
        partes = linea.split(":")
        if len(partes) < 2:
            continue
        base = int(partes[0], 16)
        for i, celda in enumerate(partes[1].split()):
            if celda not in ("--", "UU"):
                encontrados.append(base + i)
    return encontrados, salida


CONOCIDOS = {
    0x27: "LCD 1602A con backpack PCF8574",
    0x3F: "LCD 1602A con backpack PCF8574A",
    0x40: "PCA9685 (servos)",
    0x41: "INA219 (bateria)",
    0x44: "SHT31-D (temp/humedad)",
    0x23: "BH1750 (luz interior)",
    0x68: "MPU6050 (acelerometro)",
    0x76: "BMP280 (presion)",
    0x77: "BMP280 (direccion alterna)",
}

print("=" * 56)
print("  DIAGNOSTICO DE LA CAJA ISQUEMIA")
print("=" * 56)

titulo("1. Bus I2C %d (pines 3 y 5 del header)" % config.I2C_BUS)
direcciones, salida = escanear_i2c(config.I2C_BUS)
if direcciones is None:
    print("  no se pudo escanear: %s" % salida)
else:
    if not direcciones:
        print("  bus vacio: no responde ningun dispositivo")
    for d in direcciones:
        print("  0x%02X  %s" % (d, CONOCIDOS.get(d, "dispositivo no identificado")))
    faltantes = [(d, n) for d, n in CONOCIDOS.items()
                 if d not in direcciones and d in (0x27, 0x3F, 0x40)]
    if 0x27 not in direcciones and 0x3F not in direcciones:
        print("\n  FALTA la LCD. Revisa docs/CABLEADO.md seccion 1.")

titulo("2. Camara")
pipe_ok = os.path.exists("/dev/video0")
print("  /dev/video0: %s" % ("presente" if pipe_ok else "ausente"))
try:
    import cv2
    cap = cv2.VideoCapture(config.CAM_PIPELINE, cv2.CAP_GSTREAMER)
    if cap.isOpened():
        ok, fr = cap.read()
        print("  CSI IMX219 por nvarguscamerasrc: %s"
              % ("cuadro %dx%d OK" % (fr.shape[1], fr.shape[0]) if ok else "abre pero no entrega cuadro"))
        cap.release()
    else:
        print("  CSI no abre (nvargus-daemon caido?). Prueba: sudo systemctl restart nvargus-daemon")
except Exception as e:
    print("  error de camara: %s" % e)

titulo("3. Modelos de vision")
for etiqueta, ruta in (("detector YuNet", config.MODELO_DETECTOR),
                       ("reconocedor SFace", config.MODELO_RECONOCEDOR)):
    if os.path.exists(ruta):
        print("  %-18s %.1f MB" % (etiqueta, os.path.getsize(ruta) / 1e6))
    else:
        print("  %-18s AUSENTE%s" % (etiqueta, "  (opcional: modo deteccion)"
                                     if "SFace" in etiqueta else ""))

titulo("4. Sensores")
from caja.sensores import BancoSensores
banco = BancoSensores()
for nombre, s in banco.sensores.items():
    print("  %-14s %s" % (nombre, "HARDWARE REAL" if s.real else "simulado"))

titulo("5. LCD")
try:
    from caja.lcd1602 import LCD1602
    lcd = LCD1602()
    print("  backend activo: %s" % lcd.modo)
    lcd.mostrar("DIAGNOSTICO", "LCD OPERATIVA")
    lcd.cerrar()
except Exception as e:
    print("  fallo: %s" % e)

print("\n" + "=" * 56)
