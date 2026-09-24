# Racquetball Trajectory Lab — Especificación de construcción

> Documento autocontenido. Claude Code debe poder ejecutarlo sin contexto previo de la conversación.
> Autor del proyecto: Gael. Versión del spec: 1.0.

---

## 1. Qué es esto

Un **simulador web de trayectorias de racquetball**. El usuario define un tiro (dónde está parado, a qué punto de la pared le apunta, con cuánta fuerza) y la app dibuja la trayectoria completa con todos sus rebotes, simultáneamente en **una vista 3D** y en **tres vistas 2D ortográficas** de pizarra táctica.

Dos usos, en este orden de prioridad:

1. **Herramienta de entrenamiento** — entender ángulos: por qué un pinch muere en la esquina, por qué un Z-ball termina paralelo a la pared trasera, dónde hay que pegarle para que la pelota caiga en un punto concreto.
2. **Pizarra táctica** — colocar jugadores, dibujar jugadas encadenadas, guardarlas y compartirlas.

Fuera de alcance en esta versión (dejar la arquitectura preparada, no construirlo): juego jugable en tiempo real, laboratorio de física con tuning libre de parámetros.

**Restricciones del proyecto:** cero costo de operación, cero backend, y acceso controlado (solo quien Gael decida puede abrirlo).

---

## 2. Decisiones ya tomadas (no re-litigar)

| Decisión | Valor |
|---|---|
| Plataforma | Web, navegador, escritorio y móvil |
| Stack | Vite + TypeScript **vanilla** (sin React) |
| 3D | Three.js (vía CDN o npm, ver §9) |
| 2D | SVG (no canvas) |
| Backend | Ninguno. Nunca. |
| Física v1 | Geométrica ideal (reflexión especular) |
| Física v2 | Balística con gravedad, arrastre y COR |
| Física v3 | Efecto/spin (Magnus) — fase posterior |
| Inputs | Los tres modos coexisten |
| Estado | localStorage + JSON export/import + URL hash |

**Por qué vanilla y no React:** la UI son sliders, botones y dos lienzos. React añade build, bundle y un modelo de re-render que pelea con el loop de animación de Three.js. El estado de esta app es un solo objeto `AppState` y un `emit()`. No necesitas más.

---

## 3. Geometría de la cancha y sistema de coordenadas

### 3.1 Medidas oficiales (USAR ESTAS, en metros)

Cancha estándar de racquetball: 40 × 20 × 20 pies.

```ts
export const FT = 0.3048;
export const IN = 0.0254;

export const COURT = {
  length: 40 * FT,      // 12.192 m  (pared frontal -> pared trasera)
  width:  20 * FT,      //  6.096 m
  height: 20 * FT,      //  6.096 m
  backWallHeight: 12 * FT,  // 3.6576 m — la pared trasera reglamentaria
                            // sube solo 12 ft; arriba hay aire (o cristal).

  serviceLine: 15 * FT, //  4.572 m desde la pared frontal
  shortLine:   20 * FT, //  6.096 m desde la pared frontal
  receivingLine: 25 * FT, // 7.620 m desde la pared frontal
  driveServeLineOffset: 3 * FT, // 0.9144 m desde cada pared lateral
} as const;
```

La **zona de saque** es la franja del piso entre `serviceLine` (4.572 m) y `shortLine` (6.096 m), de pared a pared. Son 1.524 m de profundidad.

### 3.2 Sistema de coordenadas (CRÍTICO — todo el código depende de esto)

Mano derecha, en metros, origen en la **esquina inferior izquierda de la pared frontal**, visto desde la posición del jugador mirando hacia adelante:

```
X → ancho.   0 = pared izquierda,  6.096 = pared derecha
Y → altura.  0 = piso,             6.096 = techo
Z → fondo.   0 = pared frontal,   12.192 = pared trasera
```

Las seis superficies, como planos con normal hacia adentro:

| id | Plano | Normal interior |
|---|---|---|
| `front`   | Z = 0        | (0, 0, +1) |
| `back`    | Z = 12.192   | (0, 0, −1) |
| `left`    | X = 0        | (+1, 0, 0) |
| `right`   | X = 6.096    | (−1, 0, 0) |
| `floor`   | Y = 0        | (0, +1, 0) |
| `ceiling` | Y = 6.096    | (0, −1, 0) |

**Radio de la pelota:** todas las pruebas de colisión se hacen contra planos **desplazados hacia adentro por `BALL.radius`**, y el punto de contacto que se dibuja es el centro de la pelota. No mezclar los dos convenios: es la fuente número uno de bugs de "la pelota se mete medio centímetro en la pared".

### 3.3 Propiedades de la pelota

```ts
export const BALL = {
  diameter: 2.25 * IN,   // 0.05715 m
  radius:   1.125 * IN,  // 0.028575 m
  mass:     0.0397,      // kg (~40 g)

  // COR derivado de la norma oficial: soltada desde 100 in a 70-74 °F,
  // debe rebotar entre 68 y 72 in.  COR = sqrt(70/100) = 0.8367
  restitution: 0.837,

  // Restitución tangencial (cuánta velocidad paralela conserva al rebotar).
  // No hay norma; 0.65 da trayectorias creíbles. Parámetro a calibrar.
  tangentialRestitution: 0.65,

  dragCoefficient: 0.50,  // esfera lisa a estos Reynolds
};

export const AIR_DENSITY = 1.20;  // kg/m3
export const GRAVITY = 9.81;
```

### 3.4 Velocidades de referencia (para calibrar los sliders)

| Tiro | m/s | km/h | mph |
|---|---|---|---|
| Peloteo cómodo | 25–35 | 90–126 | 56–78 |
| Drive normal | 40–55 | 144–198 | 90–123 |
| Saque fuerte amateur | 55–65 | 198–234 | 123–145 |
| Saque de profesional | 75–85 | 270–306 | 168–190 |

Rango de sliders: **10 a 90 m/s**, default 45 m/s.

---

## 4. Arquitectura — la decisión que sostiene todo lo demás

**El motor de física no sabe que existe el renderizado.** Es una función pura:

```ts
simulate(shot: Shot, opts: SimOptions): Trajectory
```

Y `Trajectory` es el **único contrato** entre el motor y las vistas:

```ts
type Vec3 = { x: number; y: number; z: number };
type SurfaceId = 'front' | 'back' | 'left' | 'right' | 'floor' | 'ceiling';

interface Shot {
  origin: Vec3;        // posición del contacto raqueta-pelota
  direction: Vec3;     // unitario
  speed: number;       // m/s
  spin?: Vec3;         // rad/s — ignorado hasta la fase 12
}

interface Bounce {
  index: number;
  surface: SurfaceId;
  point: Vec3;         // centro de la pelota en el contacto
  time: number;        // s desde el golpe
  incomingSpeed: number;
  outgoingSpeed: number;
  incidenceAngleDeg: number;  // respecto a la normal
}

interface Trajectory {
  samples: { t: number; p: Vec3; v: Vec3 }[];  // muestreado a paso fijo para dibujar
  bounces: Bounce[];
  totalTime: number;
  terminated: 'maxBounces' | 'maxTime' | 'restingOnFloor' | 'exitedCourt';
}
```

Las vistas 3D y 2D **consumen el mismo `Trajectory`**. Esto tiene una consecuencia que hay que aprovechar explícitamente:

> **Las tres vistas 2D son proyecciones ortográficas del mismo arreglo de puntos.** No hay un "motor 2D". Planta = descartar Y. Alzado frontal = descartar Z. Alzado lateral = descartar X. El 2D cuesta casi nada una vez que el 3D funciona, y por construcción nunca se desincroniza del 3D.

### 4.1 Estructura de carpetas

```
src/
  core/
    constants.ts       // COURT, BALL, AIR_DENSITY, GRAVITY
    vec3.ts            // add, scale, dot, cross, normalize, reflect, lerp
    court.ts           // definición de los 6 planos, tests de dentro/fuera
    types.ts           // Shot, Bounce, Trajectory, SurfaceId
    engine-geometric.ts   // FASE 1 — reflexión especular pura
    engine-ballistic.ts   // FASE 7 — gravedad + arrastre + COR
    engine.ts          // selector: simulate(shot, {model: 'geometric'|'ballistic'})
    rules.ts           // FASE 8 — validación reglamentaria y clasificación
    unfold.ts          // FASE 6 — cancha espejada para enseñar el punto de mira
    solve.ts           // FASE 10 — problema inverso (¿dónde apunto?)
  render3d/
    scene.ts           // escena, cámara, luces, OrbitControls
    courtMesh.ts       // las 6 superficies + líneas reglamentarias
    trajectoryMesh.ts  // tubo/línea + marcadores de rebote numerados
    pickers.ts         // raycast para el modo clic+arrastre
  render2d/
    projections.ts     // proyectar Trajectory a coords SVG de cada vista
    courtSvg.ts        // planta, alzado frontal, alzado lateral
    overlay.ts         // FASE 9 — fichas de jugador, flechas, texto
  ui/
    state.ts           // AppState + suscripción
    panelSliders.ts    // modo de input B
    panelPresets.ts    // modo de input C
    dragInput.ts       // modo de input A
    inspector.ts       // tabla de rebotes, tiempos, velocidades
  persist/
    storage.ts         // localStorage
    share.ts           // codificar/decodificar estado en el hash de la URL
    exportPng.ts       // SVG -> PNG
  main.ts
tests/
  engine.spec.ts       // vitest
```

---

## 5. Motor v1 — geométrico (FASE 1)

Sin gravedad, sin pérdida de energía, sin arrastre. Línea recta, rebote especular: `d' = d − 2(d·n)n`.

Algoritmo:

```
p = origin, d = direction, t = 0
repetir hasta maxBounces (default 12) o maxTime (default 8 s):
  para cada uno de los 6 planos desplazados por radius:
    calcular s = distancia a lo largo de d hasta el plano
    descartar s <= EPS (1e-7) y s = infinito (rayo paralelo)
  tomar el menor s -> plano impactado
  verificar que el punto de impacto está DENTRO del rectángulo de ese plano
  registrar Bounce
  p = p + d*s ;  d = reflect(d, n) ;  t += s / speed
```

**Caso especial `back`:** la pared trasera solo mide 12 ft. Si el impacto en Z = 12.192 ocurre a `y > 3.6576`, la pelota **no rebota**: sale de la cancha. Terminar con `exitedCourt`. Modelarlo bien desde el día uno, porque es exactamente lo que pasa con un lob que se pasa.

Este motor se resuelve analíticamente y corre en microsegundos. Es la base de la enseñanza: con reflexión ideal, el truco del espejo (§8) funciona exacto.

---

## 6. Motor v2 — balístico (FASE 7)

Aquí está el trabajo real. Estado: posición, velocidad. Fuerzas:

```
a = (0, −g, 0) − k · |v| · v
donde k = 0.5 · ρ · Cd · A / m
```

Con los valores de §3.3: **k = 0.0194 m⁻¹**. Lo que implica:

| velocidad | arrastre |
|---|---|
| 30 m/s | 17.4 m/s² = **1.8 g** |
| 45 m/s | 39.3 m/s² = **4.0 g** |
| 60 m/s | 69.8 m/s² = **7.1 g** |
| 85 m/s | 140 m/s² = **14.3 g** |

> **El arrastre domina sobre la gravedad en todo el rango útil.** No es un refinamiento opcional: sin él las trayectorias rápidas salen visiblemente mal, la pelota no desacelera y los rebotes tardíos quedan demasiado vivos. Meterlo desde la primera versión del motor balístico.

### 6.1 El riesgo técnico número uno: tunneling

A 85 m/s, con un paso de 1/60 s, **la pelota avanza 1.42 m por frame**. La cancha mide 6 m de ancho. Un integrador ingenuo de "avanza, luego mira si estás dentro" se salta paredes enteras.

**Regla obligatoria:**

1. La física corre en **paso fijo, desacoplado del render**, con acumulador. `dt_fisica = 1/1000 s`.
2. En cada substep, en vez de "mover y comprobar", se prueba el **segmento** `p(t) → p(t+dt)` contra los 6 planos, se toma el cruce más temprano, y se avanza **exactamente hasta ahí**. Luego se aplica el rebote y se continúa con el resto del `dt`.
3. La prueba de segmento funciona a cualquier `dt`, así que el paso pequeño es por precisión de la integración, no por la colisión.

Integrador: **Velocity Verlet** o RK4. Euler explícito con estas aceleraciones acumula error visible. Usar Verlet, es suficiente y es barato.

### 6.2 Modelo de rebote

Descomponer la velocidad entrante en normal y tangencial respecto a la superficie:

```
v_n' = −e_n · v_n        con e_n = BALL.restitution (0.837)
v_t' =  e_t · v_t        con e_t = BALL.tangentialRestitution (0.65)
```

Permitir `e_n` por superficie (la pared frontal de cristal y el piso de madera no se comportan igual). Exponerlo como un objeto `SURFACE_COR: Record<SurfaceId, number>` aunque al principio todos valgan lo mismo.

**Condición de reposo:** si tras un rebote en el piso `|v_n'| < 0.4 m/s`, terminar con `restingOnFloor`. Sin esto entras en el clásico bucle infinito de micro-rebotes.

### 6.3 Criterios de aceptación del motor balístico

Escribir estos como tests de vitest antes de dar la fase por terminada:

- Caída libre desde 2.54 m (100 in) **sin arrastre** rebota a 1.78 ± 0.02 m (70 in). Valida el COR.
- Energía total nunca aumenta entre dos muestras consecutivas.
- Ningún punto de `samples` queda fuera de la cancha por más de 1 mm.
- Un tiro a 85 m/s directo a la pared frontal produce exactamente un rebote `front` antes de cruzar Z = 0. (Test anti-tunneling.)
- Todo tiro termina en < 8 s simulados y < 20 ms de reloj.

---

## 7. Las vistas

### 7.1 Vista 3D (FASE 2)

- Cancha como 6 planos. Frontal, laterales y techo **semitransparentes** (opacidad ~0.12) para poder ver la trayectoria desde fuera. Piso opaco con las líneas reglamentarias texturizadas o como geometría de líneas.
- Líneas a dibujar: service line, short line, receiving line, drive serve lines, cajas de dobles.
- Cámara: `OrbitControls`, con **presets de cámara** en botones — "detrás del jugador", "cenital", "lateral", "esquina". El default es detrás y arriba, que es como el jugador ve la cancha.
- Trayectoria: `TubeGeometry` sobre una `CatmullRomCurve3` de los samples. Radio ~2 cm. **Gradiente de color por velocidad** (rápido = cálido, lento = frío): comunica la pérdida de energía sin texto.
- Cada rebote: una esfera pequeña + un número flotante (sprite). El número es lo que permite hablar del tiro ("mira el rebote 2").
- Animación: un slider de tiempo (scrub) y botón play, con una esfera que recorre la curva. Poder pausar en un rebote concreto es la mitad del valor pedagógico.

### 7.2 Vistas 2D (FASE 3)

Tres SVG sincronizados, lado a lado o en pestañas en móvil:

| Vista | Proyección | Para qué sirve |
|---|---|---|
| **Planta** (la principal) | (X, Z), ignorar Y | Ángulos horizontales, cobertura de cancha, posición de jugadores |
| **Alzado frontal** | (X, Y), ignorar Z | Altura de impacto en la pared frontal — dónde muere un kill shot |
| **Alzado lateral** | (Z, Y), ignorar X | Altura del arco, ceiling balls, si la bola pasa por encima de la pared trasera |

En cada una: la trayectoria como `<polyline>`, opacidad decreciente con el número de rebote (el tramo 1 opaco, el 4 desvaído) para que se lea el orden sin animación. Marcadores numerados en los rebotes. Todo en SVG = se exporta a PNG limpio y se puede hacer hit-testing para la pizarra.

**La planta es la vista por defecto en móvil.** Es la que un entrenador dibuja en una servilleta.

---

## 8. Los tres modos de input (FASES 4, 5, 6)

Coexisten; cambiar de modo no pierde el tiro actual — los tres editan el mismo objeto `Shot`.

### A. Clic + arrastre (el intuitivo)

1. Clic en la **planta** para colocar al jugador → fija `origin.x`, `origin.z`.
2. Slider corto de altura de contacto → `origin.y` (default 0.9 m, altura de un golpe normal).
3. Clic en la **pared frontal** (en 3D vía raycast, o en el alzado frontal en 2D) para elegir el punto de mira.
4. Arrastrar desde ahí: el largo del arrastre = potencia. Mostrar el número en m/s mientras arrastras.

La dirección se deriva de `normalize(aimPoint − origin)`. Es el modelo mental del billar y es el que usará el 90 % del tiempo.

### B. Sliders numéricos (el preciso)

`origin.x`, `origin.z`, `origin.y`, **azimut** (−90° a +90°, 0 = perpendicular a la pared frontal), **elevación** (−30° a +60°), velocidad. Esto es lo que permite decir "dos grados más abierto" y medirlo.

### C. Presets con nombre (el didáctico)

Botones que cargan un `Shot` canónico desde la posición actual del jugador. Mínimo:

- **Drive serve** (a izquierda y derecha)
- **Lob serve** / **Z serve**
- **Kill shot** (frontal bajo)
- **Pinch** izquierdo y derecho (lateral → frontal, muere en la esquina)
- **Splat** (lateral cercana a quemarropa)
- **Ceiling ball** (techo → frontal → bote profundo)
- **Z-ball** (frontal → lateral → cruza y sale paralelo a la pared trasera)
- **Cross-court pass** y **down-the-line pass**
- **Around-the-world**

Cada preset guarda azimut/elevación/velocidad relativos a la posición del jugador, más un texto de una línea de **cuándo usarlo**. Ese texto es la mitad del producto para un usuario que está aprendiendo.

> Ajustar los ángulos de los presets es trabajo **iterativo y empírico**, no de programación. Presupuestar tiempo de "jugar con el slider hasta que se vea bien" separado del tiempo de código.

### D. El modo espejo (FASE 6 — la función estrella)

Dibujar la **cancha desplegada**: reflejar la cancha al otro lado de la pared lateral y mostrar que la trayectoria de dos tramos (lateral → frontal) es una **línea recta** hacia el punto espejado. Es literalmente cómo los entrenadores enseñan el pinch, y ningún simulador comercial lo muestra bien. Con el motor geométrico es exacto y sale casi gratis; con el balístico es aproximado y hay que etiquetarlo como ayuda visual.

---

## 9. Reglas y clasificación (FASE 8)

Funciones puras sobre `Trajectory`. Baratas de escribir y multiplican el valor didáctico.

**Validación de devolución:**
- ¿El primer rebote es `front`? Si no → ilegal.
- ¿Hubo `floor` antes de `front`? → *skip ball*.

**Validación de saque** (cuando el modo saque está activo):
- Debe pegar primero en la frontal.
- Debe botar en el piso **pasada la short line** → si no, *short*.
- Si llega a la pared trasera sin botar → *long*.
- Si pega una lateral antes del piso → *three-wall serve*, falta.
- Si pega el techo → falta.

**Clasificación automática del tiro**, mostrada como etiqueta: `kill`, `pass`, `ceiling`, `pinch`, `splat`, `Z`, `skip`, `setup` (rebote alto en la trasera = regalo al rival). Derivarla de la secuencia de superficies + altura del impacto frontal + profundidad del segundo bote.

**Métrica útil:** *altura del segundo bote en Z = 11 m*. Es el mejor predictor de si un passing shot es ganador o un regalo. Mostrarla siempre.

---

## 10. Problema inverso (FASE 10 — opcional pero muy valioso)

"Quiero que la pelota muera en la esquina izquierda del fondo. ¿Dónde le pego y con qué fuerza?"

- Con el motor **geométrico**: solución analítica por el método del espejo. Directo.
- Con el motor **balístico**: no hay forma cerrada. Resolverlo numéricamente — método de disparo con Newton de 2 variables (azimut, elevación) a velocidad fija, o Nelder-Mead si Newton se pone inestable. Converge en 10–30 iteraciones; cada simulación cuesta < 1 ms, así que es interactivo.

Marcarlo como fase posterior. Es la función que convierte la app de "bonita" a "la uso antes de entrenar".

---

## 11. Pizarra táctica (FASE 9)

Capa de overlay sobre la vista de planta en SVG:

- Fichas arrastrables: **yo**, **rival**, con color y etiqueta.
- Flechas de movimiento (distintas visualmente de las trayectorias de pelota: punteadas).
- Texto libre y dibujo a mano alzada.
- Una **jugada** = secuencia ordenada de tiros + anotaciones, reproducible paso a paso con botones anterior/siguiente.
- Guardar, listar, duplicar, borrar jugadas.
- Exportar a PNG.

Conceptualmente fácil, mucha superficie de UI. Es la fase que más horas consume por unidad de dificultad.

---

## 12. Persistencia, privacidad y despliegue (FASE 11)

### Sin backend, por diseño

- **localStorage** para jugadas y presets del usuario.
- **Export/import JSON** para respaldo real.
- **Compartir por URL**: serializar el estado, comprimir con `lz-string`, meterlo en el `#hash`. El enlace *es* los datos. Cero servidor, cero base de datos, cero costo, y privado por construcción: si no mandas el enlace, nadie lo tiene.

### Hosting gratuito con acceso controlado

Tres opciones reales, en orden de recomendación:

1. **Artifact de Claude** — publicar la app como artifact. Es privado por defecto y tú eliges a quién se lo compartes. Costo cero, cero configuración, se actualiza republicando. Restricción a respetar al construir: los scripts externos solo cargan desde `cdnjs.cloudflare.com` (Three.js está ahí), y el resto de CSS/JS va inline. **Para tu caso esto cumple literalmente los tres requisitos: gratis, funciona, y tú eliges quién entra.**

2. **Cloudflare Pages + Cloudflare Access** — si quieres dominio propio y una lista de correos autorizados con login real. El plan gratuito de Zero Trust cubre decenas de usuarios; verifica el límite vigente antes de comprometerte. Más pasos de configuración, pero es una app "de verdad".

3. **Repo privado + `npm run dev` local** — si al final solo la vas a usar tú, es la opción de cero fricción. Lo privado se resuelve no desplegando.

> Evitar **GitHub Pages** para esto: desde un repo privado requiere plan de pago, así que "gratis" y "privado" no se dan a la vez ahí.

### Nota sobre Three.js

Si el destino es un Artifact, cargar Three.js por `<script>` desde cdnjs con versión exacta fijada, y escribir el resto sin bundler. Si el destino es Cloudflare Pages, usar npm + Vite normalmente. **Decidir el destino en la fase 0**, porque cambia cómo se escribe el proyecto.

---

## 13. Plan por fases: dificultad, horas y orden

Dificultad en escala 1–10 para un desarrollador solo. Las horas son **horas de trabajo enfocado, ya contando que Claude Code escribe la mayor parte del código**: el costo real no es teclear, es iterar y depurar.

### Bloque 1 — MVP demostrable

| # | Fase | Dific. | Horas |
|---|---|---|---|
| 0 | Setup: Vite + TS, constantes, sistema de coordenadas, decidir destino de despliegue | 2 | 1–2 |
| 1 | Motor geométrico + tests | 3 | 3–5 |
| 2 | Vista 3D: cancha, cámara, trayectoria, marcadores de rebote | 4 | 5–8 |
| 3 | Vistas 2D (las tres proyecciones) | 2 | 3–5 |
| 4 | Input B: sliders | 2 | 2–3 |
| | **Subtotal MVP** | | **14–23 h** |

Al terminar el bloque 1 ya tienes algo que enseñar: mueves sliders y ves la trayectoria en 3D y en planta a la vez. **Esto cabe en un fin de semana.**

### Bloque 2 — Herramienta de entrenamiento usable

| # | Fase | Dific. | Horas |
|---|---|---|---|
| 5 | Input A: clic + arrastre con raycast | 6 | 4–6 |
| 6 | Presets con nombre + modo espejo | 5 | 5–8 |
| 7 | **Motor balístico**: gravedad, arrastre, COR, CCD anti-tunneling | **7** | **6–10** |
| 8 | Reglas, faltas y clasificación de tiros | 4 | 3–4 |
| | **Subtotal** | | **18–28 h** |

La fase 7 es la que puede desbordarse. Todo su riesgo está concentrado en la detección de colisión continua y en la condición de reposo; el resto es aritmética.

### Bloque 3 — Pizarra y entrega

| # | Fase | Dific. | Horas |
|---|---|---|---|
| 9 | Pizarra táctica: fichas, flechas, jugadas guardadas | 5 | 6–10 |
| 10 | Problema inverso (¿dónde apunto?) | 7 | 4–6 |
| 11 | Persistencia, compartir por URL, export PNG | 3 | 3–4 |
| 12 | Pulido, táctil/móvil, despliegue | 4 | 4–6 |
| | **Subtotal** | | **17–26 h** |

### Fases posteriores (no ahora)

| # | Fase | Dific. | Horas |
|---|---|---|---|
| 13 | Spin y efecto Magnus | 8 | 6–10 |
| 14 | Juego jugable en tiempo real | 9 | 40–80+ |

### Total

| Alcance | Horas |
|---|---|
| MVP (bloque 1) | **14–23 h** |
| Herramienta de entrenamiento completa (bloques 1+2) | **32–51 h** |
| Producto completo con pizarra (bloques 1+2+3) | **49–77 h** |

**Tiempo de calendario**, a 2 horas por día: MVP en **4–8 días**, versión de entrenamiento en **3–4 semanas**, producto completo en **5–8 semanas**. A ritmo de fin de semana intenso (8 h/día): MVP en 2 días, producto completo en 7–10 días.

---

## 14. Los cinco riesgos reales

1. **Tunneling a alta velocidad.** 1.42 m por frame a 85 m/s. Mitigación: paso fijo de física desacoplado + test de segmento contra planos, nunca "mover y comprobar". Es un requisito de arquitectura, no una optimización posterior.
2. **Micro-rebotes infinitos en el piso.** Umbral de reposo explícito en 0.4 m/s.
3. **Confundir centro de pelota con superficie de contacto.** Fijar el convenio en la fase 0 y escribir un test que lo verifique.
4. **Calibrar los presets se come el calendario.** No es código, es prueba y error visual. Presupuestarlo aparte o el bloque 2 se desborda.
5. **Alcance que se estira hacia el juego jugable.** La fase 14 es un proyecto distinto, no una continuación. Si aparece la tentación, es señal de que el bloque 3 está incompleto.

---

## 15. Orden de arranque sugerido para Claude Code

```
1. Leer este documento entero antes de escribir una línea.
2. Fase 0 completa, incluida la decisión de destino de despliegue.
3. Fase 1 con sus tests en verde ANTES de tocar Three.js.
   (El motor es la única parte que no se puede depurar mirando.)
4. Fase 3 (2D) antes que fase 2 (3D): la planta en SVG es más rápida
   de conseguir y te da una forma de ver si el motor miente.
5. Después sí, 3D.
6. Congelar la API de `Trajectory` al terminar la fase 1 y no tocarla.
   Todo lo demás cuelga de ahí.
```

Convención de commits: una fase por rama, tests verdes antes de mezclar.
