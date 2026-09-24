/**
 * Utilidades puras sobre `Trajectory`. Las comparten las vistas 2D, la 3D,
 * el inspector y las reglas. No dependen del DOM.
 */

import type { Sample, Trajectory, Vec3 } from './types.js';
import { length } from './vec3.js';

/**
 * Parte las muestras en tramos separados por los rebotes. El punto de
 * rebote pertenece a los dos tramos, asi que no queda hueco al dibujar.
 */
export const splitByBounce = (trajectory: Trajectory): Sample[][] => {
  const cuts = trajectory.bounces.map((b) => b.time);
  const segments: Sample[][] = [];
  let current: Sample[] = [];
  let cutIndex = 0;

  for (const s of trajectory.samples) {
    current.push(s);
    while (cutIndex < cuts.length && Math.abs(s.t - cuts[cutIndex]!) < 1e-12) {
      segments.push(current);
      current = [s];
      cutIndex++;
    }
  }
  if (current.length > 1 || segments.length === 0) segments.push(current);
  return segments;
};

const indexBefore = (samples: Sample[], t: number): number => {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
};

export interface StateAt {
  p: Vec3;
  v: Vec3;
  t: number;
}

/** Estado interpolado en un instante. Satura en los extremos. */
export const stateAt = (trajectory: Trajectory, t: number): StateAt | null => {
  const s = trajectory.samples;
  if (s.length === 0) return null;
  const first = s[0]!;
  if (t <= first.t) return { p: first.p, v: first.v, t: first.t };
  const last = s[s.length - 1]!;
  if (t >= last.t) return { p: last.p, v: last.v, t: last.t };

  const lo = indexBefore(s, t);
  const a = s[lo]!;
  const b = s[lo + 1]!;
  const span = b.t - a.t;
  const k = span > 1e-12 ? (t - a.t) / span : 0;
  return {
    t,
    p: {
      x: a.p.x + (b.p.x - a.p.x) * k,
      y: a.p.y + (b.p.y - a.p.y) * k,
      z: a.p.z + (b.p.z - a.p.z) * k,
    },
    v: {
      x: a.v.x + (b.v.x - a.v.x) * k,
      y: a.v.y + (b.v.y - a.v.y) * k,
      z: a.v.z + (b.v.z - a.v.z) * k,
    },
  };
};

export const positionAt = (trajectory: Trajectory, t: number): Vec3 | null =>
  stateAt(trajectory, t)?.p ?? null;

/** Rango de velocidad de la trayectoria, para normalizar el gradiente. */
export const speedRange = (
  trajectory: Trajectory,
): { min: number; max: number } => {
  let min = Infinity;
  let max = 0;
  for (const s of trajectory.samples) {
    const sp = length(s.v);
    if (sp < min) min = sp;
    if (sp > max) max = sp;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
};

/** Longitud total del recorrido, en metros. */
export const pathLength = (trajectory: Trajectory): number => {
  let total = 0;
  const s = trajectory.samples;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!.p;
    const b = s[i]!.p;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
};

/** Energia cinetica especifica (v^2/2). Para el test de energia monotona. */
export const specificKineticEnergy = (v: Vec3): number =>
  (v.x * v.x + v.y * v.y + v.z * v.z) / 2;
