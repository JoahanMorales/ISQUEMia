#!/usr/bin/env python3
"""Registra la cara del receptor autorizado (modo verificacion).

Requiere el modelo SFace, que no viene en el repositorio por peso:
    curl -L -o caja/modelos/sface.onnx \
      https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx

Uso:
    python3 scripts/registrar_receptor.py --nombre "Dra. Rivas" --id RX-0912
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from caja import config
from caja.face_id import Camara, IdentificadorReceptor

p = argparse.ArgumentParser()
p.add_argument("--nombre", required=True)
p.add_argument("--id", dest="identificador", required=True)
p.add_argument("--espera", type=int, default=4, help="segundos antes de capturar")
args = p.parse_args()

if not os.path.exists(config.MODELO_RECONOCEDOR):
    sys.exit("Falta %s. Descargalo con el comando de la cabecera de este archivo."
             % config.MODELO_RECONOCEDOR)

idf = IdentificadorReceptor()
cam = Camara()
print("Mira a la camara. Captura en %d segundos..." % args.espera)
for s in range(args.espera, 0, -1):
    print("  %d" % s)
    cam.leer()
    time.sleep(1)

frame = cam.leer()
cam.cerrar()
if frame is None:
    sys.exit("La camara no entrego cuadro")

try:
    reg = idf.registrar(frame, args.nombre, args.identificador)
except Exception as e:
    sys.exit("No se pudo registrar: %s" % e)

print("Registrado %s (%s) en %s"
      % (reg["nombre"], reg["id"], config.ROSTROS_REGISTRADOS))
