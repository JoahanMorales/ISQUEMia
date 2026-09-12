#!/usr/bin/env python3
"""Prueba de encuadre: dice en vivo si la camara esta viendo una cara.

No abre ventana (la Jetson corre sin escritorio): imprime en consola y deja el
ultimo cuadro anotado en /tmp/isquemia_encuadre.jpg para revisarlo por scp o
desde el navegador de archivos.

    python3 scripts/test_camara.py --segundos 20
"""
import argparse
import os
import sys
import time

import cv2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from caja.face_id import Camara, IdentificadorReceptor

p = argparse.ArgumentParser()
p.add_argument("--segundos", type=int, default=15)
p.add_argument("--salida", default="/tmp/isquemia_encuadre.jpg")
args = p.parse_args()

idf = IdentificadorReceptor()
cam = Camara()
print("apunta la camara a tu cara. %d segundos...\n" % args.segundos)

t0 = time.time()
con_cara = total = 0
ultimo = None
while time.time() - t0 < args.segundos:
    frame = cam.leer()
    if frame is None:
        continue
    total += 1
    r = idf.identificar(frame)
    if r.caja:
        con_cara += 1
        x, y, w, h = r.caja
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
        cv2.putText(frame, "%.2f" % (r.puntaje or 0), (x, max(18, y - 6)),
                    0, 0.6, (0, 255, 0), 2)
        estado = "AUTORIZA" if r.autorizado else (r.motivo or "")
        print("  cara en (%d,%d) %dx%d  conf=%.2f  %s"
              % (x, y, w, h, r.puntaje or 0, estado))
    ultimo = frame
    time.sleep(0.1)

cam.cerrar()
if ultimo is not None:
    cv2.imwrite(args.salida, ultimo)
    print("\nultimo cuadro anotado en %s" % args.salida)
print("cuadros con cara: %d de %d" % (con_cara, total))
if con_cara == 0:
    print("\nSi no detecto nada:")
    print("  - revisa que la cara este iluminada de frente, no a contraluz")
    print("  - mira el JPEG: si sale de cabeza, cambia CAM_FLIP_180 en config.py")
    print("  - acercate: YuNet necesita la cara de unos 80 px de ancho")
