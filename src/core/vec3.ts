/** Operaciones de vector. Inmutables salvo donde se dice lo contrario. */

import type { Vec3 } from './types.js';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

/** a + b*s — el patron mas comun en el integrador. */
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  if (len === 0) return v3(0, 0, 0);
  return scale(a, 1 / len);
};

/** Reflexion especular: d' = d - 2(d.n)n  con n unitario. */
export const reflect = (d: Vec3, n: Vec3): Vec3 =>
  addScaled(d, n, -2 * dot(d, n));

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const negate = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

export const equalsApprox = (a: Vec3, b: Vec3, eps = 1e-9): boolean =>
  Math.abs(a.x - b.x) < eps &&
  Math.abs(a.y - b.y) < eps &&
  Math.abs(a.z - b.z) < eps;

/**
 * Direccion unitaria desde angulos, con la convencion del panel de sliders:
 *   azimut   0 = perpendicular a la pared frontal (hacia -Z),
 *            positivo = hacia la pared derecha (+X).
 *   elevacion 0 = horizontal, positivo = hacia el techo (+Y).
 */
export const fromAzimuthElevation = (
  azimuthDeg: number,
  elevationDeg: number,
): Vec3 => {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    x: cosEl * Math.sin(az),
    y: Math.sin(el),
    z: -cosEl * Math.cos(az),
  };
};

/** La inversa de fromAzimuthElevation. */
export const toAzimuthElevation = (
  d: Vec3,
): { azimuthDeg: number; elevationDeg: number } => {
  const n = normalize(d);
  const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI;
  const azimuthDeg = (Math.atan2(n.x, -n.z) * 180) / Math.PI;
  return { azimuthDeg, elevationDeg };
};

export const angleBetweenDeg = (a: Vec3, b: Vec3): number => {
  const c = dot(normalize(a), normalize(b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
