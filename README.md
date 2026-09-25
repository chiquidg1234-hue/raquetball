# Racquetball Trajectory Lab

Simulador de trayectorias de racquetball. Defines un tiro (donde estas parado, a que
punto de la pared le apuntas, con cuanta fuerza) y la app dibuja la trayectoria completa
con todos sus rebotes, a la vez en **una vista 3D** y en **tres vistas 2D ortograficas**
de pizarra tactica.

Construido siguiendo `RACQUETBALL_SPEC.md` fase por fase. Sin backend, sin costo de
operacion, y privado por construccion.

---

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
```

## Comprobar

```bash
npm test           # 196 tests de vitest
npm run typecheck  # tsc --noEmit, modo estricto
```

## Construir

```bash
npm run build
```

Deja dos cosas en `dist/`:

- **`racquetball.html`** — la app entera en UN SOLO archivo de 0.65 MB, con Three.js
  incluido. Cero peticiones de red en ejecucion: funciona abriendola con doble clic
  desde el disco, sin servidor.
- El `dist/` completo, por si prefieres servirlo como sitio estatico normal.

El script de empaquetado verifica que el codigo que queda dentro del HTML es byte a byte
el mismo que el del bundle. No es paranoia: ese guardia existe porque una version
anterior producia un archivo roto de forma silenciosa (ver `DECISIONES.md`).

```bash
npm run build:artifact
```

Deja ademas `dist/artifact.html`: la misma pagina sin `<!doctype>`, `<html>`, `<head>` ni
`<body>`, porque el contenedor de Artifact de Claude aporta esos envoltorios. Se genera a
partir del archivo unico ya verificado, asi que las dos salidas no pueden divergir.

---

## Como se usa

### Tres formas de definir el tiro, y las tres editan el mismo objeto

Cambiar de una a otra nunca pierde el tiro actual.

| Modo | Donde | Que hace |
|---|---|---|
| **Clic y arrastre** | Planta | Presionar = donde estoy parado. Arrastrar = hacia donde apunto y con cuanta fuerza. |
| | Alzado frontal | Presionar = punto de mira en la pared. Arrastrar = fuerza. |
| | 3D | Clic en el piso = donde estoy. Clic en la frontal = punto de mira. |
| **Sliders** | Panel *Tiro* | Posicion, azimut, elevacion y velocidad, con numeros. |
| **Presets** | Panel *Presets* | 20 tiros con nombre, cada uno con su linea de cuando usarlo. |

### Panel *Cancha* — dónde se juega

Ciudad (Santa Cruz, Tarija, Cochabamba, Sucre, La Paz, El Alto, o cualquier altitud),
temperatura, presión medida opcional, pelota (Gearbox negra, Gearbox azul, Formulaflow
azul), paredes y piso. Enseña en vivo la densidad del aire, la `k` de arrastre, el freno
en g al tiro actual, el COR y el número de Reynolds. En El Alto el aire pesa un 40 %
menos que a nivel del mar y la pelota se frena un 37 % menos que en Santa Cruz.

Lo que no tiene dato publicado (rebote de cada pelota, superficies, efecto de la
temperatura en la goma) lo dice el propio panel y se calibra a mano. Todas las fuentes
están en **[INVESTIGACION.md](INVESTIGACION.md)**.

### Modo saque — botar la pelota con la mano

En modo saque la pelota se bota una vez en la zona de saque y se golpea en ese rebote
(IRF 3.3). Se elige la altura a la que se suelta y cuándo se le pega (subiendo, arriba o
bajando), y de ahí sale la altura de contacto. Pegarle tras el segundo bote, o botarla
fuera de la zona, es falta. El bote de la mano se dibuja en violeta ("bote de saque") y
**no cuenta** como bote 1: la numeración de los botes empieza después del golpe. La
línea de tiempo arranca en negativo para ver la pelota caer de la mano.

### Mano y raqueta en 3D

Conmutador derecha / revés / sin raqueta y diestro / zurdo en la vista 3D, y la cámara
*Golpe* para verlo de cerca. La raqueta va enganchada al punto de contacto y a la
dirección del tiro; un anillo verde marca en el cordaje dónde toca la pelota, y las
huellas del piso enseñan a qué altura del pie adelantado va el contacto.

### Panel *Apuntar* — el problema inverso

Eliges donde quieres que caiga la pelota y la app responde con el punto de mira, los
angulos y la fuerza. Con el motor geometrico la respuesta es exacta (metodo del espejo);
con el balistico se resuelve por disparo numerico en menos de 150 ms.

### Panel *Pizarra*

Fichas arrastrables, flechas de movimiento, texto y dibujo a mano. Una **jugada** es una
secuencia de tiros reproducible paso a paso, con los pasos anteriores dibujados en gris.

### Panel *Guardar*

- **localStorage** para el dia a dia.
- **JSON** para el respaldo real (tiros guardados y jugadas incluidos).
- **Enlace**: el estado va comprimido dentro del `#hash`. Un tiro completo, con su cancha
  y su saque, cabe en unos 240 caracteres. El enlace *es* los datos: cero servidor, y quien
  no lo tenga no tiene nada. Los enlaces viejos (v1, sin cancha) se siguen abriendo.

### Teclado

| Tecla | Accion |
|---|---|
| `espacio` | Reproducir / pausar |
| `←` `→` | Avanzar 20 ms (con `shift`, 2 ms) |
| `,` `.` | Saltar al rebote anterior / siguiente |

---

## Los dos motores

| | Geometrico | Balistico |
|---|---|---|
| Fisica | Reflexion especular ideal | Gravedad, arrastre y COR |
| Coste | Microsegundos, analitico | ~1 ms |
| Para que | Ensenar angulos; el truco del espejo sale exacto | Ver lo que hace la pelota de verdad |

El arrastre no es un adorno: a nivel del mar y 20 °C `k = 0.0194 1/m`, que pesa **1.8 g
a 30 m/s y 14.3 g a 85 m/s**, o sea que domina sobre la gravedad en todo el rango util.
Ya no es una constante: sale de la altitud y la temperatura con la atmósfera estándar
(en El Alto, `k = 0.0116`).

El COR de la pelota (0.872 para la de referencia) sale de la prueba de homologación
(soltar desde 100 in, rebotar 68-72 in) resuelta **con** arrastre. La cuenta de siempre,
`sqrt(70/100) = 0.837`, ignora el aire y dejaba a la pelota del simulador rebotando a
64.6 in: fuera de su propia norma.

Los presets de tiros con arco (lob, Z serve, ceiling, Z-ball, around-the-world) cambian
solos al motor balistico: sin gravedad, todo lo que sube acaba en el techo.

---

## Arquitectura

**El motor de fisica no sabe que existe el renderizado.** Es una funcion pura
`simulate(shot, opts) -> Trajectory`, y `Trajectory` es el unico contrato con el resto.

Las tres vistas 2D son **proyecciones ortograficas del mismo arreglo de puntos** que usa
la 3D: planta descarta Y, alzado frontal descarta Z, alzado lateral descarta X. No hay
un "motor 2D", y por construccion las vistas no se pueden desincronizar.

```
src/
  core/       constantes, vec3, cancha, tipos, motores, reglas, espejo, solver,
              atmósfera, pelotas, superficies, sitio de juego, saque, golpe
  render3d/   escena, cancha, trayectoria, raycast, mano y raqueta
  render2d/   proyecciones, SVG de cancha, overlay de pizarra
  ui/         estado, paneles, inputs, inspector
  persist/    localStorage, hash de URL, export PNG
tests/        196 tests
scripts/      empaquetado de un solo archivo, banco de calibracion de presets
```

Ver **[DECISIONES.md](DECISIONES.md)** para las decisiones de fase 0 y las cosas del spec
y del encargo de las que este codigo se aparta a proposito, con su razon, e
**[INVESTIGACION.md](INVESTIGACION.md)** para la fuente de cada numero fisico.

## Calibrar presets

```bash
npx vite-node scripts/calibrate-presets.ts
```

Imprime, para cada preset, la secuencia de superficies, donde cae el primer bote y como
termina. Ajustar presets es trabajo empirico; con esta tabla es leer, no entrecerrar los
ojos.
