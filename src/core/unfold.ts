/**
 * FASE 6 — El modo espejo: la cancha desplegada.
 *
 * Es literalmente como los entrenadores ensenan el pinch. Se refleja la
 * cancha al otro lado de la pared lateral y se ve que la trayectoria de
 * dos tramos (lateral -> frontal) es una LINEA RECTA hacia el punto
 * espejado. Apuntar deja de ser intuicion y pasa a ser mirar un punto.
 *
 * Detalle que decide si la demostracion convence o no: se refleja sobre el
 * PLANO DEL CENTRO DE LA PELOTA (x = r, o x = W - r), no sobre la pared
 * fisica. La trayectoria que se dibuja es la del centro; reflejando sobre
 * ese mismo plano, el punto de rebote es su propio reflejo y la recta pasa
 * EXACTAMENTE por el. Reflejando sobre la pared quedaria desviada 2.9 cm
 * y la recta ya no tocaria el rebote, que es justo lo que hay que ensenar.
 *
 * Con el motor geometrico la recta es exacta. Con el balistico la
 * trayectoria se curva, asi que es una ayuda visual y hay que etiquetarla
 * como tal.
 */

import { COURT } from './constants.js';
import { CENTER_BOX } from './court.js';
import type { Bounce, Sample, Trajectory, Vec3 } from './types.js';

export type SideWall = 'left' | 'right';

export interface UnfoldedCourt {
  wall: SideWall;
  /** Plano de reflexion en X. */
  mirrorX: number;
  /** Rectangulo de la cancha espejada, en planta. */
  rect: { x0: number; x1: number; z0: number; z1: number };
  bounce: Bounce;
  /** El segundo tramo, reflejado al otro lado de la pared. */
  mirroredSamples: Sample[];
  /** El punto de mira espejado: adonde hay que mirar para apuntar. */
  mirroredTarget: Vec3;
  /** Recta origen -> punto espejado. Pasa por el punto de rebote. */
  straight: [Vec3, Vec3];
  /** Exacta con el motor geometrico; aproximada con el balistico. */
  exact: boolean;
}

const mirrorPoint = (p: Vec3, mirrorX: number): Vec3 => ({
  x: 2 * mirrorX - p.x,
  y: p.y,
  z: p.z,
});

const mirrorSample = (s: Sample, mirrorX: number): Sample => ({
  t: s.t,
  p: mirrorPoint(s.p, mirrorX),
  v: { x: -s.v.x, y: s.v.y, z: s.v.z },
});

/**
 * Despliega sobre el primer rebote en una pared lateral. Devuelve null si
 * el tiro no toca ninguna lateral: no hay nada que desdoblar.
 */
export const unfoldFirstSideBounce = (
  trajectory: Trajectory,
): UnfoldedCourt | null => {
  const index = trajectory.bounces.findIndex(
    (b) => b.surface === 'left' || b.surface === 'right',
  );
  if (index === -1) return null;

  const bounce = trajectory.bounces[index]!;
  const wall = bounce.surface as SideWall;
  const mirrorX = wall === 'left' ? CENTER_BOX.xMin : CENTER_BOX.xMax;

  const next = trajectory.bounces[index + 1];
  const legEnd = next ? next.time : trajectory.totalTime;

  const leg = trajectory.samples.filter(
    (s) => s.t >= bounce.time - 1e-12 && s.t <= legEnd + 1e-12,
  );
  const mirroredSamples = leg.map((s) => mirrorSample(s, mirrorX));

  const endPoint = next ? next.point : (trajectory.samples.at(-1)?.p ?? bounce.point);
  const mirroredTarget = mirrorPoint(endPoint, mirrorX);
  const origin = trajectory.samples[0]?.p ?? bounce.point;

  return {
    wall,
    mirrorX,
    rect: {
      x0: 2 * mirrorX - COURT.width,
      x1: 2 * mirrorX,
      z0: 0,
      z1: COURT.length,
    },
    bounce,
    mirroredSamples,
    mirroredTarget,
    straight: [origin, mirroredTarget],
    exact: trajectory.model === 'geometric',
  };
};

/**
 * Distancia del punto de rebote a la recta origen -> punto espejado.
 * Con el motor geometrico debe ser cero: es la comprobacion de que el
 * truco del espejo esta bien montado, y hay un test que la exige.
 */
export const straightLineError = (u: UnfoldedCourt): number => {
  const [a, b] = u.straight;
  const p = u.bounce.point;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const cx = aby * apz - abz * apy;
  const cy = abz * apx - abx * apz;
  const cz = abx * apy - aby * apx;
  const abLen = Math.hypot(abx, aby, abz);
  if (abLen < 1e-12) return Math.hypot(apx, apy, apz);
  return Math.hypot(cx, cy, cz) / abLen;
};
