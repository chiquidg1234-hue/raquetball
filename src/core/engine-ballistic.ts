/**
 * FASE 7 — Motor balistico: gravedad, arrastre y COR.
 *
 *   a = (0, -g, 0) - k * |v| * v      con k = 0.5 * rho * Cd * A / m
 *
 * Con los valores oficiales k = 0.0194 1/m, lo que significa que el
 * arrastre pesa 1.8 g a 30 m/s y 14.3 g a 85 m/s: DOMINA SOBRE LA
 * GRAVEDAD en todo el rango util. No es un refinamiento opcional; sin el,
 * las trayectorias rapidas no desaceleran y los rebotes tardios quedan
 * demasiado vivos.
 *
 * EL RIESGO NUMERO UNO ES EL TUNNELING. A 85 m/s con un paso de 1/60 s la
 * pelota avanza 1.42 m por frame y la cancha mide 6.1 m de ancho: un
 * integrador de "avanza, luego mira si estas dentro" se salta paredes
 * enteras. Aqui no se hace eso en ningun sitio:
 *
 *   1. La fisica corre a paso fijo (1/1000 s), desacoplada del render.
 *   2. En cada substep se prueba el SEGMENTO p(t) -> p(t+dt) contra los
 *      seis planos, se toma el cruce mas temprano y se avanza EXACTAMENTE
 *      hasta ahi. Luego se rebota y se sigue con lo que queda del paso.
 *   3. La prueba de segmento funciona a cualquier dt, asi que el paso
 *      pequeno es por precision de la INTEGRACION, no por la colision.
 *      Aunque alguien suba el dt, no se puede colar por una pared.
 */

import {
  BALL,
  DRAG_K,
  GRAVITY,
  SIM,
  SURFACE_COR,
} from './constants.js';
import {
  clampToCourt,
  clearsBackWall,
  firstSegmentCrossing,
  type Surface,
} from './court.js';
import type { Shot, SimOptions, Trajectory, Vec3 } from './types.js';
import { TrajectoryBuilder, defaultSampleDt } from './trajectory-builder.js';
import { addScaled, dot, length, normalize, scale } from './vec3.js';

/** Cuantos contactos se admiten dentro de un mismo substep (esquinas). */
const MAX_CONTACTS_PER_STEP = 8;

interface Accel {
  (v: Vec3): Vec3;
}

const makeAccel = (drag: boolean, gravity: boolean): Accel => {
  const g = gravity ? GRAVITY : 0;
  const k = drag ? DRAG_K : 0;
  return (v: Vec3): Vec3 => {
    const speed = length(v);
    const c = k * speed;
    return { x: -c * v.x, y: -g - c * v.y, z: -c * v.z };
  };
};

/**
 * Rebote: se descompone la velocidad entrante en normal y tangencial
 * respecto a la superficie y se aplica una restitucion a cada una.
 *
 *   v_n' = -e_n * v_n     e_n = COR de esa superficie (0.837)
 *   v_t' =  e_t * v_t     e_t = restitucion tangencial (0.65)
 */
export const bounceVelocity = (
  v: Vec3,
  surface: Surface,
  normalRestitution: number,
  tangentialRestitution: number,
): Vec3 => {
  const n = surface.normal;
  const vn = dot(v, n);
  const tangential = addScaled(v, n, -vn);
  return addScaled(
    scale(tangential, tangentialRestitution),
    n,
    -vn * normalRestitution,
  );
};

export const simulateBallistic = (
  shot: Shot,
  opts: SimOptions = {},
): Trajectory => {
  const dt = opts.physicsDt && opts.physicsDt > 0 ? opts.physicsDt : SIM.physicsDt;
  const maxBounces = opts.maxBounces ?? SIM.maxBounces;
  const maxTime = opts.maxTime ?? SIM.maxTime;
  const tangential = opts.tangentialRestitution ?? BALL.tangentialRestitution;
  const corOf = (id: keyof typeof SURFACE_COR): number =>
    opts.surfaceRestitution?.[id] ?? SURFACE_COR[id];

  const accel = makeAccel(!opts.disableDrag, !opts.disableGravity);
  const builder = new TrajectoryBuilder(
    defaultSampleDt(opts.sampleDt),
    'ballistic',
  );

  let p = clampToCourt(shot.origin);
  let v = scale(normalize(shot.direction), Math.max(0, shot.speed));
  let t = 0;

  builder.pushExact(t, p, v);

  while (t < maxTime - 1e-12) {
    let remaining = Math.min(dt, maxTime - t);
    let contacts = 0;

    while (remaining > 1e-12 && contacts < MAX_CONTACTS_PER_STEP) {
      const a0 = accel(v);

      // Velocity Verlet con un paso de correccion. La aceleracion depende
      // de la velocidad (arrastre), asi que el Verlet puro seria
      // implicito; una sola correccion sobra a 1 ms, donde la velocidad
      // cambia como mucho 0.14 m/s de 85.
      const pNext: Vec3 = {
        x: p.x + v.x * remaining + 0.5 * a0.x * remaining * remaining,
        y: p.y + v.y * remaining + 0.5 * a0.y * remaining * remaining,
        z: p.z + v.z * remaining + 0.5 * a0.z * remaining * remaining,
      };
      const vPredicted = addScaled(v, a0, remaining);
      const a1 = accel(vPredicted);
      const vNext: Vec3 = {
        x: v.x + 0.5 * (a0.x + a1.x) * remaining,
        y: v.y + 0.5 * (a0.y + a1.y) * remaining,
        z: v.z + 0.5 * (a0.z + a1.z) * remaining,
      };

      const hit = firstSegmentCrossing(p, pNext, 0);

      // --- tramo libre: ningun plano en el camino ---
      if (!hit) {
        const p0 = p;
        const v0 = v;
        const t0 = t;
        builder.fillGrid(t0, t0 + remaining, (tt) => {
          const s = tt - t0;
          return {
            p: {
              x: p0.x + v0.x * s + 0.5 * a0.x * s * s,
              y: p0.y + v0.y * s + 0.5 * a0.y * s * s,
              z: p0.z + v0.z * s + 0.5 * a0.z * s * s,
            },
            v: addScaled(v0, a0, s),
          };
        });
        p = pNext;
        v = vNext;
        t += remaining;
        remaining = 0;
        break;
      }

      // --- hay contacto dentro del substep ---
      contacts++;
      const s = hit.t;
      const contactTime = t + s * remaining;

      {
        const p0 = p;
        const v0 = v;
        const t0 = t;
        builder.fillGrid(t0, contactTime, (tt) => {
          const tau = tt - t0;
          return {
            p: {
              x: p0.x + v0.x * tau + 0.5 * a0.x * tau * tau,
              y: p0.y + v0.y * tau + 0.5 * a0.y * tau * tau,
              z: p0.z + v0.z * tau + 0.5 * a0.z * tau * tau,
            },
            v: addScaled(v0, a0, tau),
          };
        });
      }

      const vIn = addScaled(v, a0, s * remaining);

      // La pared trasera solo mide 12 ft: por encima no hay pared.
      if (hit.surface.id === 'back' && clearsBackWall(hit.point.y)) {
        builder.pushExact(contactTime, hit.point, vIn);
        return builder.finish(contactTime, 'exitedCourt');
      }

      const vOut = bounceVelocity(
        vIn,
        hit.surface,
        corOf(hit.surface.id),
        tangential,
      );

      // Se guarda la velocidad SALIENTE en la muestra del contacto: asi la
      // energia entre dos muestras consecutivas nunca sube, que es uno de
      // los criterios de aceptacion.
      builder.pushExact(contactTime, hit.point, vOut);
      builder.pushBounce({
        surface: hit.surface.id,
        point: hit.point,
        time: contactTime,
        vIn,
        vOut,
        normal: hit.surface.normal,
      });

      p = hit.point;
      v = vOut;
      remaining -= s * remaining;
      t = contactTime;

      // Condicion de reposo. Sin esto se entra en el bucle clasico de
      // micro-rebotes infinitos contra el piso.
      if (
        hit.surface.id === 'floor' &&
        Math.abs(dot(vOut, hit.surface.normal)) < SIM.restingSpeed
      ) {
        return builder.finish(t, 'restingOnFloor');
      }

      if (builder.bounceCount >= maxBounces) {
        return builder.finish(t, 'maxBounces');
      }
    }

    // Atascado en una esquina con demasiados contactos en un solo paso:
    // es reposo en la practica, y es preferible a colgar el bucle.
    if (contacts >= MAX_CONTACTS_PER_STEP && remaining > 1e-12) {
      return builder.finish(t, 'restingOnFloor');
    }
  }

  builder.pushExact(t, p, v);
  return builder.finish(t, 'maxTime');
};
