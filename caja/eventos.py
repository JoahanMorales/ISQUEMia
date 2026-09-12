#!/usr/bin/env python3
"""Almacen de eventos append-only de la caja.

La caja no guarda "estado": guarda hechos con marca de tiempo y deriva el
estado de ellos. Es la misma regla que el almacen central (ISQUEMIA.md 5.2),
y es lo que permite que el modo sin red (13.3) funcione: si no hay senal, los
eventos se encolan en disco y se vacian intactos al reconectar.

Tipos de evento que produce la caja (ISQUEMIA.md 13.4):
    CUSTODIA_TRASPASADA, SELLO_ALTERADO, TEMPERATURA_FUERA_DE_RANGO,
    APERTURA_DENEGADA, MODO_SIN_RED_ACTIVADO / DESACTIVADO
mas los propios del dispositivo: ALERTA_CIT, LECTURA_SENSORES, ROSTRO_*, etc.
"""
import json
import os
import threading
import time
import uuid

from . import config


class BusEventos:
    """Append-only sobre JSONL. Un evento escrito no se modifica jamas."""

    def __init__(self, archivo=None, corrida_id=None):
        self.archivo = os.path.abspath(archivo or config.ARCHIVO_EVENTOS)
        self.corrida_id = corrida_id or uuid.uuid4().hex[:8]
        self._lock = threading.Lock()
        self._suscriptores = []
        self._cola_sin_red = []
        self.sin_red = False
        os.makedirs(os.path.dirname(self.archivo), exist_ok=True)

    def suscribir(self, callback):
        """El callback recibe cada evento. Asi la LCD se entera sin preguntar."""
        self._suscriptores.append(callback)

    def emitir(self, tipo, payload=None, actor="caja", t_sim=None):
        ev = {
            "id": uuid.uuid4().hex[:12],
            "t_wall": time.time(),
            "t_sim": t_sim,
            "actor": actor,
            "tipo": tipo,
            "payload": payload or {},
            "semilla": config.SEMILLA,
            "corridaId": self.corrida_id,
        }
        with self._lock:
            with open(self.archivo, "a") as f:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")
            if self.sin_red:
                # Sin senal el evento igual se persiste; lo que se encola es el
                # envio al bus central, no el registro local.
                self._cola_sin_red.append(ev)
        for cb in self._suscriptores:
            try:
                cb(ev)
            except Exception as e:
                print("[eventos] suscriptor fallo:", e)
        return ev

    # --- modo sin red (ISQUEMIA.md 13.3) --------------------------------
    def activar_sin_red(self):
        if self.sin_red:
            return
        self.sin_red = True
        self._t_sin_red = time.time()
        self.emitir("MODO_SIN_RED_ACTIVADO", {})

    def desactivar_sin_red(self):
        if not self.sin_red:
            return
        self.sin_red = False
        pendientes = len(self._cola_sin_red)
        duracion = int(time.time() - getattr(self, "_t_sin_red", time.time()))
        self.emitir("MODO_SIN_RED_DESACTIVADO",
                    {"duracion_s": duracion, "eventosEncolados": pendientes})
        drenados = list(self._cola_sin_red)
        self._cola_sin_red.clear()
        return drenados

    def leer(self, tipo=None):
        if not os.path.exists(self.archivo):
            return []
        out = []
        with open(self.archivo) as f:
            for linea in f:
                linea = linea.strip()
                if not linea:
                    continue
                try:
                    ev = json.loads(linea)
                except json.JSONDecodeError:
                    continue
                if tipo is None or ev.get("tipo") == tipo:
                    out.append(ev)
        return out
