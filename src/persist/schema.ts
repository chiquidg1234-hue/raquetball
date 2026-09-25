/**
 * FASE 11 — El formato de documento. Uno solo, compartido por las tres
 * vias de persistencia: localStorage, JSON exportado y hash de la URL.
 *
 * Los nombres de campo son cortos a proposito: este objeto viaja
 * comprimido dentro de una URL, y cada byte cuenta.
 */

import {
  DEFAULT_VENUE,
  normalizeVenue,
  type Venue,
} from '../core/venue.js';

/**
 * v2 anade el sitio de juego (`venue`). Los documentos v1 se siguen
 * aceptando: no traen sitio y se leen con el de referencia (nivel del mar,
 * 20 C), que es el aire con el que se hicieron.
 */
export const DOC_VERSION = 2 as const;
export type DocVersion = 1 | typeof DOC_VERSION;

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
  /** raqueta en el 3D: derecha, reves o ninguna */
  rk?: 'f' | 'b' | 'n';
  /** diestro o zurdo */
  hd?: 'r' | 'l';
}

export interface NamedShot {
  id: string;
  n: string;
  t: number;
  shot: ShotDoc;
}

/** El sitio de juego, con claves cortas porque viaja en la URL. */
export interface VenueDoc {
  /** lugar */
  p: string;
  /** altitud, m */
  h: number;
  /** temperatura, C */
  t: number;
  /** presion medida, hPa (si no hay, la estandar) */
  hp?: number;
  /** pelota */
  b: string;
  /** rebote de homologacion, in */
  r: number;
  /** sensibilidad del COR, por C */
  ct: number;
  /** paredes y piso */
  w: string;
  f: string;
  /** calibracion: factor de COR y friccion (mu) de paredes y piso */
  wc: number;
  wm?: number;
  fc: number;
  fm?: number;
  /** rigidez de la pelota, kPa */
  e?: number;
  /** COR que se pierde por m/s de impacto (fraccion) */
  cv?: number;
  /**
   * Restitucion tangencial de los documentos de antes del efecto. Ya no se
   * usa: no hay forma honesta de pasarla a friccion. Se lee y se ignora.
   */
  wt?: number;
  ft?: number;
}

/** El bote con la mano del saque (solo si el tiro es un saque). */
export interface ServeDoc {
  /** altura de suelta, m */
  r: number;
  /** momento del golpe, en fases del rebote */
  p: number;
  /**
   * El lanzamiento con la mano (ronda 2): fuerza (m/s), azimut y angulo
   * hacia abajo (grados). Los enlaces de antes no lo traen: eran soltarla.
   */
  s?: number;
  a?: number;
  d?: number;
  /**
   * Donde suelta la mano. El tiro guarda el punto de GOLPE; con un
   * lanzamiento hacia delante el golpe no esta encima de la mano.
   */
  x?: number;
  z?: number;
}

export interface Doc {
  v: DocVersion;
  shot: ShotDoc;
  venue?: VenueDoc;
  serve?: ServeDoc;
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

export const toVenueDoc = (v: Venue): VenueDoc => {
  const doc: VenueDoc = {
    p: v.place,
    h: Math.round(v.altitude),
    t: r3(v.temperatureC),
    b: v.ball,
    r: r3(v.reboundIn),
    ct: r3(v.corPerDegree * 1000) / 1000,
    w: v.walls,
    f: v.floor,
    wc: r3(v.wallCorFactor),
    wm: r3(v.wallFriction),
    fc: r3(v.floorCorFactor),
    fm: r3(v.floorFriction),
    e: r3(v.ballStiffnessKpa),
    cv: Math.round(v.corSpeedLoss * 1e5) / 1e5,
  };
  if (v.pressureHpa != null) doc.hp = r3(v.pressureHpa);
  return doc;
};

/** Valida y sanea. Un documento sin sitio (v1) da el de referencia. */
export const fromVenueDoc = (raw: unknown): Venue => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VENUE };
  const d = raw as Partial<VenueDoc>;
  return normalizeVenue({
    place: d.p,
    altitude: d.h,
    temperatureC: d.t,
    pressureHpa: d.hp,
    ball: d.b,
    reboundIn: d.r,
    corPerDegree: d.ct,
    walls: d.w,
    floor: d.f,
    wallCorFactor: d.wc,
    wallFriction: d.wm,
    floorCorFactor: d.fc,
    floorFriction: d.fm,
    ballStiffnessKpa: d.e,
    corSpeedLoss: d.cv,
  });
};

export const toDoc = (s: Parameters<typeof toShotDoc>[0] & { venue: Venue }): Doc => ({
  v: DOC_VERSION,
  shot: toShotDoc(s),
  venue: toVenueDoc(s.venue),
});

export const isDoc = (raw: unknown): raw is Doc =>
  !!raw &&
  typeof raw === 'object' &&
  ((raw as Doc).v === 1 || (raw as Doc).v === DOC_VERSION) &&
  fromShotDoc((raw as Doc).shot) !== null;
