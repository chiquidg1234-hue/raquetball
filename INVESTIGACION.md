# Investigación: pelotas, canchas, altitud, velocidades, saque y punto de contacto

Hecha el 25-09-2026 para el bloque 0 de `ENCARGO-2AM.md`. Cada número que entra en el
código apunta aquí o lleva su fuente en un comentario. Donde no se encontró dato publicado
se dice, y el valor queda expuesto en el panel **Cancha** para calibrarlo a mano.

---

## 1. Pelotas

### Lo que exige la norma (válido para las tres)

| Dato | Valor | Fuente |
|---|---|---|
| Diámetro | 2 1/4 in = 57.15 mm | [USA Racquetball, regla 2](https://www.usaracquetball.com/play/rules/2-courts-and-equipment), [reglamento IRF en español](https://www.internationalracquetball.com/wp-content/uploads/2019/03/reglamentoirfespa%C3%B1ol.pdf) |
| Masa | ≈ 1.4 oz = 39.7 g | ídem. Ojo: la traducción de la IRF dice "29.75 gramos", que es un error de conversión; 1.4 oz son 39.7 g |
| Dureza | 55–60 durómetro | ídem |
| Rebote | 68–72 in al soltarla desde 100 in, a 70–74 °F (21–23 °C) | ídem |

### Los productos

Gael escribió "gerobox negra azul" y "formila flow azul".

- **Gearbox** vende dos pelotas separadas, una negra y una azul. Por eso "negra azul"
  puede ser cualquiera de las dos, y el catálogo trae las dos.
  - **Sleek Black**: "Comfort, Control and Moderately Paced Rallies". Velocidad: "Fast and
    Smooth". Rebote: "Soft and Consistent". Es la pelota oficial de la IRF y del IRT.
    ([ficha](https://gearboxsports.com/products/racquetball-3-ball-pack-sleek-black))
  - **Electric Blue**: "Speed, Visibility and Aggressive Rallies". Velocidad: "Gearbox's
    Fastest Ball". Rebote: "Lively and Consistent". Es la pelota oficial de USA
    Racquetball. ([ficha](https://gearboxsports.com/products/racquetball-3-ball-pack-electric-blue))
- **Formulaflow Blue**: pelota oficial del IRT. "Balanced Speed: a controlled, lively
  response"; "no es un cohete, ni una pelota pesada que se muere en el piso".
  ([ficha](https://formulaflow.com/products/racquetballs),
  [IRT](https://irttour.com/product/formula-flow-blue-official-ball-of-the-international-racquetball-tour/))

**Ningún fabricante publica diámetro, masa, COR ni altura de rebote medidos.** Solo
publican adjetivos. Lo que hace el código con eso:

- Diámetro y masa: los de la norma, para las tres.
- Rebote: cada pelota se coloca **dentro** del rango legal según el orden que dan sus
  propias fichas: negra "soft" → 69 in, Formulaflow "balanced" → 70 in, azul "fastest"
  → 71 in. **Es una estimación ordinal, no una medida.** El rebote se puede calibrar a mano
  en el panel Cancha (68–72 in).

### COR: la norma, medida con el propio motor

La cuenta de siempre, `COR = sqrt(70/100) = 0.837`, **ignora el arrastre**. Pero el motor
sí tiene arrastre. Con ese COR, el motor suelta la pelota desde 100 in y la ve rebotar a
**64.6 in**: la pelota del simulador **no pasaba la prueba de homologación** (68–72 in).

Con arrastre cuadrático la caída y la subida verticales tienen solución cerrada:

```
v_llegada² = (g/k) · (1 − e^(−2k·h_caída))
v_salida²  = (g/k) · (e^(2k·h_rebote) − 1)
COR        = sqrt( (e^(2k·h_rebote) − 1) / (1 − e^(−2k·h_caída)) )
```

Con el aire de la prueba (nivel del mar, 72 °F), el rango legal pasa a ser
**COR 0.859–0.885** (0.872 para 70 in). Eso es lo que usa ahora el motor, y hay un test
que suelta cada pelota desde 100 in dentro del simulador y comprueba que rebota a su altura.

**Límite conocido:** la prueba es a ~7 m/s. En un tiro real la pelota choca a 30–60 m/s, y
en pelotas de goma huecas el COR baja con la velocidad de impacto (en squash, de 0.63 a
0.28 según la velocidad: [Investigations on Squash Ball Bounce](https://squash.qc.ca/wp-content/uploads/2023/10/Investigations-on-Squash-Ball-Bounce.pdf)).
No hay datos publicados de eso para racquetball, así que el COR sigue siendo constante.

### Temperatura y COR

- Que una pelota fría rebota menos está documentado de forma cualitativa para racquetball
  ([actividad de la ACS con pelotas de racquetball](https://www.acs.org/content/dam/acsorg/education/resources/k-8/science-activities/characteristicsofmaterials/polymers/what-counts-in-bounce.pdf)).
- Los datos cuantitativos que existen son de **squash** (COR10 de 0.33 a 0.47 entre 25 y
  45 °C, [squash.qc.ca](https://squash.qc.ca/wp-content/uploads/2023/10/Investigations-on-Squash-Ball-Bounce.pdf);
  [Lewis et al., Am. J. Phys. 2011](https://doi.org/10.1119/1.3531971)). Una pelota de
  squash está hecha para morir; no se puede trasladar ese número al racquetball.
- **No se encontró ninguna curva publicada de COR contra temperatura para racquetball.**
  El código deja la sensibilidad como parámetro expuesto (**0 %/°C por defecto**) y lo
  dice en el panel. La temperatura sí entra, y con física exacta, en la densidad del aire.

### Presión interna y altitud

- Las pelotas de racquetball **no están presurizadas**: son algo porosas y se igualan con
  la presión de alrededor. Si traes pelotas de la altura y juegas abajo "parecen muertas",
  y al revés. ([RacquetWorld](https://www.racquetworld.com/newsletter/tips/april09_tip.html),
  [Racket Rampage](https://racketrampage.com/racquetball-ball-guide/))
- En squash, que es la pelota hueca parecida mejor estudiada, el aire de dentro aporta
  un tercio de la fuerza de compresión pero **casi nada de la pérdida de energía**: el
  rebote lo decide la goma ([Lewis et al. 2011](https://doi.org/10.1119/1.3531971)).
- **Conclusión:** una pelota aclimatada (la que ya lleva un rato en la ciudad) no tiene
  diferencia de presión que valga, así que el efecto es **despreciable** y no se modela.
  El efecto real es **transitorio**: una pelota recién llegada de otra altitud. Su tamaño
  no está publicado, así que tampoco se modela; queda escrito aquí.

---

## 2. Canchas: "de placa" y "las normales"

- **No se encontró ninguna fuente que defina "cancha de placa" para racquetball.** En
  Colombia "placa deportiva" es una losa de concreto; en construcción, "placa" también es
  un panel prefabricado. Hay dos lecturas posibles y el panel las trae las dos con nombre
  descriptivo, para que Gael elija la que corresponde:
  - **Paneles prefabricados** (melamina sobre aglomerado de alta densidad, tipo
    Fiberesin): el sistema que se inventó para racquetball en EE.UU. Frontal de 1 1/8–1 1/2
    in, laterales de 7/8–1 1/8 in, sobre montantes de acero.
    ([especificación Fiberesin](https://img1.wsimg.com/blobby/go/88bdc3e7-c96f-41dc-8187-df22839de640/downloads/fiberesin-specifications.pdf?ver=1775659917051),
    [Allied Products](https://racquetball-court-installation-construction-builders.com/pdf_downloads/RaquetballBrochure-sml.pdf),
    [squashfacilities.com](https://www.squashfacilities.com/solid-courts))
  - **Revoque sobre mampostería/hormigón**: el estándar del siglo XX, "superficie lisa y
    uniforme que asegura un rebote consistente"; USG especifica yeso muy duro para
    aguantar impactos de hasta 1500 psi.
    ([USG PM14](https://www.usg.com/content/dam/USG_Marketing_Communications/united_states/product_promotional_materials/finished_assets/plastering-lathing-and-plastering-specifications-for-handball-and-racquetball-courts-en-PM14.pdf),
    [squashfacilities.com](https://www.squashfacilities.com/solid-courts))
- **Cuánto cambia el rebote:** no hay una sola medida publicada con pelota de racquetball.
  - La patente de paneles afirma que su superficie "devuelve la pelota **igual** que una
    de hormigón" ([US 4068840](https://patents.justia.com/patent/4068840)).
  - Los fabricantes solo hablan de "rebote uniforme y predecible".
  - Del **cristal** hay dos fuentes con la misma dirección: más rápido (en pádel,
    [Gea García et al. 2021](https://ideas.repec.org/a/taf/rpanxx/v21y2021i2p226-241.html);
    en squash, ["slightly faster bounce"](https://www.racquetsports.institute/post/squash-court-types-best-practice-series-on-what-makes-courts-different)).
    Ninguna da un número para racquetball.
  - Por eso **todas las superficies arrancan con el mismo COR y la misma restitución
    tangencial**, y el panel deja calibrar el factor de COR y la restitución tangencial de
    paredes y piso. La hipótesis del encargo ("el hormigón devuelve más y raspa más") no
    tiene respaldo publicado; no se codifica como dato.
- **Bolivia:**
  - Complejos con varias canchas: Sucre (Estadio Patria, 14 canchas de los Bolivarianos
    2009, [nota](https://deportesbolivia.blogspot.com/2019/01/raquetbol-refaccion-que-dejo-destruccion.html);
    complejo "Conrrado Moscoso", 6 canchas, [GAMS](https://sucre.bo/entregan-oficialmente-el-complejo-municipal-de-raquetas-kevin-conrrado-moscoso/)).
  - Cochabamba: Country Club con 8 canchas, una de cristal tipo estadio
    ([Country Club Cochabamba](https://www.countryclubcba.com/deportes/raquetbol-paleta-squash/)).
  - La Paz: complejo municipal de San Antonio.
  - Ninguna de esas fuentes dice de qué están hechas las paredes. **No se pudo confirmar
    la superficie de las canchas bolivianas.**

---

## 3. Altitud y aire

### Fórmula

Atmósfera estándar (U.S. Standard Atmosphere 1976, capa 0, válida hasta 11 km),
[fórmula barométrica](https://en.wikipedia.org/wiki/Barometric_formula):

```
P(h) = 101 325 Pa · (1 − 0.0065 · h / 288.15) ^ 5.25588
ρ    = P / (287.05 · T)        (aire seco, gas ideal; T en K)
k    = 0.5 · ρ · Cd · A / m    (arrastre: a = −k·|v|·v)
```

- La presión sale de la altitud con la atmósfera estándar.
- La densidad usa la **temperatura real de la cancha**, no la estándar.
- Resultado a 20 °C: nivel del mar 1.204 kg/m³, Santa Cruz 1.146, Tarija 0.961,
  Cochabamba 0.881, Sucre 0.856, La Paz 0.768, El Alto 0.718. En El Alto el arrastre es
  un 37 % menor que en Santa Cruz.
- A nivel del mar y 20 °C da ρ = 1.2041 kg/m³, igual que la tabla de
  [Density of air](https://en.wikipedia.org/wiki/Density_of_air), y k = 0.01945 1/m. El
  valor 0.0194 del spec salía de redondear ρ a 1.20.
- La presión real varía con el tiempo meteorológico, y en los Andes tropicales suele
  estar un poco por encima de la estándar. Por eso el panel admite una presión medida
  (hPa) que sustituye a la estándar.
- La humedad baja la densidad alrededor de un 1 % en un día caluroso y húmedo; no se modela.

### Ciudades

| Ciudad | Encargo | Confirmada | Fuente |
|---|---|---|---|
| Santa Cruz de la Sierra | 416 m | **416 m** | INE, vía [UB Comercio Exterior](https://www.comercioexterior.ub.edu/fpais/bolivia/Ciudades.htm) |
| Tarija | 1 875 m | **1 866 m** | ídem (Wikipedia da 1 834 m) |
| Cochabamba | 2 558 m | **2 558 m** | ídem |
| Sucre | 2 810 m | **2 790 m** | ídem y [Wikipedia](https://es.wikipedia.org/wiki/Sucre) |
| La Paz | 3 640 m | **3 640 m** | ídem (Plaza Murillo 3 636 m) |
| El Alto | 4 150 m | **4 150 m** | [Wikipedia](https://es.wikipedia.org/wiki/El_Alto); el aeropuerto está a 4 058 m ([AIP SLLP](https://www.bo.ivao.aero/downloads/cartas/SLLP.pdf)) y el atlas municipal da 4 050 m de media ([Atlas de El Alto](https://biblioteca.gregorias.org.bo/repositorio/pmb_documents/1_Atlas_de_El_Alto.pdf)) |

Tarija y Sucre se corrigen a lo que da el INE.

### Arrastre y número de Reynolds

- Cd = 0.5 es el valor de una esfera lisa en régimen subcrítico (Re ≤ 2·10⁵).
- La "crisis de arrastre" (Cd cae a ~0.1) llega hacia Re ≈ 3·10⁵
  ([TU Delft](https://repository.tudelft.nl/file/File_9aa530b6-75d1-45f9-aae8-af959cea95dd),
  [WSU](https://ssl.wsu.edu/documents/2015/10/drag-on-sports-balls-using-doppler-radar.pdf/)).
- Una pelota de racquetball a 85 m/s a nivel del mar está en Re ≈ 3.2·10⁵, en el borde de
  esa crisis. En El Alto, con aire más fino, el Re baja casi un 40 % (1.9·10⁵ a 85 m/s).
- **No existe medida publicada del Cd de una pelota de racquetball**, así que Cd sigue
  en 0.5. El panel muestra el Re del tiro para que se vea cuándo esa suposición está en
  el límite.

---

## 4. Velocidades

Todas las lecturas publicadas son de **radar**. Después del golpe la pelota solo pierde
velocidad (arrastre, y el 13 % en la frontal), así que el pico que marca el radar es la
velocidad **a la salida de la raqueta**, que es justo lo que el simulador llama `speed`.

Fuente principal: [Pro Racquetball Stats, Todd Boss, 2023](https://blog.proracquetballstats.com/index.php/2023/01/26/so-just-how-fast-is-the-fastest-ever-recorded-racquetball-hit/).

| Lectura | mph | m/s | Fiabilidad según la fuente |
|---|---|---|---|
| Concurso Spalding 1995 (8 pros) | 142–164 | 63.5–73.3 | publicado en Racquetball Magazine |
| US Open 2002 (4 pros) | 164–171 | 73.3–76.4 | "solid" |
| US Open 2003 (4 pros) | 175–181 | 78.2–80.9 | testimonio de un participante |
| Fredenberg, US Open 2001 | 186 | 83.1 | prensa, "pretty reliable" |
| Baker, San José | 190 | 84.9 | "pretty likely" |
| Inoue 191, Reiff 200, Monchik 210 | — | — | "doubtful" |
| Pro de hoy, mínimo | ~140 | ~62.6 | medido por el autor |
| Pegadores fuertes de hoy | ~150 | ~67 | ídem |
| Jugador "low open" | 133 | 59.5 | ídem (una sola medida) |

Correcciones a la tabla del spec:

- **Saque pro 75–85 m/s estaba alto**: eso son 168–190 mph, nivel récord. Un saque pro
  normal está en 63–72 m/s.
- **Saque amateur**: la única medida es 59.5 m/s (un jugador open).
- **Peloteo y drive** (30 y 48 m/s): **no hay dato medido publicado**; se mantienen como
  estimación y así se marcan.
- **Máximo del slider**: 85 m/s (~190 mph, la lectura más alta creíble). Antes era 90.

---

## 5. Reglas del saque

[Reglamento IRF](https://www.internationalracquetball.com/wp-content/uploads/2019/03/reglamentoirfespa%C3%B1ol.pdf):

- **3.3 Manera:** "El servicio comienza en el momento en que la bola deja la mano del
  servidor. La bola debe rebotar en el piso en la zona de servicio y después del primer
  rebote ser golpeada por la raqueta del servidor."
- **3.8(f):** botarla fuera de la zona de saque como parte del movimiento es **falta**.
- **3.9(b):** fallar el golpe es **servicio fuera**.

De ahí la regla del simulador: si al llegar el golpe la pelota ya dio su segundo bote,
no se golpeó "después del primer rebote", y el saque es falta. El bote de la mano no es
un bote del tiro: la numeración 1, 2, 3 empieza después del golpe.

---

## 6. Punto de contacto: derecha y revés

- Derecha: "contact is made with the ball at **front heel**"
  ([Racquetball Ireland](https://www.racquetball.ie/uploads/2/9/5/3/2953375/racquetball_ireland_coaching_the_fundamentals.pdf)).
- Revés: la misma guía dice lo mismo, "at front heel". Rocky Carson lo pone "**just in
  front of leading foot**" ([racquetball-lessons.com](https://racquetball-lessons.com/topics/stroke-techniques/backhand-stroke/)).
- Una guía universitaria dice para el revés "just as in the forehand, you want to contact
  the ball off the front foot" ([W&M](https://cemood.people.wm.edu/racquetball/swing/stroke_tutorial_2006.html)).

**El encargo decía que el contacto de la derecha va más adelantado que el del revés. Las
fuentes no lo respaldan.** Dicen que los dos van a la altura del pie adelantado, y un pro
pone el del revés un poco **más** adelante, no más atrás. El modelo 3D pone la derecha a la
altura del talón delantero y el revés justo delante de la punta del pie adelantado. No
existe una distancia en centímetros publicada, así que el pie se dibuja como referencia
visual, marcado como aproximado.

---

# Segunda ronda (26-09): efecto, rollout, saque, raqueta

Gael encontró que el simulador "calcula mal los tiros": el Z no hace su efecto, el
tiro al crack no sale rollout, el bote de saque no es un movimiento propio y la raqueta
no enseña cómo se pega. Todo lo de abajo son cuentas antes de programar.

## 7. El efecto (spin) en los rebotes

### El modelo físico

Hasta ahora el motor aplicaba a la velocidad paralela a la pared un factor fijo
(0.65) y la pelota no giraba. Eso no es física. Los rebotes oblicuos de pelotas de goma
se describen con un modelo de impulsos con fricción, "agarre o deslizamiento"
([Cross 2002, Grip-slip behavior of a bouncing ball](https://www.physics.usyd.edu.au/~cross/PUBLICATIONS/GripSlip.pdf);
[Cross 2002, horizontal COR](https://physics.umd.edu/courses/Phys405/Hill/Fall05/Information/AJP/AJP00482.pdf)):

```
n  = normal de la superficie (hacia la cancha),  r = −R·n  (del centro al contacto)
u  = v + ω × r                  velocidad del punto de contacto
Jn = m·(1 + e)·|v·n|            impulso normal (e = COR, 0.872)
Jt(agarre) = −m·α·(1 + eₓ)·u_t / (1 + α)      deja el punto de contacto en −eₓ·u_t
si |Jt(agarre)| > μ·Jn  →  desliza:  Jt = −μ·Jn·û_t
v' = v + (Jn·n + Jt)/m        ω' = ω + (r × Jt)/(α·m·R²)
```

- **α = I/(mR²)** de un cascarón esférico grueso ([PNAS 2025, SI, ec. 8](https://arxiv.org/html/2503.03906v1)):
  `α = (2/5)·(1 − (1−2T/D)⁵)/(1 − (1−2T/D)³)`. La pared no está publicada: con la masa
  (39.7 g), el diámetro (57.15 mm) y un compuesto de goma de 1.1–1.2 g/cm³ sale
  T ≈ 3.7–4.1 mm. Con T = 3–5 mm, α = 0.60–0.56: **α = 0.58**. (Macizo: 0.4; cáscara
  fina: 0.667.)
- **eₓ y μ, medidos con una pelota de racquetball de verdad**
  ([Illouz 2014, 600 fps](https://www.isjos.org/pdfs/ISJOS_v8_p5.pdf)): soltada desde
  70.3 cm (3.71 m/s) sobre madera inclinada, gira a **ω = (81 ± 10)·sin θ rad/s** y no
  desliza hasta ~50–60°; a 80° el giro solo cae ~10 %.
  - Con el modelo, el giro al agarrar es `ω = (1+eₓ)·v·sin θ/((1+α)R)` = (1+eₓ)·82 sin θ.
    El dato da **eₓ ≈ 0 ± 0.12**. Cross da 0.1–0.2 para una pelota de tenis. Se usa **eₓ = 0.05**.
  - Deslizar a 80° perdiendo solo un 10 % de giro exige **μ ≈ 1.0**; con μ = 0.5 perdería
    el 60 %. Se usa **μ = 0.9** en paredes y piso (goma sobre superficie dura; Cross mide
    μ ≥ 0.9 para una superbola). Es calibrable por superficie.

### El efecto del Z, con números

Lo que describe Gael está documentado: el Z-ball "rebounds almost parallel to the back
wall because of the spin" ([racquetballrules.us](https://www.racquetballrules.us/racquetball-shots/)),
y en las laterales "the angle of incidence does not equal the angle of reflection; after
repeated bounces it moves at a normal to the wall"
([Physics Forums](https://www.physicsforums.com/threads/racquetballs-strange-bouncing-patterns.483866/)).

El modelo lo predice sin ajustar nada:

1. **Primera lateral** (sin giro previo): la pelota agarra. La velocidad a lo largo de la
   pared baja a `1 − α(1+eₓ)/(1+α)` = **61 %** y la pelota sale girando alrededor del eje
   vertical, con `Rω = 0.61·v_t`.
2. **El piso no toca ese giro**: el punto de contacto con el piso está en el eje vertical,
   así que ω_y no mueve ese punto y la fricción del piso no lo frena.
3. **Segunda lateral** (la opuesta): el punto de contacto está al otro lado de la pelota,
   así que ahora el giro **se suma** al deslizamiento: `u_t = v_t + 0.61·v_t = 1.61·v_t`.
   La velocidad a lo largo de la pared queda en `1 − α(1+eₓ)·1.61/(1+α)` = **38 %** de la
   que traía, mientras la normal conserva el 87 %.
4. Una pelota que llega a 45° sale a **~23°** de la normal en vez de a 45°: casi
   perpendicular a la lateral, es decir **casi paralela a la trasera**.

**Lo que da el motor (ronda 2, `src/core/spin.ts`).** La cuenta de arriba supone que la
pelota llega a la segunda lateral a 45°. Con la pelota cruzando la cancha de verdad
(de lateral a lateral, sin aire ni gravedad, 45° en la primera) sale de la segunda a
**9.1°** de la normal, y el motor lo reproduce a 10⁻⁶ grados (`tests/spin.spec.ts`):
izquierda → la paralela queda en 0.6146·v y el punto de contacto gira a −0.6646·v; en la
derecha ese giro se suma, u = 1.2791·v, la paralela queda en 0.1215·v y la normal en
e²·v = 0.7607·v → atan(0.1215/0.7607) = 9.1°. Sin efecto (0.65 fijo): 29°. Con reflexión
ideal: 45°. En el Z serve de la biblioteca sale a **~8°**.

**Por qué el Z solo sale desde un costado.** Frontal y lateral en la esquina hacen de
retrorreflector: la pelota vuelve **paralela a como vino** (cada pared cambia una
componente; con agarre, las dos por el mismo factor). Desde el centro de la zona de saque
esa paralela llega a la pared del fondo antes de cruzar la cancha; desde ~1.3 m (4 ft)
de la lateral contraria cruza, bota al fondo pegada a la otra lateral y la toca. Esa
posición sale de la geometría, no de una fuente: las guías que se pudieron leer no dan
la distancia. El resultado sí coincide con
[racquetball-lessons.com](https://racquetball-lessons.com/2011/01/15/z-serves-and-court-positioning/):
"a properly executed z-serve will land deep into a corner and near a sidewall, and because
of the spin on the ball, will come out mostly parallel to the back wall".

**Techo y pared del fondo.** El mismo modelo explica dos cosas que se ven en cancha:
- La *ceiling ball*: el techo la hace rodar hacia la frontal, y llega a la frontal
  "ya rodando" pared abajo: no pierde velocidad vertical, bota fuerte y sube. Por eso
  hay que tocar el techo cerca de la frontal (a 60 cm, "1-3 ft") y sin mucha fuerza.
- Un bote rasante desliza y sale con efecto liftado; ese efecto, contra la pared del
  fondo, hace **trepar** la pelota. Las guías lo describen al revés, desde el que
  golpea: la pelota sin efecto "may bounce and carry all the way to the back wall to
  spring way off", la liftada "tumbles over… to stay down"
  ([Racquetball Techniques](http://www.racquetballtechniques.com/topspin-at-its-very-best/)).
  El tamaño del salto depende de μ del piso, medido solo a baja velocidad: se calibra en
  el panel Cancha.

**Rodar.** Tras un nick, o cuando ya casi no bota, la pelota va pegada al piso: el aire y
la rodadura la frenan (a = F/(m(1+α)), porque el piso la obliga a seguir rodando). La
resistencia a la rodadura no está medida para racquetball: la de una pelota de tenis en
tres pistas es 0.04 ± 0.005 aplastada con 37 N por pelota
([Cross 2003, Sports Engineering](https://link.springer.com/article/10.1007/BF02903531));
una lisa que rueda con su propio peso (0.39 N) se aplasta mucho menos: se usa **0.02**
(estimación). Rodando contra una pared toca pared y piso a la vez, como en el nick: las
dos fricciones se oponen y sale en horizontal, sin saltar.

### Magnus en vuelo: no se modela, y por qué

A los números de Reynolds del racquetball (1–3·10⁵) una esfera lisa está en la zona
crítica: la sustentación por giro puede ser positiva, nula o **negativa** (Magnus
inverso) según el giro y la velocidad
([Kim et al., JFM 2014](https://doi.org/10.1017/jfm.2014.428)). No hay ninguna medida
con pelota de racquetball, y los efectos que describe Gael ocurren en los contactos. Se
deja fuera del vuelo y se dice aquí. El giro en vuelo se conserva (su frenado en 1–2 s es
pequeño y tampoco está medido).

## 8. El rollout al crack (nick)

[Ravisankar et al., PNAS 2025, "The mechanics of the squash nick shot"](https://www.pnas.org/doi/10.1073/pnas.2505715122)
([arXiv con el apéndice](https://arxiv.org/html/2503.03906v1)) midieron con cañón de aire y
5000 fps por qué la pelota sale rodando. La pelota tiene que tocar **primero la pared**,
con el centro a una altura **0.6 < H/D < 0.75**. Mientras está aplastada contra la pared
rueda hacia abajo sobre ella; si toca el piso **antes de terminar de rodar**, las dos
fricciones se oponen, el giro y la velocidad vertical se anulan y la pelota sale **en
horizontal, sin bote**. El criterio es `τ = t_rodadura / t_contacto < 1`:

```
t_c = 3.29·(m²/(D·E²·U₀·cos θ₀))^(1/5)        contacto de Hertz
t_r = H·(4κ+1)/(U₀·sin θ₀ + 2κ·D·ω₀)          κ = α/4
τ   = β·H*·Ca^(2/5)·(cos θ₀)^(1/5)/(sin θ₀ + 2κω*),   Ca = E/(ρ_bola·U₀²)
```

Para racquetball: β = 0.623 (con κ = 0.1455), ρ_bola = 6m/(πD³) = 406 kg/m³, y la banda
H* = 0.6–0.75 es un centro a **34–43 mm** del piso (el borde inferior a 6–14 mm).

- **E (rigidez efectiva) no está publicada para racquetball.** En el paper E sale de la
  compresión de la pelota: `E = 4k/(πD)`. Comprobación: la rigidez homologada de la
  pelota de squash (3.2 N/mm) da 102 kPa, igual que su medida (99–105 kPa). Para
  racquetball se estima **k ≈ 2 N/mm → E ≈ 45 kPa**: una pelota más grande, de pared
  relativamente más fina y claramente más fácil de apretar con la mano. Es una
  estimación, y se puede calibrar.
- Con E = 45 kPa, a 40 m/s y H* = 0.65 hace rollout si baja con **θ₀ ≳ 8–10°**. Un kill
  plano desde la rodilla baja a unos 3°: τ ≈ 2.6, así que no hace nick, pero la
  fricción de la frontal le quita el 38 % de la velocidad vertical y lo convierte en
  efecto hacia delante, y sale rasante.

**Qué tiros hacen nick en el motor** (apuntados a la franja con `src/core/aimWall.ts`,
que resuelve con el mismo motor hasta 1 mm):

| Tiro | Condición | τ |
|---|---|---|
| Saque al crack (frontal → lateral a 8.5 m) | 25–35 m/s desde la zona de saque | 0.74–0.94 → **rollout** |
| Saque al crack, más fuerte | 38–45 m/s | ≥ 1: rebota normal |
| Kill al crack desde la cintura (1.1 m) | 40–45 m/s desde 5.5–8 m | 0.85 → **rollout** |
| Kill al crack desde la rodilla (0.45 m) | cualquier velocidad | 1.8: no sale nunca |

El saque al crack sale con facilidad porque la pelota llega a la lateral con poca
velocidad **hacia ella** (contacto largo) y bajando: en el plano de la lateral el ángulo
es grande. El kill necesita bajar: desde la rodilla llega demasiado plano. Todo esto
escala con E, que no está medida: con una pelota más blanda salen más rollouts.

## 9. El bote de saque es su propio movimiento

- La regla (USAR 3.x, [texto oficial](https://www.usaracquetball.com/play/rules/3-play-regulations)):
  "after the ball leaves the hand, it must bounce on the floor in the service zone and
  then, without the ball touching anything else, be struck by the racquet before the
  ball bounces on the floor a second time". Sacar sin bote ("tossing the ball into the
  air") es falta.
- Técnica: Cliff Swain, "drop the ball, don't bounce it"
  ([racquetball-lessons.com](https://racquetball-lessons.com/2015/02/06/cliff-swains-racquetball-drive-serve/));
  Rocky Carson suelta la pelota "off front foot" y da un paso largo hacia ella
  ([RacquetWorld](https://store.racquetworld.com/mm5/merchant.mvc?Category_Code=RockyVideoTip3&Screen=CTGY));
  para cambiar la dirección se suelta 8–12 in más atrás
  ([racquetball-lessons.com](http://racquetball-lessons.com/2016/12/09/hitting-drive-serves-to-forehand-side/)).
- Consecuencia para el modelo: el lanzamiento tiene su propio punto de suelta, su
  dirección (adelante, en diagonal) y su fuerza. **El punto de contacto (x, y, z) sale de
  dónde está la pelota al golpearla**, no de un slider.

**Las cuentas del lanzamiento** (mismo motor, aire y piso con efecto; `tests/serveToss.spec.ts`):

| Lanzamiento desde 1.0 m | Bota | Golpe (fase 0.8, subiendo) |
|---|---|---|
| Soltarla (0 m/s) | debajo de la mano | encima del bote, a ~0.72 m |
| 1 m/s a 45° hacia abajo (por defecto) | 0.27 m por delante: t = 0.38 s | ~0.40 m por delante, a ~0.73 m |
| 2.5 m/s a 45°, 30° a la derecha | 0.45 m por delante | 0.87 m desde la mano, 0.43 m a la derecha |
| 4 m/s a 15° | 1.35 m por delante | 2.05 m por delante: desde el centro de la zona, **bota fuera** |

La primera fila de la tabla sale de t = (−v·sen θ + √((v·sen θ)² + 2·g·h))/g con
h = 0.97 m (centro de la pelota a un radio del piso). En el piso la pelota agarra: le
queda el 61 % de lo que iba hacia delante y sale con efecto liftado, por eso después del
bote avanza menos de lo que avanzó en el aire. Lanzarla más fuerte mueve el golpe hacia
delante, y puede sacarla de la zona de saque (falta, IRF 3.8 f). Si toca una pared antes
del golpe, también es falta ("without the ball touching anything else").

## 10. La raqueta: Gearbox AXS

"La axes" es la **serie AXS** de Gearbox, lanzada en julio de 2026
([Gearbox](https://gearboxsports.com/pages/axs-series), [JT-RB](https://jt-rb.com/axs-series/)).
Conrrado Moscoso juega la **AXS 170 Teardrop**.

| Dato (AXS 170 Teardrop) | Valor | Fuente |
|---|---|---|
| Peso sin cordaje | 170 g | [Gearbox](https://gearboxsports.com/products/axs-170-teardrop-blue) |
| Balance | 13 mm hacia la cabeza | ídem |
| Cordaje | monofilamento 18 g, transparente | ídem |
| Superficie encordada | 107 in² (0.069 m²) | [RacquetWorld](https://store.racquetworld.com/gearbox-axs-170-teardrop-blue-purple-racquetball-racquet.html) |
| Largo | 22 in (máximo reglamentario; GX1 de Gearbox, 22 in) | [RacquetGuys](https://racquetguys.ca/products/gearbox-gx1-170-quadraform) |
| Teardrop | "higher sweet spot" | Gearbox |
| Quad | "expanded sweet spot" | RacquetWorld |

Gearbox no publica ni el ancho de la cabeza ni el patrón de cuerdas de la AXS (la GX1
era 14×19), ni la inercia. **Se modela, y se dice en pantalla:** el medio ancho del
encordado sigue sin(π t^1.5)^0.45 (t = 0 en la garganta, a 16.5 cm de la punta del mango;
lo más ancho al 63 % de la cabeza, que es lo que hace a una lágrima). Pidiendo exactamente
los 107 in² publicados sale un encordado de **25.0 cm** de ancho. La masa se reparte en
mango (varilla), marco (a lo largo del borde) y cuerdas (placa); el reparto mango/marco
sale de pedir el balance publicado, y de ahí se integran el centro de masas y la inercia:

| Sale del modelo | Valor |
|---|---|
| Reparto (170 g sin cordaje) | mango 45 g, marco 125 g; + 18 g de cuerdas = 188 g |
| Centro de masas, encordada | 30.0 cm desde la punta del mango (29.2 sin cordaje = 27.9 + 1.3) |
| Inercia respecto al centro de masas | 0.00508 kg·m² (a 10 cm del mango: 126 kg·cm²) |
| Cabeza (encordado) | de 16.5 a 54.7 cm |

**Dónde pegarle, con física de impacto**
([Cross, impacto de implementos](https://www.physics.usyd.edu.au/~cross/PUBLICATIONS/24.%20ObliqueImpact.PDF)).
El punto de máxima salida no es el centro de la cabeza:

```
masa efectiva en el punto x:   1/Mₑ = 1/M + (x − x_cm)²/I_cm
COR aparente:                  e_A = (e·Mₑ − m)/(Mₑ + m)
salida (saque, bola casi quieta):  v = (1 + e_A)·Ω·(x − x_pivote)
```

Hacia la punta la raqueta va más rápida (Ω·x) pero su masa efectiva cae. El máximo
queda en la mitad superior de la cabeza de una raqueta cargada de cabeza, justo lo que
Gearbox llama "sweet spot más alto". Con la raqueta de arriba:

| Punto (desde la punta del mango) | Dónde | Qué pasa ahí |
|---|---|---|
| **Centro de percusión**, pivote en la mano (7 cm) | **41.8 cm** | la mano no recibe tirón: x_cop = x_cm + I/(M(x_cm − x_p)) |
| Centro de percusión, pivote en la muñeca / el codo | 37.7 / 34.2 cm | se acerca al centro de masas cuanto más lejos gira |
| **Punto de más salida**, golpe de muñeca | **47.7 cm** | máximo de v/Ω |
| Punto de más salida, brazo entero | 41.0 cm | ídem, pivote en el codo |
| Masa efectiva: centro de percusión / a 2 cm de la punta | 124 g / 65 g | por eso la punta "no sale" |

En la app se elige dónde pegarle (centro de percusión, punto de más salida con muñeca o
con brazo) y se ve en la raqueta: verde el centro de percusión, naranja el de más salida.

**Velocidad de cabeza.** No hay medida publicada para racquetball, pero se deduce:
V = v (Mₑ + m)/((1 + e) Mₑ), con e = 0.85 pelota–cuerdas (no medido; el COR de la prueba
de la pelota). Para sacar a 67 m/s (150 mph) la raqueta tiene que ir a **47.8 m/s** en el
centro de percusión, y a **58.4 m/s** si se le pega a 2 cm de la punta; un drive a 28 m/s
pide 20.0 m/s. Es del orden del smash de bádminton, 52–56 m/s
([King et al.](https://mdpi-res.com/d_attachment/applsci/applsci-10-01248/article_deploy/applsci-10-01248.pdf?version=1581582279)).

**Slice.** Un golpe cortado es la cara abierta un ángulo β y moviéndose en oblicuo
respecto a su normal: a Vₙ (la velocidad de cabeza de arriba) en la normal y a
Vₜ = Vₙ tan β a lo largo de la cara. La pelota, casi quieta, agarra en las cuerdas como
en una pared (§7): R ω = (1 + eₓ) Vₜ/(1 + α), salvo que la fricción no alcance
(R ω ≤ μ v/α, con μ = 0.4 pelota–cuerdas: en tenis 0.3–0.5, sin medida en racquetball).

| Pelota a 45 m/s, golpe en el centro de percusión | Vₜ | Giro |
|---|---|---|
| cortado 10° | 5.7 m/s | 1260 rpm |
| cortado 20° | 11.7 m/s | 2590 rpm |
| cortado 30° | 18.5 m/s | 4110 rpm |

Crece lineal con la velocidad de la pelota (a 28 m/s y 20°: 1610 rpm) y no resbala hasta
β ≈ 55°. Liftado (β < 0) es lo mismo al revés. Ese giro viaja con el tiro y cambia cada
rebote (§7); el corte hace que la parte de abajo de la pelota vaya hacia delante, el mismo
sentido que ayuda al nick (§8). La dirección y la velocidad del tiro las sigue poniendo el
jugador: el corte solo añade el giro.

**La animación del golpe** (atrás 110° en 0.28 s, acompañamiento 70° en 0.15 s, girando en
el hombro) es para enseñar el gesto, no una medida; los pies, también aproximados.

## 11. El COR baja con la velocidad del impacto

La prueba de homologación mide el COR a **6.9 m/s** (100 in, con aire). En la frontal
se llega a 40–60 m/s. Toda pelota hueca de goma medida rebota **menos** cuanto más fuerte
llega: se aplasta más, la pared se dobla hacia dentro y pierde energía
([Cross, "Impact behavior of hollow balls"](https://www.researchgate.net/publication/262990295_Impact_behavior_of_hollow_balls);
[Haake, Carré y Goodwill 2003](https://doi.org/10.1080/0264041031000140329): "the
coefficient of restitution reduced with velocity for impacts on a rigid surface").

**De racquetball no hay ninguna medida a velocidad de juego** (solo caídas: 0.87–0.90
desde 3.5 ft con cámara de 1200 fps,
[Krieg](https://www.slideserve.com/kenyon-anderson/lab-2-bouncing-ball-supplemental-testing-powerpoint-ppt-presentation),
lo mismo que nuestro 0.872). Las pelotas análogas medidas contra pared rígida:

| Pelota | Rango | Pendiente | Fuente |
|---|---|---|---|
| Squash (Dunlop doble punto amarillo, 25 °C) | 13–29 m/s | COR = 0.47 − 0.0076·v | [ISJOS v13](https://www.isjos.org/pdfs/ISJOS_v13_p4.pdf) |
| Tenis contra raqueta fija | 13–36 m/s | −0.009 por m/s | [ISJOS v9](https://www.isjos.org/pdfs/ISJOS_v9_p3.pdf) |

**Modelo:** COR(vₙ) = COR·(1 − λ·(vₙ − 6.9)) por encima de la velocidad de la prueba,
con **λ = 0.92 % por m/s** (0.008 sobre 0.872, la pendiente de las análogas), y
**congelado a 40 m/s** (0.606): más allá no hay medidas de nada parecido y la recta
llevaría el COR a cero. Es multiplicativo para que una superficie calibrada muerta no
pase a negativo, depende de la velocidad **normal** (es la que aplasta la pelota) y
es calibrable en el panel Cancha (0 = COR constante, como antes). Es una estimación.

**Qué cambia en cancha:** la pelota sale de la frontal a ~61 % en vez de a ~87 % en los
tiros fuertes. Un pase a 28 m/s con la frontal a 0.8 m bota a ~5 m y da el segundo bote
a 11.5 m en el rincón, antes de la pared del fondo; con el COR constante, cualquier pase
fuerte llegaba a la pared del fondo y volvía hasta la frontal.
