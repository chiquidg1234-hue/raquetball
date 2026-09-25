# Racquetball Trajectory Lab

Simulador de trayectorias de racquetball. Vite + TypeScript vanilla (sin React), Three.js
para el 3D, SVG para las tres vistas 2D. Sin backend, nunca.

## Lo primero que hay que leer

- `README.md` — cómo arrancarlo, probarlo y construirlo.
- `DECISIONES.md` — decisiones de arquitectura, los tres sitios donde el código se aparta
  del spec a propósito, y dos bugs silenciosos que solo aparecieron al probar en navegador.
- `RACQUETBALL_SPEC.md` — el spec original de Gael, completado en 13 fases.
- `ENCARGO-2AM.md` — el encargo del 24-09 (botes de piso, altitud, pelotas, canchas,
  saque con bote de mano, mano y raqueta 3D). Hecho; lo que se decidió está en
  `DECISIONES.md`.
- `INVESTIGACION.md` — la fuente de cada número físico, y lo que NO tiene dato publicado.

## Reglas del proyecto

- **El motor de física no sabe que existe el renderizado.** `simulate(shot, opts)` es una
  función pura y `Trajectory` es el único contrato con las vistas.
- **Las tres vistas 2D son proyecciones del mismo arreglo de puntos que usa la 3D.** No
  hay un "motor 2D". Planta descarta Y, alzado frontal descarta Z, alzado lateral descarta X.
- **Convenio de radio de pelota:** las colisiones se prueban contra planos desplazados
  hacia adentro por el radio, y todo punto que se dibuja es el CENTRO de la pelota.
- **Nunca "mover y comprobar"** en la detección de colisión: se prueba el segmento contra
  los seis planos. A 85 m/s la pelota avanza 1.42 m por frame y la cancha mide 6.1 m.
- Los tests son el contrato. Si un cambio los rompe, se explica por qué en el commit.
- **Ningún número físico se inventa.** Sale de `INVESTIGACION.md` con su fuente, o se
  marca como estimación en el código y en la UI, y queda expuesto para calibrarlo.
- **Un bote es el piso; una pared es un rebote.** La numeración 1, 2, 3 cuenta solo el
  piso y empieza después del golpe; el bote de la mano del saque no entra nunca.
- El sitio de juego llega al motor por `venueSimOptions`, y la vista, el solver y los
  fantasmas lo usan por el mismo camino (`simOptionsFor`).

## Comandos

```bash
npm install
npm run dev              # servidor de desarrollo
npm test                 # vitest
npm run typecheck        # tsc --noEmit, estricto
npm run build            # dist/racquetball.html, un solo archivo
npm run build:artifact   # dist/artifact.html, para publicar como Artifact
npx vite-node scripts/calibrate-presets.ts   # banco de calibración de presets
```
