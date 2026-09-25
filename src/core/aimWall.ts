/**
 * Apuntar a un punto de una PARED (o del techo) con la fisica de verdad.
 *
 * Dos usos:
 *   - El crack. El nick (INVESTIGACION.md, seccion 8) solo sale si la
 *     pelota toca la pared con el centro entre 0.6 y 0.75 diametros del
 *     piso: una franja de 8.6 mm. A ojo no se acierta.
 *   - Los presets. "Frontal a la altura de la rodilla" apuntado en linea
 *     recta llega mas abajo: la gravedad y el aire lo bajan. En el motor
 *     balistico el preset se resuelve para tocar DE VERDAD ese punto.
 *
 * Se resuelve con el mismo motor que dibuja: Newton en (azimut, elevacion)
 * sobre el punto donde la pelota toca esa superficie. `via` son las que
 * tiene que tocar ANTES, en orden: el saque crack es via ['front'] hacia
 * una lateral.
 */

import { BALL, GRAVITY } from './constants.js';
import { CENTER_BOX, SURFACES, SURFACE_BY_ID } from './court.js';
import { simulateBallistic } from './engine-ballistic.js';
import type { Bounce, SurfaceId, Trajectory, Vec3, VenuePhysics } from './types.js';
import { fromAzimuthElevation, normalize, sub } from './vec3.js';

export type CrackWall = 'front' | 'left' | 'right' | 'back';

export interface WallAim {
  /** Superficie que hay que tocar en `point`. */
  surface: SurfaceId;
  /** Centro de la pelota en el contacto: un punto del plano de esa superficie. */
  point: Vec3;
  /** Superficies que toca antes, en orden. */
  via?: SurfaceId[];
}

export interface WallAimResult {
  ok: boolean;
  azimuthDeg: number;
  elevationDeg: number;
  /** Distancia entre donde toca y donde se pedia (m). */
  error: number;
  trajectory: Trajectory | null;
  /** El contacto con esa superficie, si lo hay. */
  contact: Bounce | null;
}

/** El centro de la banda del nick: 0.675 diametros, 38.6 mm. */
export const CRACK_HEIGHT = 0.675 * BALL.diameter;

/** Un punto del crack de una pared vertical: `along` es x o z segun la pared. */
export const crackPoint = (wall: CrackWall, along: number): Vec3 => {
  switch (wall) {
    case 'front':
      return { x: along, y: CRACK_HEIGHT, z: CENTER_BOX.zMin };
    case 'back':
      return { x: along, y: CRACK_HEIGHT, z: CENTER_BOX.zMax };
    case 'left':
      return { x: CENTER_BOX.xMin, y: CRACK_HEIGHT, z: along };
    case 'right':
      return { x: CENTER_BOX.xMax, y: CRACK_HEIGHT, z: along };
  }
};

/** Sobre que plano de la cancha cae un punto (centro de la pelota), si cae. */
export const surfaceAt = (p: Vec3, tol = 1e-6): SurfaceId | null =>
  SURFACES.find((s) => Math.abs(p[s.axis] - s.centerCoord) < tol)?.id ?? null;

/** Las dos coordenadas que mueven el punto DENTRO de ese plano. */
const inPlane = (surface: SurfaceId, p: Vec3): [number, number] => {
  const axis = SURFACE_BY_ID[surface].axis;
  return axis === 'z' ? [p.x, p.y] : axis === 'x' ? [p.z, p.y] : [p.x, p.z];
};

/**
 * Semilla geometrica: se despliega la cancha sobre las paredes de `via`
 * (el truco del espejo) y se apunta en recta al punto reflejado, subido lo
 * que la gravedad lo va a bajar en el vuelo (g t^2/2 con t = distancia /
 * velocidad). Sin esa correccion, apuntando a 4 cm del piso la pelota bota
 * antes de llegar.
 */
const seedAngles = (origin: Vec3, aim: WallAim, speed: number): [number, number] => {
  let p = aim.point;
  for (const id of [...(aim.via ?? [])].reverse()) {
    const s = SURFACE_BY_ID[id];
    p = { ...p, [s.axis]: 2 * s.centerCoord - p[s.axis] };
  }
  const t = Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) / Math.max(speed, 1);
  const d = normalize(sub({ ...p, y: p.y + 0.5 * GRAVITY * t * t }, origin));
  return [
    (Math.atan2(d.x, -d.z) * 180) / Math.PI,
    (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI,
  ];
};

interface Eval {
  trajectory: Trajectory;
  contact: Bounce | null;
  residual: [number, number] | null;
}

const run = (
  origin: Vec3,
  speed: number,
  physics: VenuePhysics,
  aim: WallAim,
  az: number,
  el: number,
): Eval => {
  const via = aim.via ?? [];
  const trajectory = simulateBallistic(
    { origin, direction: fromAzimuthElevation(az, el), speed },
    { ...physics, maxBounces: via.length + 2, sampleDt: 1 / 60 },
  );
  const b = trajectory.bounces;
  const ordered = via.every((s, i) => b[i]?.surface === s);
  const contact = ordered && b[via.length]?.surface === aim.surface ? b[via.length]! : null;
  if (!contact) return { trajectory, contact: null, residual: null };
  const [u, v] = inPlane(aim.surface, contact.point);
  const [u0, v0] = inPlane(aim.surface, aim.point);
  return { trajectory, contact, residual: [u - u0, v - v0] };
};

/**
 * Newton de dos variables con derivadas numericas y paso amortiguado. La
 * tolerancia por defecto es 1 mm: la banda del nick mide 8.6.
 */
export const solveWallAim = (
  origin: Vec3,
  speed: number,
  physics: VenuePhysics,
  aim: WallAim,
  opts: { seed?: [number, number]; tolerance?: number; maxIterations?: number } = {},
): WallAimResult => {
  const tolerance = opts.tolerance ?? 0.001;
  const maxIterations = opts.maxIterations ?? 30;
  let [az, el] = opts.seed ?? seedAngles(origin, aim, speed);
  let cur = run(origin, speed, physics, aim, az, el);
  const h = 1e-3; // grados

  // Si la semilla no llega a esa pared por ese camino, un barrido grueso
  // alrededor encuentra desde donde empezar.
  if (!cur.residual) {
    let best: { az: number; el: number; e: Eval; d: number } | null = null;
    for (let dEl = -3; dEl <= 12; dEl += 0.5) {
      for (let dAz = -6; dAz <= 6; dAz += 1.5) {
        const e = run(origin, speed, physics, aim, az + dAz, el + dEl);
        if (!e.residual) continue;
        const d = Math.hypot(...e.residual);
        if (!best || d < best.d) best = { az: az + dAz, el: el + dEl, e, d };
      }
    }
    if (best) {
      az = best.az;
      el = best.el;
      cur = best.e;
    }
  }

  for (let i = 0; i < maxIterations && cur.residual; i++) {
    const [r0, r1] = cur.residual;
    if (Math.hypot(r0, r1) < tolerance) break;
    const da = run(origin, speed, physics, aim, az + h, el).residual;
    const de = run(origin, speed, physics, aim, az, el + h).residual;
    if (!da || !de) break;
    const j00 = (da[0] - r0) / h;
    const j10 = (da[1] - r1) / h;
    const j01 = (de[0] - r0) / h;
    const j11 = (de[1] - r1) / h;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-12) break;
    let stepA = -(j11 * r0 - j01 * r1) / det;
    let stepE = -(-j10 * r0 + j00 * r1) / det;
    // Pasos de mas de 5 grados saltan a otra familia de tiros.
    const big = Math.max(Math.abs(stepA), Math.abs(stepE));
    if (big > 5) {
      stepA *= 5 / big;
      stepE *= 5 / big;
    }
    // Amortiguar: si el paso empeora, se parte a la mitad.
    let accepted = false;
    for (let k = 0; k < 6 && !accepted; k++) {
      const next = run(origin, speed, physics, aim, az + stepA, el + stepE);
      if (next.residual && Math.hypot(...next.residual) < Math.hypot(r0, r1)) {
        az += stepA;
        el += stepE;
        cur = next;
        accepted = true;
      } else {
        stepA /= 2;
        stepE /= 2;
      }
    }
    if (!accepted) break;
  }

  const error = cur.residual ? Math.hypot(...cur.residual) : Infinity;
  return {
    ok: error < tolerance,
    azimuthDeg: az,
    elevationDeg: el,
    error,
    trajectory: cur.trajectory,
    contact: cur.contact,
  };
};
