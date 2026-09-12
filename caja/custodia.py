#!/usr/bin/env python3
"""Maquina de estados de la caja y composicion de las pantallas de 16x2.

ESTADOS
    SELLADA        cargada en el hospital donante, aun sin salir
    EN_TRANSITO    en ruta; monitoreo continuo, camara apagada
    EN_DESTINO     llego; se enciende la camara y se pide al receptor
    IDENTIFICANDO  hay una cara en cuadro, acumulando cuadros de confirmacion
    AUTORIZADA     identificacion valida; el pestillo va a ceder
    ABIERTA        custodia traspasada (terminal)
    DENEGADA       identificacion fallida; vuelve a EN_DESTINO
    VENCIDA        el CIT paso el limite del organo (terminal)

Toda transicion emite un evento. La regla de ISQUEMIA.md 15 (G8) es que no
existe decision sin evento correspondiente, y aqui se cumple por construccion:
cambiar de estado es emitir.

Las pantallas viven aqui y no en el driver de la LCD a proposito: el driver
sabe pintar 16x2, no sabe nada de organos.
"""
import time

from . import config


class Custodia:
    ESTADOS = ("SELLADA", "EN_TRANSITO", "EN_DESTINO", "IDENTIFICANDO",
               "AUTORIZADA", "ABIERTA", "DENEGADA", "VENCIDA")
    TERMINALES = ("ABIERTA", "VENCIDA")

    def __init__(self, caso, reloj, bus=None):
        self.caso = caso            # dict: id, organo, origen, destino, receptor
        self.reloj = reloj
        self.bus = bus
        self.estado = "SELLADA"
        self.t_estado = time.time()
        self.intentos_fallidos = 0
        self.identificacion = None
        self.ultima_lectura = {}
        self.excepciones = []
        self.historial = []

    # --- transiciones -----------------------------------------------------
    def transicionar(self, nuevo, payload=None):
        if nuevo not in self.ESTADOS:
            raise ValueError("Estado desconocido: %r" % nuevo)
        if self.estado in self.TERMINALES:
            return False
        anterior, self.estado = self.estado, nuevo
        self.t_estado = time.time()
        self.historial.append((anterior, nuevo, time.time()))
        self._evento("CUSTODIA_ESTADO", dict(payload or {}, **{
            "de": anterior, "a": nuevo,
            "citHoras": round(self.reloj.transcurrido_h, 3),
        }))
        return True

    def _evento(self, tipo, payload):
        if self.bus:
            self.bus.emitir(tipo, payload, actor="caja:custodia",
                            t_sim=round(self.reloj.transcurrido_h, 4))

    @property
    def segundos_en_estado(self):
        return time.time() - self.t_estado

    # --- pantallas de 16x2 ------------------------------------------------
    def pantallas_transito(self):
        """Carrusel que rota mientras la caja viaja.

        Es todo lo que un operador necesita saber sin abrir una laptop: que
        organo lleva, cuanto le queda de vida, a que temperatura va, si el
        sello aguanta y donde esta.
        """
        L = self.ultima_lectura
        r = self.reloj
        pct = int(round(r.fraccion * 100))
        pantallas = []

        # 1. Lo primero es siempre el reloj: es lo unico irrecuperable.
        pantallas.append((
            "%-8s %s" % (r.etiqueta[:8], r.texto_transcurrido()),
            "QUEDA %s %3d%%" % (r.texto_restante(), pct),
        ))

        # 2. Temperatura del organo contra su rango.
        if "temp_organo" in L:
            t = L["temp_organo"]
            estado_t = "OK" if config.TEMP_RANGO_OK[0] <= t <= config.TEMP_RANGO_OK[1] else "FUERA"
            pantallas.append((
                "TEMP ORGANO",
                "%.1fC  %s %s" % (t, "RANGO", estado_t),
            ))

        # 3. Ambiente interno.
        if "temp_ambiente" in L and "humedad" in L:
            pantallas.append((
                "AMB %.1fC HR%2.0f%%" % (L["temp_ambiente"], L["humedad"]),
                "ALTITUD %5.0fm" % L.get("altitud", 0),
            ))

        # 4. Integridad fisica.
        if "sello" in L:
            pantallas.append((
                "SELLO %s" % ("INTACTO" if L["sello"] else "ABIERTO"),
                "BAT %2.0f%%  %3.1fg" % (L.get("bateria", 0), L.get("choque", 0)),
            ))

        # 5. Trayecto.
        gps = L.get("gps") or {}
        pantallas.append((
            "%s>%s" % (self.caso.get("origen", "ORIG")[:7],
                       self.caso.get("destino", "DEST")[:7]),
            "AVANCE %3.0f%%" % (gps.get("avance", 0) * 100),
        ))

        # 6. Identidad del caso, para cotejar contra el papel.
        pantallas.append((
            "CASO %s" % self.caso.get("id", "SYN-0000")[:11],
            "RCPT %s" % self.caso.get("receptor", "?")[:11],
        ))
        return pantallas

    def pantalla_actual(self, indice_carrusel=0):
        """Devuelve (linea1, linea2) segun el estado. Aqui manda el estado:
        el carrusel solo corre cuando no esta pasando nada mas importante."""
        r = self.reloj

        if self.excepciones:
            etiqueta, detalle = self.excepciones[0]
            return ("!! %s" % etiqueta[:12], detalle[:16])

        if self.estado == "VENCIDA":
            return ("CIT EXCEDIDO", "%s NO VIABLE" % r.etiqueta[:8])

        if self.estado == "SELLADA":
            return ("CAJA SELLADA", "%s %s" % (r.etiqueta[:7], r.texto_transcurrido()))

        if self.estado == "EN_TRANSITO":
            pantallas = self.pantallas_transito()
            return pantallas[indice_carrusel % len(pantallas)]

        if self.estado == "EN_DESTINO":
            return ("EN DESTINO", "ACERQUE ROSTRO")

        if self.estado == "IDENTIFICANDO":
            ident = self.identificacion
            detalle = (ident.motivo if ident and ident.motivo else "ANALIZANDO")
            return ("IDENTIFICANDO", detalle[:16].upper())

        if self.estado == "AUTORIZADA":
            ident = self.identificacion
            quien = (ident.nombre or ident.identificador or "RECEPTOR") if ident else "RECEPTOR"
            return ("RECEPTOR OK", quien[:16].upper())

        if self.estado == "DENEGADA":
            return ("ACCESO NEGADO", "INTENTO %d" % self.intentos_fallidos)

        if self.estado == "ABIERTA":
            return ("CUSTODIA CEDIDA", "CIT FINAL %s" % r.texto_transcurrido())

        return (self.estado[:16], "")

    def resumen(self):
        return {
            "caso": self.caso.get("id"),
            "estado": self.estado,
            "reloj": self.reloj.resumen(),
            "excepciones": [e[0] for e in self.excepciones],
            "intentosFallidos": self.intentos_fallidos,
            "identificacion": self.identificacion.a_dict() if self.identificacion else None,
        }
