#!/usr/bin/env python3
"""Reloj de isquemia frio (CIT) de la caja.

Regla heredada de ISQUEMIA.md 6.2: el CIT transcurrido NO se almacena, se
deriva del cross-clamp cada vez que se consulta. Guardarlo es la fuente
numero uno de bugs de reloj.

El factor de aceleracion permite que una demo de tres minutos recorra las
treinta horas de un rinon sin trucar los numeros: se acelera el tiempo, no
se falsean las cifras.
"""
import time

from . import config


class RelojIsquemia:
    def __init__(self, organo, t_crossclamp=None, factor=None, bus=None):
        if organo not in config.CIT_LIMITE_H:
            raise ValueError("Organo desconocido: %r. Conocidos: %s"
                             % (organo, ", ".join(config.CIT_LIMITE_H)))
        self.organo = organo
        self.limite_h = config.CIT_LIMITE_H[organo]
        self.etiqueta = config.CIT_ETIQUETA[organo]
        self.factor = factor if factor is not None else config.FACTOR_TIEMPO
        self._t0_real = t_crossclamp or time.time()
        self._congelado = None
        self._bus = bus
        self._alertas_emitidas = set()

    # --- lectura ----------------------------------------------------------
    @property
    def transcurrido_h(self):
        """Horas de isquemia frio acumuladas. Derivado, nunca almacenado."""
        if self._congelado is not None:
            return self._congelado
        return ((time.time() - self._t0_real) * self.factor) / 3600.0

    @property
    def restante_h(self):
        return max(0.0, self.limite_h - self.transcurrido_h)

    @property
    def fraccion(self):
        """0.0 recien sacado, 1.0 en el limite. Puede pasar de 1."""
        return self.transcurrido_h / self.limite_h

    @property
    def viable(self):
        return self.transcurrido_h < self.limite_h

    @property
    def nivel(self):
        """Severidad para decidir color, parpadeo y prioridad en pantalla."""
        f = self.fraccion
        if f >= 1.0:
            return "vencido"
        if f >= 0.90:
            return "critico"
        if f >= 0.75:
            return "alto"
        if f >= 0.50:
            return "medio"
        return "ok"

    # --- formato para 16 columnas ----------------------------------------
    @staticmethod
    def _hhmm(horas):
        total_min = int(round(horas * 60))
        return "%02d:%02d" % (total_min // 60, total_min % 60)

    def texto_transcurrido(self):
        return self._hhmm(self.transcurrido_h)

    def texto_restante(self):
        return self._hhmm(self.restante_h)

    # --- control ----------------------------------------------------------
    def congelar(self):
        """Detiene el reloj: el organo se implanto o la corrida termino."""
        self._congelado = self.transcurrido_h

    def revisar_alertas(self):
        """Emite ALERTA_CIT una sola vez por umbral (50%, 75%, 90%)."""
        nuevas = []
        for u in config.UMBRALES_ALERTA_CIT:
            if self.fraccion >= u and u not in self._alertas_emitidas:
                self._alertas_emitidas.add(u)
                nuevas.append(u)
                if self._bus:
                    self._bus.emitir("ALERTA_CIT", {
                        "organo": self.organo,
                        "umbral": u,
                        "citHoras": round(self.transcurrido_h, 3),
                        "limiteHoras": self.limite_h,
                        "restanteHoras": round(self.restante_h, 3),
                    })
        if self.fraccion >= 1.0 and "vencido" not in self._alertas_emitidas:
            self._alertas_emitidas.add("vencido")
            if self._bus:
                self._bus.emitir("CIT_VENCIDO", {
                    "organo": self.organo,
                    "citHoras": round(self.transcurrido_h, 3),
                })
        return nuevas

    def resumen(self):
        return {
            "organo": self.organo,
            "citHoras": round(self.transcurrido_h, 3),
            "limiteHoras": self.limite_h,
            "restanteHoras": round(self.restante_h, 3),
            "fraccion": round(self.fraccion, 4),
            "nivel": self.nivel,
            "viable": self.viable,
        }
