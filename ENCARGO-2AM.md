# Encargo para la sesión programada (disparada a mano el 24-09 por la noche)

> Escrito por la sesión anterior. Gael pidió que **todo el desarrollo ocurra en esa
> sesión**, no antes. Aquí está el encargo completo, con lo que hay que investigar antes
> de escribir código y lo que hay que construir después.

El proyecto ya existe y funciona: 13 fases del spec completas, 115 tests en verde. Lee
`README.md` y `DECISIONES.md` antes de tocar nada, y `RACQUETBALL_SPEC.md` para el
contexto original. Lo de abajo es **encima de eso**, no en lugar de eso.

**Regla que no se negocia:** los 115 tests existentes tienen que seguir verdes al
terminar. Si un cambio de física los rompe, es porque el cambio está mal o porque el test
codificaba una suposición que ya no vale — en ese segundo caso, actualiza el test Y
explica en el commit por qué.

---

## PRIORIDAD 1 — Botes de piso y rebotes de pared: que no se confundan nunca

> Añadido por Gael el 24-09 por la noche, con énfasis expreso. Va **antes que todo lo
> demás** de construir: afecta a cómo se lee cada tiro, y no depende de la investigación.

### El problema, tal como está hoy en el código

Hoy **todos los contactos se numeran seguidos**, mezclando paredes y piso:
`src/render2d/courtSvg.ts:366`, `src/render3d/trajectoryMesh.ts:213` y la tabla de
`src/ui/inspector.ts:171` usan `b.index`, que cuenta cada contacto con cualquier
superficie. En un Z serve eso sale como `1 frontal · 2 lateral · 3 piso`, y el "3" es en
realidad **el primer bote**. Para un jugador eso es falso: en racquetball un **bote** es
cuando la pelota toca el **piso**; tocar una pared sin tocar el piso es un **rebote de
pared**, y son cosas completamente distintas. Lo que decide el punto es cuántas veces
bota en el piso.

El dato ya está bien en el motor (cada `Bounce` lleva su `surface`). El fallo es de
lectura, no de física. **No toques el contrato `Trajectory`**: deriva todo de `surface`.

### Qué tiene que hacer el sistema

1. **Dos familias de marcadores, que se distingan de un vistazo**, en las tres vistas 2D,
   en el 3D y en la tabla:
   - **Botes de piso**: numerados aparte, **1, 2, 3…** contando SOLO el piso. Marcador
     grande, color propio.
   - **Rebotes de pared**: sin número de bote. Marcador distinto (otra forma, más pequeño)
     con la inicial de la pared: **F** frontal, **I** izquierda, **D** derecha,
     **T** trasera, **C** techo.
   El Z serve tiene que leerse como `F → D → bote 1`, no como `1 → 2 → 3`.

2. **Los tres primeros botes de piso son los que importan.** A Gael siempre le van a
   importar más los botes 1, 2 y 3. Que destaquen: marcadores grandes y opacos, y del 4.º
   en adelante pequeños y desvaídos. En el inspector, un bloque arriba con esos tres
   botes (dónde cae cada uno en x/z, en qué instante, a qué velocidad llega), antes de la
   tabla completa de contactos.

3. **Poder mover dónde cae el SEGUNDO bote de piso.** Gael quiere arrastrar el marcador
   del bote 2 en la planta y que el tiro se recalcule para que el segundo bote caiga
   ahí. Ojo: **el segundo bote que da en el piso**, no el segundo contacto.
   - El solver ya admite `bounceIndex: 2` (`src/core/solve.ts:37`), pero su test acepta
     que no converja (`tests/solve.spec.ts`, bloque "segundo bote"). Hay que hacerlo
     fiable, y cuando no haya solución decirlo en pantalla con el error en metros.
   - Arrastrar el bote 2 mantiene fijos la posición del jugador y la velocidad y resuelve
     azimut y elevación; con "buscar también la fuerza" activado, también la velocidad.
   - Con el motor geométrico no hay segundo bote real (sin gravedad, lo que sube del piso
     no vuelve a bajar salvo por el techo): al arrastrar el bote 2, pasa al balístico y
     avísalo.
   - Si da tiempo, lo mismo con los botes 1 y 3.

4. **Si lo primero que toca la pelota es el piso, que se vea como piso.** Eso es un skip
   y el punto se pierde. Hoy solo sale como una etiqueta en el panel lateral
   (`src/ui/inspector.ts:65`). Tiene que verse **en la cancha**: marcador de advertencia
   en rojo en el punto donde toca el piso con la palabra PISO, un aviso visible sobre las
   vistas, y el resto de la trayectoria atenuada, porque a partir de ahí la jugada ya no
   cuenta.

5. **El bote del saque no es un bote del tiro.** Ejemplo de Gael, un **lob Z serve**:
   primero botas la pelota con la mano, luego ejecutas el golpe, la pelota toca la
   **frontal**, después la **lateral**, y **recién ahí da su primer bote**. El bote de la
   mano (bloque 3 de este encargo) es otra cosa: se dibuja con su propio estilo, se
   etiqueta como "bote de saque", y **no cuenta** como bote 1. La numeración de botes
   empieza después del golpe.

### Tests obligatorios de este bloque

- Z serve: la secuencia legible es frontal → lateral → bote 1, y el bote 1 es el primer
  contacto con `surface === 'floor'`.
- Un tiro que toca el piso antes que la frontal se marca como skip en los datos de la
  vista, no solo en el inspector.
- Arrastrar el bote 2 a un punto alcanzable deja el segundo bote de piso a menos de 5 cm
  de ese punto.
- El bote de la mano en el saque no entra en la numeración de botes del tiro.

---

## 0. Antes de escribir una línea: investigar y MEDIR

Gael pidió expresamente "investiga más a profundidad". Nada de esto se inventa. Usa
búsqueda web, anota la fuente de cada número en el código, y donde no haya dato fiable
**dilo en el código y en el commit** en vez de rellenar con un valor bonito.

### 0.1 Pelotas — solo estas dos

Gael las escribió de oído. Lo primero es confirmar el nombre real del producto:

| Como lo escribió | Casi seguro es | Qué hay que averiguar |
|---|---|---|
| "gerobox negra azul" | **Gearbox** (Gearbox Sports), modelo negro/azul | diámetro, masa, COR, presión, a qué temperatura se homologa |
| "formila flow azul" | **Formula Flow**, azul | lo mismo |

Para cada una: diámetro (mm), masa (g), coeficiente de restitución, y la altura de
rebote homologada (la norma suelta desde 100 in a 70–74 °F y exige 68–72 in de rebote).
Si el fabricante publica altura de rebote, el COR sale de `sqrt(h_rebote / h_caída)`.

Si un dato no se encuentra, **no lo inventes**: márcalo como estimado, di de dónde sale
la estimación, y deja el valor expuesto para que Gael lo calibre a mano.

### 0.2 Canchas — "de placa" vs. las normales

Gael distingue "canchas de placa" de "las normales como las de Bolivia". Averigua:

- Qué es exactamente una cancha de placa (casi seguro paredes de hormigón/cemento en
  lugar de panel o madera). Cómo se construye y en qué se nota al jugar.
- Cómo cambia eso el rebote: una pared de hormigón devuelve más que un panel de madera,
  y raspa más (restitución tangencial más baja).
- Qué hay en Bolivia de verdad: qué superficies se usan en los clubes y en las canchas
  federadas.

El motor **ya admite COR por superficie** (`SURFACE_COR` en `src/core/constants.ts`),
así que esto entra sin rediseñar nada.

### 0.3 Altitud — esto es lo más gordo

Es la parte con más efecto físico de todo el encargo, y es justo la que hace falta para
Bolivia. La constante de arrastre del motor es

```
k = 0.5 · ρ · Cd · A / m
```

y **ρ es la densidad del aire, que depende de la altitud**. El proyecto la tiene fija en
1.20 kg/m³ (nivel del mar). En El Alto ronda 0.78. Eso es **un tercio menos de arrastre**:
la pelota vuela más rápido, más lejos y se frena mucho menos. Un jugador de Santa Cruz
que sube a La Paz no reconoce su propio drive.

Altitudes a soportar (confírmalas):

| Ciudad | Altitud aprox. |
|---|---|
| Santa Cruz de la Sierra | 416 m |
| Tarija | 1 875 m |
| Cochabamba | 2 558 m |
| Sucre | 2 810 m |
| La Paz | 3 640 m |
| El Alto | 4 150 m |

Lo que hay que implementar:

- Densidad del aire desde altitud y temperatura, con la **fórmula barométrica** y la ley
  de gases ideales. Investiga la forma correcta (atmósfera estándar internacional) en vez
  de usar una regla de tres.
- La temperatura también entra dos veces: en la densidad del aire **y en el COR de la
  pelota**, porque la norma homologa a 70–74 °F y una pelota fría rebota menos. Busca si
  hay dato publicado de cuánto cae; si no lo hay, déjalo como parámetro expuesto y dilo.
- Presión atmosférica de la pelota: a 4 000 m la diferencia entre la presión interna y la
  externa es mayor, lo que también afecta. Investiga si es significativo o despreciable,
  y escribe la conclusión.

**Test obligatorio:** el mismo tiro a 55 m/s en Santa Cruz y en El Alto tiene que dar
trayectorias claramente distintas, y el test debe afirmar en qué dirección y cuánto.

### 0.4 Velocidades

Gael dijo "corrige las velocidades también". La tabla actual del spec (peloteo 25–35,
drive 40–55, saque amateur 55–65, saque pro 75–85 m/s) hay que contrastarla con datos
reales medidos de racquetball. Ojo: los récords de saque suelen publicarse en mph, y hay
que mirar si están medidos a la salida de la raqueta o después del rebote. Corrige
`SPEED` en `src/core/constants.ts` y di en el commit de dónde salen los números nuevos.

---

## 1. Física a construir

1. **Modelo de atmósfera** (`src/core/atmosphere.ts`): altitud + temperatura →
   densidad del aire → `k` de arrastre. `DRAG_K` deja de ser una constante y pasa a
   calcularse. Cuidado: hay tests que comprueban `DRAG_K ≈ 0.0194` — ese valor sigue
   siendo el correcto **a nivel del mar y 20 °C**, así que el test se reescribe para
   decir eso, no se borra.
2. **Catálogo de pelotas** (`src/core/balls.ts`): las dos pelotas, con sus datos y su
   fuente anotada.
3. **Catálogo de superficies** (`src/core/surfaces.ts`): placa vs. madera vs. panel vs.
   cristal, con COR y restitución tangencial por superficie.
4. **Sitio de juego** en el estado de la app: ciudad/altitud, temperatura, tipo de
   cancha, pelota. Todo eso entra en `SimOptions` y viaja en la URL compartida (hay que
   ampliar `src/persist/schema.ts`, subiendo `DOC_VERSION` y aceptando los documentos v1
   antiguos sin romperlos).
5. **UI**: un panel nuevo "Cancha" con selector de ciudad/altitud, temperatura, superficie
   y pelota, mostrando en vivo la densidad del aire y el `k` resultante. Que se vea el
   número es la mitad de la lección.

---

## 2. Mano y raqueta en 3D

Gael quiere ver **dónde hay que pegarle a la pelota**, con una mano y una raqueta en 3D,
para el golpe de **derecha (forehand)** y el de **revés (backhand)**.

- Modelo simple de raqueta (marco + cordaje + mango) y de mano, construidos con geometría
  de Three.js. No hace falta un modelo escaneado: hace falta que se entienda el gesto.
- Un conmutador **derecha / revés** que coloca la mano y la raqueta en el lado correcto
  y orienta la cara del cordaje.
- **El punto de contacto es lo importante**: marca sobre la raqueta dónde debe golpear la
  pelota y, en el espacio, a qué altura y a qué distancia del cuerpo. Enseña también la
  diferencia real entre los dos golpes: el contacto del forehand va más adelantado
  respecto al cuerpo que el del backhand. Investiga las distancias reales antes de
  inventarlas.
- La raqueta tiene que quedar enganchada al origen del tiro que ya existe
  (`state.origin`) y a la dirección (`azimut`/`elevación`), de modo que al mover los
  sliders la mano se mueva con el tiro. Si no se mueve con el tiro, es un adorno.
- Diestro y zurdo: al menos deja el eje preparado aunque solo expongas diestro.

---

## 3. El saque: lanzar la pelota con la mano

Ahora mismo el saque sale de la nada. En el racquetball de verdad el sacador **bota la
pelota contra el piso con la mano y la golpea al subir**, y hay reglas alrededor de eso:

- La pelota se bota **una sola vez** y se golpea antes de que toque el piso otra vez.
- El sacador tiene que estar dentro de la zona de saque durante todo el movimiento.

Qué construir:

- Fase de lanzamiento simulada con el motor balístico que ya existe: punto de suelta,
  altura, caída, rebote en el piso y subida. De ahí sale **la altura de contacto y el
  instante**, en vez de que Gael los ponga a mano.
- Controles: altura de suelta y adelanto del golpe (golpear antes o después del punto
  más alto del rebote), con la altura de contacto resultante mostrada en vivo.
- Animación: la pelota cae de la mano, bota y sale disparada, encadenada con la
  trayectoria que ya se dibuja.
- Regla: si el golpe llega **después** de que la pelota vuelva a tocar el piso, es falta,
  y hay que decirlo con las faltas de saque que ya están en `src/core/rules.ts`.

---

## 4. Cómo trabajar

- Rama: crea `claude/fisica-avanzada-2am` desde la rama por defecto y trabaja ahí.
  Commits pequeños, uno por bloque, con el porqué en el mensaje, no el qué.
- Orden: **botes de piso vs. rebotes de pared (prioridad 1)** → investigación →
  atmósfera y catálogos (con tests) → panel de cancha → saque con lanzamiento → mano y
  raqueta 3D. Si el tiempo no llega para todo, que llegue en ese orden.
- **Compruébalo en un navegador de verdad**, no solo con tests. Hay Chromium en
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` y Playwright se instala en el
  scratchpad. La sesión anterior encontró así tres bugs que ningún test habría pillado
  (un archivo publicado roto en silencio, el panel fuera de pantalla en móvil, y sliders
  que mentían al restaurar desde la URL).
- Al terminar: `npm test`, `npm run typecheck`, `npm run build`, y empuja.
- Deja un resumen honesto de qué quedó hecho y qué no. Si algo no se pudo investigar,
  dilo en vez de rellenarlo.
