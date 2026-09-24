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
npm test           # 115 tests de vitest
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
- **Enlace**: el estado va comprimido dentro del `#hash`. Un tiro completo cabe en 115
  caracteres. El enlace *es* los datos: cero servidor, y quien no lo tenga no tiene nada.

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

El arrastre no es un adorno: con los valores oficiales `k = 0.0194 1/m`, pesa **1.8 g a
30 m/s y 14.3 g a 85 m/s**, o sea que domina sobre la gravedad en todo el rango util.

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
  core/       constantes, vec3, cancha, tipos, motores, reglas, espejo, solver
  render3d/   escena, cancha, trayectoria, raycast
  render2d/   proyecciones, SVG de cancha, overlay de pizarra
  ui/         estado, paneles, inputs, inspector
  persist/    localStorage, hash de URL, export PNG
tests/        115 tests
scripts/      empaquetado de un solo archivo, banco de calibracion de presets
```

Ver **[DECISIONES.md](DECISIONES.md)** para las decisiones de fase 0 y las tres cosas
del spec de las que este codigo se aparta a proposito, con su razon.

## Calibrar presets

```bash
npx vite-node scripts/calibrate-presets.ts
```

Imprime, para cada preset, la secuencia de superficies, donde cae el primer bote y como
termina. Ajustar presets es trabajo empirico; con esta tabla es leer, no entrecerrar los
ojos.
