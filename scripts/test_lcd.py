#!/usr/bin/env python3
"""Prueba la LCD sola: glifos, barra, carrusel. Sirve para ajustar el contraste.

Si la pantalla se ve con los rectangulos negros de la fila de arriba pero sin
texto, no es el codigo: es el potenciometro azul del backpack. Girarlo despacio
hasta que el texto aparezca.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from caja.lcd1602 import LCD1602

lcd = LCD1602()
print("backend: %s" % lcd.modo)

secuencia = [
    ("ISQUEMIA", "PRUEBA DE LCD"),
    ("RINON I  04:12", "QUEDA 25:48 14%"),
    ("TEMP ORGANO", "4.2C  RANGO OK"),
    ("!! TEMP", "9.8C FUERA"),
    ("EN DESTINO", "ACERQUE ROSTRO"),
    ("RECEPTOR OK", "PERSONA PRESENTE"),
    ("CUSTODIA CEDIDA", "CIT FINAL 04:35"),
]
for l1, l2 in secuencia:
    lcd.mostrar(l1, l2)
    print("|%-16s|%-16s|" % (l1, l2))
    time.sleep(1.6)

lcd.mostrar("BARRA DE CARGA", "")
for i in range(17):
    lcd.barra(i / 16.0, fila=1)
    time.sleep(0.09)

lcd.mostrar("GLIFOS:", "".join(lcd.glifo(g) for g in
                               ("grado", "reloj", "gota", "candado",
                                "abierto", "alerta", "corazon")))
time.sleep(2.5)
lcd.parpadear_luz(3)
lcd.mostrar("PRUEBA", "TERMINADA")
time.sleep(1.5)
lcd.cerrar()
