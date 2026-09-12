#!/usr/bin/env python3
"""Identificacion del receptor en el punto de entrega.

DOS MODOS, y el sistema dice en la LCD y en la auditoria cual esta usando:

  DETECCION (el que corre hoy)
    YuNet encuentra una cara con confianza suficiente durante N cuadros
    seguidos y eso autoriza la apertura. No distingue personas: verifica que
    hay un ser humano presente frente a la caja, no quien es.

  VERIFICACION (queda listo, falta el modelo)
    Si existe modelos/sface.onnx, ademas de detectar se calcula el vector de
    128 dimensiones de la cara y se compara por similitud coseno contra el
    receptor registrado. Solo abre si supera el umbral.
    Para activarlo:
      curl -L -o caja/modelos/sface.onnx \\
        https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
      python3 scripts/registrar_receptor.py --nombre "Dra. Rivas" --id RX-0912

En produccion esto no seria una cara sola: seria la credencial del centro mas
la biometria mas la firma del expediente. La cara es el factor que se puede
demostrar en una mesa de hackathon en cuatro segundos.
"""
import json
import os
import time

import cv2
import numpy as np

from . import config


class ResultadoIdentificacion:
    def __init__(self, autorizado, modo, nombre=None, identificador=None,
                 puntaje=None, motivo=None, caja=None):
        self.autorizado = autorizado
        self.modo = modo                  # "deteccion" | "verificacion"
        self.nombre = nombre
        self.identificador = identificador
        self.puntaje = puntaje
        self.motivo = motivo
        self.caja = caja                  # (x, y, w, h) de la cara
        self.t = time.time()

    def a_dict(self):
        return {"autorizado": self.autorizado, "modo": self.modo,
                "nombre": self.nombre, "id": self.identificador,
                "puntaje": self.puntaje, "motivo": self.motivo}

    def __repr__(self):
        return "<Identificacion %s %s %s>" % (
            "OK" if self.autorizado else "DENEGADO", self.modo, self.nombre or "")


class IdentificadorReceptor:
    def __init__(self, bus=None):
        self.bus = bus
        if not os.path.exists(config.MODELO_DETECTOR):
            raise FileNotFoundError(
                "Falta el detector de caras en %s" % config.MODELO_DETECTOR)

        self.detector = cv2.FaceDetectorYN_create(
            config.MODELO_DETECTOR, "",
            (config.CAM_ANCHO, config.CAM_ALTO),
            config.DETECTOR_UMBRAL, 0.3, 5000)

        # El reconocedor es opcional: si no esta, se opera en modo deteccion.
        self.reconocedor = None
        self.registrados = []
        if os.path.exists(config.MODELO_RECONOCEDOR):
            try:
                self.reconocedor = cv2.FaceRecognizerSF_create(
                    config.MODELO_RECONOCEDOR, "")
                self.registrados = self._cargar_registrados()
            except Exception as e:
                print("[face_id] reconocedor no cargo, sigo en deteccion:", e)
                self.reconocedor = None

        self.modo = ("verificacion"
                     if (self.reconocedor and self.registrados) else "deteccion")
        self._racha = 0
        self._ultima_identidad = None
        print("[face_id] modo %s%s" % (
            self.modo,
            " (%d receptor(es) registrado(s))" % len(self.registrados)
            if self.registrados else ""))

    # --- registro ---------------------------------------------------------
    def _cargar_registrados(self):
        if not os.path.exists(config.ROSTROS_REGISTRADOS):
            return []
        with open(config.ROSTROS_REGISTRADOS) as f:
            datos = json.load(f)
        for r in datos:
            r["vector"] = np.array(r["vector"], dtype=np.float32).reshape(1, -1)
        return datos

    def registrar(self, frame, nombre, identificador):
        """Guarda el vector facial de un receptor. Requiere el reconocedor."""
        if not self.reconocedor:
            raise RuntimeError(
                "No hay modelo de reconocimiento: descarga sface.onnx primero")
        caras = self._detectar(frame)
        if caras is None or len(caras) == 0:
            raise ValueError("No se detecto ninguna cara en el cuadro")
        if len(caras) > 1:
            raise ValueError("Hay %d caras; registra a una persona sola" % len(caras))

        vector = self._vector(frame, caras[0])
        registro = {"nombre": nombre, "id": identificador,
                    "vector": vector.flatten().tolist(), "t": time.time()}

        existentes = []
        if os.path.exists(config.ROSTROS_REGISTRADOS):
            with open(config.ROSTROS_REGISTRADOS) as f:
                existentes = json.load(f)
        existentes = [r for r in existentes if r["id"] != identificador]
        existentes.append(registro)
        with open(config.ROSTROS_REGISTRADOS, "w") as f:
            json.dump(existentes, f, indent=2, ensure_ascii=False)

        self.registrados = self._cargar_registrados()
        self.modo = "verificacion"
        return registro

    # --- inferencia -------------------------------------------------------
    def _detectar(self, frame):
        h, w = frame.shape[:2]
        self.detector.setInputSize((w, h))
        _, caras = self.detector.detect(frame)
        return caras

    def _vector(self, frame, cara):
        alineada = self.reconocedor.alignCrop(frame, cara)
        return self.reconocedor.feature(alineada)

    def identificar(self, frame):
        """Evalua un cuadro. Exige FRAMES_PARA_CONFIRMAR seguidos para abrir.

        La racha existe para que un reflejo, un poster o un cuadro borroso no
        abran la caja. Una cara que aparece y desaparece no es una persona
        parada frente al dispositivo esperando recibir un organo.
        """
        caras = self._detectar(frame)
        if caras is None or len(caras) == 0:
            self._racha = 0
            self._ultima_identidad = None
            return ResultadoIdentificacion(False, self.modo, motivo="sin cara")

        # La cara mas grande es la persona que esta enfrente, no la del fondo.
        cara = max(caras, key=lambda c: c[2] * c[3])
        rect = tuple(int(v) for v in cara[:4])
        confianza = float(cara[-1])

        # Sin receptor registrado, la presencia de una cara es la autorizacion.
        # Tambien se entra aqui con ISQ_DEMO=1 aunque haya registro, para poder
        # abrir la caja en el escenario si el registro de la cara sale mal.
        if self.modo == "deteccion" or config.MODO_DEMO_CUALQUIER_CARA:
            self._racha += 1
            listo = self._racha >= config.FRAMES_PARA_CONFIRMAR
            return ResultadoIdentificacion(
                listo, "deteccion", nombre="PERSONA PRESENTE",
                puntaje=round(confianza, 3), caja=rect,
                motivo=None if listo else "confirmando %d/%d" % (
                    self._racha, config.FRAMES_PARA_CONFIRMAR))

        # --- modo verificacion ---
        vector = self._vector(frame, cara)
        mejor, mejor_puntaje = None, -1.0
        for r in self.registrados:
            puntaje = self.reconocedor.match(
                vector, r["vector"], cv2.FaceRecognizerSF_FR_COSINE)
            if puntaje > mejor_puntaje:
                mejor, mejor_puntaje = r, puntaje

        if mejor_puntaje < config.SFACE_UMBRAL_COSENO:
            self._racha = 0
            return ResultadoIdentificacion(
                False, "verificacion", puntaje=round(float(mejor_puntaje), 3),
                caja=rect, motivo="no coincide con el receptor")

        if self._ultima_identidad == mejor["id"]:
            self._racha += 1
        else:
            self._racha = 1
            self._ultima_identidad = mejor["id"]

        listo = self._racha >= config.FRAMES_PARA_CONFIRMAR
        return ResultadoIdentificacion(
            listo, "verificacion", nombre=mejor["nombre"],
            identificador=mejor["id"], puntaje=round(float(mejor_puntaje), 3),
            caja=rect,
            motivo=None if listo else "confirmando %d/%d" % (
                self._racha, config.FRAMES_PARA_CONFIRMAR))

    def reiniciar(self):
        self._racha = 0
        self._ultima_identidad = None


# ---------------------------------------------------------------------------
class Camara:
    """Camara CSI IMX219 por nvarguscamerasrc, con respaldo a USB."""

    def __init__(self):
        self.cap = cv2.VideoCapture(config.CAM_PIPELINE, cv2.CAP_GSTREAMER)
        self.origen = "csi"
        if not self.cap.isOpened():
            print("[camara] CSI no abrio, intento USB")
            self.cap = cv2.VideoCapture(0)
            self.origen = "usb"
        if not self.cap.isOpened():
            raise IOError("No hay camara disponible (ni CSI ni USB)")

    def leer(self):
        ok, frame = self.cap.read()
        if not ok or frame is None or getattr(frame, "size", 0) == 0:
            return None
        if config.CAM_FLIP_180:
            frame = cv2.rotate(frame, cv2.ROTATE_180)
        return cv2.resize(frame, (config.CAM_ANCHO, config.CAM_ALTO))

    def cerrar(self):
        try:
            self.cap.release()
        except Exception:
            pass
