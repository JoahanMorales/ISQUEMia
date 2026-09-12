# ISQUEMIA — la caja

Dispositivo de a bordo que acompaña un órgano de donante durante el traslado:
monitorea su estado, lo muestra en una pantalla de 16x2, y al llegar al destino
identifica al receptor con la cámara antes de liberar el pestillo.

Corre sobre una **Jetson Orin Nano Super** con cámara CSI IMX219, PCA9685 con
servos y una LCD 1602A. Es la sección 13 de [`ISQUEMIA.md`](ISQUEMIA.md), la
especificación completa del sistema.

> **Datos sintéticos, no clínicos.** Nada aquí toca información de pacientes
> reales, ni determina muerte, ni pronostica, ni altera una lista de asignación.

## Qué hace hoy

- **Reloj de isquemia** por órgano, con los límites reales de la sección 2.5 de
  la especificación (corazón 4 h, hígado 12 h, riñón 30 h…). El tiempo
  transcurrido se deriva del cross-clamp, nunca se almacena. Alertas al 50 %,
  75 % y 90 % del límite.
- **Nueve sensores** con su chip concreto documentado. Los que no están
  montados corren simulados con una serie determinista por semilla, y el
  sistema dice cuál es cuál en el arranque y en la auditoría.
- **LCD 1602A** con carrusel de seis pantallas: reloj, temperatura del órgano
  contra su rango, ambiente interno, integridad del sello, avance del trayecto
  e identificación del caso. Las excepciones interrumpen el carrusel.
- **Identificación del receptor** con YuNet sobre la cámara CSI. Exige tres
  cuadros consecutivos antes de abrir, para que un reflejo o un cuadro borroso
  no liberen el pestillo.
- **Pestillo y tapa** sobre el PCA9685. `abrir()` no acepta un booleano: exige
  el resultado de identificación completo. Un pestillo que se abre pasándole
  `True` no es un pestillo.
- **Auditoría append-only** en `eventos.jsonl`. Ninguna transición de estado
  ocurre sin su evento. Si no está ahí, no ocurrió.

## Correr

```bash
python3 scripts/diagnostico.py                    # qué hardware responde
python3 -m caja.app --organo rinon_izq --llegada 25
```

Durante la corrida, `ENTER` fuerza la llegada a destino y `Ctrl+C` cierra
dejando la caja sellada y el reloj congelado.

| Opción | Para qué |
|---|---|
| `--organo` | fija el límite de isquemia (`rinon_izq`, `higado`, `corazon`…) |
| `--factor` | acelera el reloj: `60` = un minuto real es una hora de isquemia |
| `--llegada` | segundos reales hasta llegar al destino |
| `--lcd` | `auto`, `i2c`, `gpio` o `sim` |
| `--semilla` | misma semilla, misma corrida |

### Pruebas de hardware

```bash
python3 scripts/test_lcd.py        # la pantalla sola, para ajustar contraste
python3 scripts/test_camara.py     # encuadre: dice si está viendo tu cara
python3 scripts/test_apertura.py   # mueve los servos de verdad
```

## Identificación: dos modos

**Detección** es el que corre hoy: YuNet confirma que hay una persona frente a
la caja y eso autoriza la apertura. No distingue quién es.

**Verificación** queda implementado y solo le falta el modelo. Con
`caja/modelos/sface.onnx` presente y un receptor registrado, compara el vector
facial por similitud coseno y solo abre si supera el umbral:

```bash
curl -L -o caja/modelos/sface.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
python3 scripts/registrar_receptor.py --nombre "Dra. Rivas" --id RX-0912
```

En producción esto no sería una cara sola: sería la credencial del centro más
la biometría más la firma del expediente.

## Cableado

Todo el detalle está en [`docs/CABLEADO.md`](docs/CABLEADO.md), incluida la
advertencia de voltaje de la LCD, que es lo que quema Jetsons.

## Estructura

```
caja/
  config.py           todo parámetro ajustable; pinout y umbrales
  eventos.py          almacén append-only y modo sin red
  reloj_isquemia.py   CIT derivado del cross-clamp, alertas por umbral
  sensores.py         nueve sensores, reales y simulados
  lcd1602.py          driver HD44780: I²C, GPIO 4 bits y consola
  servo_caja.py       pestillo y tapa sobre el PCA9685
  face_id.py          detección y verificación del receptor
  custodia.py         máquina de estados y las pantallas de 16x2
  app.py              programa principal
scripts/              diagnóstico y pruebas de hardware
docs/CABLEADO.md      cómo conectar cada cosa
```
