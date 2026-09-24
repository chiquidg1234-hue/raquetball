/**
 * FASE 1 — Motor geometrico.
 *
 * Sin gravedad, sin perdida de energia, sin arrastre. Linea recta y rebote
 * especular: d' = d - 2(d.n)n.
 *
 * Se resuelve analiticamente y corre en microsegundos. Es la base de la
 * ensenanza: con reflexion ideal el truco del espejo (modo espejo, fase 6)
 * es exacto, no una aproximacion.
 */

import { SIM } from './constants.js';
import {
  clampToCourt,
  clearsBackWall,
  firstRayCrossing,
} from './court.js';
import type { Shot, SimOptions, Trajectory } from './types.js';
import { TrajectoryBuilder, defaultSampleDt } from './trajectory-builder.js';
import { addScaled, normalize, reflect, scale } from './vec3.js';

export const simulateGeometric = (
  shot: Shot,
  opts: SimOptions = {},
): Trajectory => {
  const maxBounces = opts.maxBounces ?? SIM.maxBounces;
  const maxTime = opts.maxTime ?? SIM.maxTime;
  const builder = new TrajectoryBuilder(
    defaultSampleDt(opts.sampleDt),
    'geometric',
  );

  const speed = Math.max(shot.speed, 1e-6);
  let p = clampToCourt(shot.origin);
  let d = normalize(shot.direction);
  let t = 0;

  builder.pushExact(t, p, scale(d, speed));

  // Direccion degenerada: la pelota se queda donde esta.
  if (d.x === 0 && d.y === 0 && d.z === 0) {
    return builder.finish(0, 'restingOnFloor');
  }

  for (;;) {
    const hit = firstRayCrossing(p, d, SIM.epsilon);

    if (!hit) {
      // Geometricamente imposible dentro de una caja cerrada, pero si la
      // aritmetica de coma flotante deja el punto justo sobre una cara, se
      // termina limpio en vez de girar para siempre.
      return builder.finish(t, 'exitedCourt');
    }

    const segmentTime = hit.distance / speed;
    const arrivalTime = t + segmentTime;

    // Corte por tiempo maximo dentro del tramo.
    if (arrivalTime > maxTime) {
      const remaining = maxTime - t;
      const pEnd = addScaled(p, d, remaining * speed);
      const v = scale(d, speed);
      const p0 = p;
      const t0 = t;
      builder.fillGrid(t0, maxTime, (tt) => ({
        p: addScaled(p0, d, (tt - t0) * speed),
        v,
      }));
      builder.pushExact(maxTime, pEnd, v);
      return builder.finish(maxTime, 'maxTime');
    }

    // Rellenar la rejilla de muestreo a lo largo del tramo recto.
    {
      const p0 = p;
      const t0 = t;
      const v = scale(d, speed);
      builder.fillGrid(t0, arrivalTime, (tt) => ({
        p: addScaled(p0, d, (tt - t0) * speed),
        v,
      }));
    }

    const vIn = scale(d, speed);
    builder.pushExact(arrivalTime, hit.point, vIn);

    // La pared trasera solo mide 12 ft: por encima, la pelota se va fuera.
    if (hit.surface.id === 'back' && clearsBackWall(hit.point.y)) {
      return builder.finish(arrivalTime, 'exitedCourt');
    }

    const dOut = reflect(d, hit.surface.normal);
    builder.pushBounce({
      surface: hit.surface.id,
      point: hit.point,
      time: arrivalTime,
      vIn,
      vOut: scale(dOut, speed),
      normal: hit.surface.normal,
    });

    p = hit.point;
    d = dOut;
    t = arrivalTime;

    if (builder.bounceCount >= maxBounces) {
      return builder.finish(t, 'maxBounces');
    }
  }
};
