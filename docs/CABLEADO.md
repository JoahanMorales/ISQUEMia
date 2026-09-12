# Cableado de la caja ISQUEMIA

Placa: **Jetson Orin Nano Super**, JetPack 6.2 (L4T R36.5.2).
Todo lo de este documento se refiere al **header de 40 pines**, numerado en
modo `BOARD` (el número físico impreso en la placa).

## Lo que ya está montado y funcionando

| Componente | Conexión | Estado |
|---|---|---|
| Cámara CSI IMX219 | conector CSI0 | operativa, entrega 1280x720 |
| PCA9685 (servos) | bus `i2c-7`, dirección `0x40` | operativo, 2 servos |

Verificado con `i2cdetect -y 7` y con `scripts/diagnostico.py`.

---

## 1. LCD 1602A — lo que falta conectar

Hay dos formas, según lo que tenga tu módulo. **Mira la parte de atrás de la
pantalla**: si trae una placa negra pequeña soldada con cuatro pines a un
costado, es la opción A. Si salen 16 pines pelados en fila, es la opción B.

### Opción A — con módulo I²C (PCF8574). Es la que recomiendo.

Cuatro cables. La LCD cuelga del **mismo bus donde ya está el PCA9685**: las
direcciones no chocan (`0x27` la pantalla, `0x40` los servos), y el bus I²C
está hecho justamente para eso.

| Pin del módulo | Pin del header | Nombre |
|---|---|---|
| `GND` | **6** | GND |
| `VCC` | **1** (3.3 V) — lee la advertencia | 3.3 V |
| `SDA` | **3** | I2C1_SDA (bus `i2c-7`) |
| `SCL` | **5** | I2C1_SCL (bus `i2c-7`) |

```
   Jetson Orin Nano, header de 40 pines
   (esquina del pin 1, junto al borde de la placa)

    pin  1 [3.3V] --------> VCC del módulo LCD
    pin  2 [ 5V ]
    pin  3 [SDA ] --------> SDA  ---+--- ya va al PCA9685
    pin  4 [ 5V ]                   |
    pin  5 [SCL ] --------> SCL  ---+--- ya va al PCA9685
    pin  6 [GND ] --------> GND
```

#### Advertencia de voltaje — esto es lo que quema Jetsons

La LCD 1602A quiere **5 V**, pero los pines I²C de la Jetson son de **3.3 V y
no toleran 5 V**. El módulo PCF8574 trae resistencias pull-up conectadas a su
propio `VCC`: si le das 5 V, el bus entero sube a 5 V y te llevas por delante
el SoC **y** el PCA9685 que ya funciona.

Tres caminos, de más simple a más correcto:

1. **`VCC` al pin 1 (3.3 V).** Cero componentes extra, es lo que dice la tabla
   de arriba. El PCF8574 funciona desde 2.5 V, así que el I²C responde bien.
   Lo que sufre es el contraste: la pantalla se ve tenue y el backlight flojo.
   Casi siempre se arregla girando el potenciómetro azul del módulo. **Empieza
   por aquí**: si se lee, ya terminaste.

2. **`VCC` a 5 V (pin 2) + convertidor de nivel I²C bidireccional** (módulo de
   BSS138, de los de cuatro canales). `SDA`/`SCL` del lado alto al módulo, del
   lado bajo a los pines 3 y 5. Es la solución correcta y la que pondría en una
   caja que de verdad viaje.

3. **`VCC` a 5 V y desoldar los dos pull-ups del backpack** (`R8` y `R9`, junto
   al chip). El bus queda sostenido por los pull-ups de 3.3 V de la Jetson. Es
   marginal: el PCF8574 alimentado a 5 V pide 3.5 V para leer un `1` y le vas a
   dar 3.3 V. Suele funcionar y a veces no. No lo elijas si tienes prisa.

#### Comprobación

```bash
i2cdetect -y 7          # debe aparecer 27 (o 3f) junto al 40 que ya estaba
python3 scripts/test_lcd.py
```

Si en `i2cdetect` no sale nada nuevo: revisa `GND` primero, es el 90 % de los
casos. Si sale la dirección pero la pantalla está en blanco con la fila de
arriba en rectángulos negros, **no es el código, es el contraste**: gira el
potenciómetro azul despacio hasta que el texto aparezca.

### Opción B — LCD pelada de 16 pines (modo 4 bits)

Doce cables y un potenciómetro de 10 kΩ. Solo si tu módulo no trae el backpack.

| Pin LCD | Nombre | Va a |
|---|---|---|
| 1 | `VSS` | GND (pin 6) |
| 2 | `VDD` | 5 V (pin 2) |
| 3 | `V0` | patita central del potenciómetro de 10 kΩ |
| 4 | `RS` | **pin 15** |
| 5 | `RW` | GND (pin 9) — **obligatorio**, ver abajo |
| 6 | `E` | **pin 16** |
| 7–10 | `D0`–`D3` | sin conectar (modo 4 bits) |
| 11 | `D4` | **pin 18** |
| 12 | `D5` | **pin 22** |
| 13 | `D6` | **pin 29** |
| 14 | `D7` | **pin 31** |
| 15 | `A` | 5 V a través de una resistencia de 220 Ω |
| 16 | `K` | GND |

El potenciómetro: un extremo a 5 V, el otro a GND, el centro al pin 3 de la LCD.

**Por qué `RW` va forzosamente a GND:** con `RW` a masa la LCD queda en modo
solo escritura y nunca pone tensión en los pines de datos. Así los 5 V de la
pantalla jamás llegan al header. Los 3.3 V que manda la Jetson sí los reconoce
el HD44780 como nivel alto (necesita 0.6 × VDD = 3.0 V), de modo que la
comunicación funciona en un sentido y en el otro no hay riesgo. Si dejas `RW`
al aire o lo conectas a un GPIO, la LCD puede empujar 5 V hacia la Jetson.

Estos seis pines están declarados en `caja/config.py` → `LCD_PINES_GPIO`, y
ninguno choca con el I²C de los servos. Para usar este modo:

```bash
python3 scripts/test_lcd.py            # con ISQ_LCD=gpio en el entorno
ISQ_LCD=gpio python3 -m caja.app
# o bien
python3 -m caja.app --lcd gpio
```

El modo `gpio` **no se autodetecta a propósito**: configurar pines de salida
"funciona" haya o no una pantalla del otro lado, así que elegirlo solo porque
el I²C no respondió daría un falso positivo. Hay que pedirlo a mano.

---

## 2. Sensores pendientes de montar

Ninguno hace falta para la demo: cada uno arranca simulado y el sistema dice
cuál es cuál en el arranque y en la auditoría. Cuando compres uno, lo conectas
y `caja/sensores.py` lo detecta solo — salvo el reed switch, que hay que
declarar con `ISQ_REED=1` porque un pin de entrada al aire lee ruido.

| Sensor | Chip | Bus / pin | Para qué |
|---|---|---|---|
| Temperatura del órgano | DS18B20 | 1-Wire, **pin 7** + pull-up 4.7 kΩ a 3.3 V | el sensor crítico: fuera de 2–8 °C el órgano se compromete |
| Temp. y humedad interna | SHT31-D | `i2c-7`, `0x44` | detecta que el aislamiento se rompió antes de que el órgano se caliente |
| Presión / altitud | BMP280 | `i2c-7`, `0x76` | saber si va en avión sin depender del GPS; despresurización de bodega |
| Acelerómetro | MPU6050 | `i2c-7`, `0x68` | golpes > 3 g y volteo de la caja |
| Luz interior | BH1750 | `i2c-7`, `0x23` | una caja sellada está a oscuras: si entra luz, alguien la abrió |
| Sello de la tapa | reed switch | **pin 7** (o el que quede libre) | redundante con el de luz, a propósito |
| Batería | INA219 | `i2c-7`, `0x41` | la caja tiene que sobrevivir el vuelo sin enchufe |
| GPS | NEO-6M | UART `/dev/ttyTHS1`, 9600 bd | posición y ETA contra el reloj de isquemia |

Todos los I²C van al mismo par de pines 3 y 5. El bus admite los que quepan
mientras no repitan dirección.

Para el GPS hay que dar permiso al puerto serie una sola vez:

```bash
sudo usermod -aG dialout $USER    # y volver a iniciar sesión
```

---

## 3. Servos del pestillo

Ya conectados al PCA9685. La asignación de canales está en `caja/config.py`:

| Canal | Función | Ángulo cerrado | Ángulo abierto |
|---|---|---|---|
| 0 | pestillo (el seguro) | 20° | 160° |
| 1 | tapa (el brazo que levanta) | 15° | 110° |

Son los mismos canales del pan-tilt que ya tenías, reutilizados. Si montas
servos aparte para la caja, cambia `SERVO_CANAL_PESTILLO` y
`SERVO_CANAL_TAPA` a los canales nuevos y ajusta los cuatro ángulos.

**El PCA9685 necesita alimentación propia para los servos** en su borne `V+`
(5–6 V, 2 A o más si son servos de metal). No los alimentes desde el pin 2 de
la Jetson: el pico de arranque de un servo hace caer la tensión y la placa se
reinicia a media demo.

---

## 4. Comprobación completa antes de la demo

```bash
python3 scripts/diagnostico.py     # qué responde y qué falta
python3 scripts/test_lcd.py        # la pantalla sola
python3 scripts/test_apertura.py   # mueve los servos de verdad
```
