/**
 * FASE 11 — El formato de documento. Uno solo, compartido por las tres
 * vias de persistencia: localStorage, JSON exportado y hash de la URL.
 *
 * Los nombres de campo son cortos a proposito: este objeto viaja
 * comprimido dentro de una URL, y cada byte cuenta.
 */

export const DOC_VERSION = 1 as const;

export interface ShotDoc {
  /** origen [x, y, z] */
  o: [number, number, number];
  /** azimut en grados */
  a: number;
  /** elevacion en grados */
  e: number;
  /** velocidad en m/s */
  s: number;
  /** motor: g = geometrico, b = balistico */
  m: 'g' | 'b';
}

export interface ViewDoc {
  /** layout activo */
  l?: string;
  /** modo espejo */
  mi?: 1 | 0;
  /** modo saque */
  sv?: 1 | 0;
}

export interface NamedShot {
  id: string;
  n: string;
  t: number;
  shot: ShotDoc;
}

export interface Doc {
  v: typeof DOC_VERSION;
  shot: ShotDoc;
  view?: ViewDoc;
  /** Tiros guardados. Solo viaja en el JSON y en localStorage. */
  saved?: NamedShot[];
  /** Jugadas de la pizarra (fase 9). */
  plays?: unknown[];
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export const toShotDoc = (s: {
  origin: { x: number; y: number; z: number };
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
  model: 'geometric' | 'ballistic';
}): ShotDoc => ({
  o: [r3(s.origin.x), r3(s.origin.y), r3(s.origin.z)],
  a: r3(s.azimuthDeg),
  e: r3(s.elevationDeg),
  s: r3(s.speed),
  m: s.model === 'ballistic' ? 'b' : 'g',
});

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Valida y sanea un ShotDoc que viene de fuera. Nunca lanza. */
export const fromShotDoc = (
  raw: unknown,
): {
  origin: { x: number; y: number; z: number };
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
  model: 'geometric' | 'ballistic';
} | null => {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<ShotDoc>;
  if (!Array.isArray(d.o) || d.o.length !== 3) return null;
  return {
    origin: {
      x: num(d.o[0], 3),
      y: num(d.o[1], 0.9),
      z: num(d.o[2], 8),
    },
    azimuthDeg: num(d.a, 0),
    elevationDeg: num(d.e, 4),
    speed: num(d.s, 45),
    model: d.m === 'b' ? 'ballistic' : 'geometric',
  };
};

export const isDoc = (raw: unknown): raw is Doc =>
  !!raw &&
  typeof raw === 'object' &&
  (raw as Doc).v === DOC_VERSION &&
  fromShotDoc((raw as Doc).shot) !== null;
