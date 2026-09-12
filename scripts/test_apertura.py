#!/usr/bin/env python3
"""Prueba la cadena de apertura completa moviendo los servos DE VERDAD.

Inyecta una identificacion valida sin necesidad de que haya una cara frente a
la camara, para poder verificar el hardware antes de la demo:

    identificacion -> pestillo cede -> tapa sube -> evento de custodia

Tambien prueba el camino de rechazo, que es el que importa: una identificacion
no autorizada NO debe mover el pestillo.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from caja.eventos import BusEventos
from caja.face_id import ResultadoIdentificacion
from caja.lcd1602 import LCD1602
from caja.servo_caja import PestilloCaja

bus = BusEventos()
lcd = LCD1602()
pestillo = PestilloCaja(bus=bus)

print("\n1. Intento SIN autorizacion (no debe abrir)")
lcd.mostrar("PRUEBA 1/3", "SIN AUTORIZAR")
negada = ResultadoIdentificacion(False, "deteccion", motivo="no coincide")
abrio = pestillo.abrir(negada)
print("   resultado: %s  <-- se espera False" % abrio)
assert abrio is False, "FALLO GRAVE: la caja abrio sin autorizacion"
pestillo.denegar("prueba de rechazo")
time.sleep(1)

print("\n2. Intento CON autorizacion (debe abrir)")
lcd.mostrar("PRUEBA 2/3", "AUTORIZANDO...")
valida = ResultadoIdentificacion(True, "deteccion", nombre="PERSONA PRESENTE",
                                 puntaje=0.94, caja=(100, 80, 220, 220))
for i in range(17):
    lcd.barra(i / 16.0, fila=1)
    time.sleep(0.04)
abrio = pestillo.abrir(valida, organo="rinon_izq")
print("   resultado: %s  <-- se espera True" % abrio)
assert abrio is True, "el pestillo no cedio con identificacion valida"
lcd.mostrar("CUSTODIA CEDIDA", "CAJA ABIERTA")
time.sleep(2.5)

print("\n3. Cierre")
lcd.mostrar("PRUEBA 3/3", "CERRANDO")
pestillo.cerrar()
time.sleep(1)

lcd.mostrar("PRUEBAS OK", "3/3 CORRECTAS")
time.sleep(1.5)
lcd.cerrar()
pestillo.liberar()

print("\nEventos de custodia registrados:")
for e in bus.leer():
    if e["tipo"] in ("CUSTODIA_TRASPASADA", "APERTURA_DENEGADA", "CAJA_SELLADA"):
        print("  %-22s %s" % (e["tipo"], e["payload"]))
print("\nservos reales: %s" % pestillo.real)
