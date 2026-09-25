/**
 * El sitio de juego: donde se juega (altitud, temperatura, presion), con
 * que pelota y en que cancha. Todo lo que no es el tiro pero cambia por
 * donde va la pelota.
 *
 * Se traduce a SimOptions en un solo sitio, `venueSimOptions`, y de ahi lo
 * usan la vista, el solver y los fantasmas de la pizarra. Si alguno se
 * saltara esto, resolveria el tiro con el aire de otra ciudad.
 */

import { airDensity, dragConstant, reynolds, standardPressure } from './atmosphere.js';
import {
  BALLS,
  DEFAULT_BALL,
  REBOUND_RANGE_IN,
  corAtTemperature,
  corForRebound,
  isBallId,
  type BallId,
} from './balls.js';
import { BALL, COR_SPEED } from './constants.js';
import { SPIN } from './spin.js';
import {
  COR_FACTOR_RANGE,
  FLOOR_MATERIALS,
  FRICTION_RANGE,
  WALL_MATERIALS,
  isFloorMaterialId,
  isWallMaterialId,
  type FloorMaterialId,
  type WallMaterialId,
} from './surfaces.js';
import type { SurfaceId, VenuePhysics } from './types.js';

export type PlaceId =
  | 'ref'
  | 'scz'
  | 'tja'
  | 'cbba'
  | 'sucre'
  | 'lpz'
  | 'elalto'
  | 'custom';

export interface Place {
  id: Exclude<PlaceId, 'custom'>;
  name: string;
  /** m sobre el nivel del mar. */
  altitude: number;
  source: string;
}

/**
 * Altitudes confirmadas (INVESTIGACION.md, seccion 3). Tarija y Sucre se
 * corrigieron respecto al encargo (1875 -> 1866, 2810 -> 2790) segun el INE.
 */
export const PLACES: Record<Exclude<PlaceId, 'custom'>, Place> = {
  ref: { id: 'ref', name: 'Nivel del mar (referencia)', altitude: 0, source: 'atmósfera estándar' },
  scz: { id: 'scz', name: 'Santa Cruz de la Sierra', altitude: 416, source: 'INE' },
  tja: { id: 'tja', name: 'Tarija', altitude: 1866, source: 'INE' },
  cbba: { id: 'cbba', name: 'Cochabamba', altitude: 2558, source: 'INE' },
  sucre: { id: 'sucre', name: 'Sucre', altitude: 2790, source: 'INE' },
  lpz: { id: 'lpz', name: 'La Paz', altitude: 3640, source: 'INE' },
  elalto: { id: 'elalto', name: 'El Alto', altitude: 4150, source: 'Wikipedia (media)' },
};

export const PLACE_IDS = Object.keys(PLACES) as Exclude<PlaceId, 'custom'>[];

export interface Venue {
  place: PlaceId;
  /** m */
  altitude: number;
  /** C: temperatura del aire, y de la pelota. */
  temperatureC: number;
  /** hPa medidos; null = la estandar de la altitud. */
  pressureHpa: number | null;
  ball: BallId;
  /** Rebote de la pelota en la prueba de homologacion (68-72 in). */
  reboundIn: number;
  /** Cambio relativo del COR por grado. Sin dato publicado: 0. */
  corPerDegree: number;
  walls: WallMaterialId;
  floor: FloorMaterialId;
  wallCorFactor: number;
  /** mu de las paredes (y el techo). */
  wallFriction: number;
  floorCorFactor: number;
  /** mu del piso. */
  floorFriction: number;
  /**
   * Rigidez efectiva de la pelota, E (kPa). Solo decide el nick. Sin dato
   * publicado: 45 es una estimacion (INVESTIGACION.md, seccion 8).
   */
  ballStiffnessKpa: number;
  /**
   * Fraccion del COR que se pierde por cada m/s de impacto por encima de la
   * prueba de homologacion. Sin dato de racquetball: 0.92 % sale de squash
   * y tenis (constants.ts, COR_SPEED).
   */
  corSpeedLoss: number;
}

export const LIMITS = {
  altitude: { min: 0, max: 5000 },
  temperatureC: { min: -5, max: 40 },
  pressureHpa: { min: 500, max: 1100 },
  reboundIn: REBOUND_RANGE_IN,
  corPerDegree: { min: 0, max: 0.01 },
  corFactor: COR_FACTOR_RANGE,
  friction: FRICTION_RANGE,
  /** De una pelota blanda (20 kPa) a la de squash (~100) y algo mas. */
  ballStiffnessKpa: { min: 20, max: 150 },
  /** De COR constante (0) al doble de la pendiente de squash y tenis. */
  corSpeedLoss: { min: 0, max: 0.02 },
} as const;

/** Lo que equivale al motor de antes: nivel del mar, 20 C, pelota de 70 in. */
export const DEFAULT_VENUE: Venue = {
  place: 'ref',
  altitude: 0,
  temperatureC: 20,
  pressureHpa: null,
  ball: DEFAULT_BALL,
  reboundIn: BALLS[DEFAULT_BALL].reboundIn,
  corPerDegree: 0,
  walls: 'panel',
  floor: 'wood',
  wallCorFactor: WALL_MATERIALS.panel.corFactor,
  wallFriction: WALL_MATERIALS.panel.friction,
  floorCorFactor: FLOOR_MATERIALS.wood.corFactor,
  floorFriction: FLOOR_MATERIALS.wood.friction,
  ballStiffnessKpa: SPIN.stiffness / 1000,
  corSpeedLoss: COR_SPEED.lossPerMs,
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

/**
 * Normaliza cualquier cosa a un Venue valido: lo que no entienda lo toma
 * del valor por defecto. Se usa al restaurar de localStorage y de la URL.
 * Los documentos de antes traian una "restitucion tangencial" que ya no
 * existe (no hay forma honesta de pasarla a friccion): se ignora.
 */
export const normalizeVenue = (raw: unknown): Venue => {
  const d = DEFAULT_VENUE;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  const place: PlaceId =
    r.place === 'custom' || (typeof r.place === 'string' && r.place in PLACES)
      ? (r.place as PlaceId)
      : d.place;
  const altitude =
    place === 'custom'
      ? num(r.altitude, d.altitude, LIMITS.altitude.min, LIMITS.altitude.max)
      : PLACES[place].altitude;
  const pressure =
    typeof r.pressureHpa === 'number' && Number.isFinite(r.pressureHpa)
      ? clamp(r.pressureHpa, LIMITS.pressureHpa.min, LIMITS.pressureHpa.max)
      : null;
  return {
    place,
    altitude,
    temperatureC: num(r.temperatureC, d.temperatureC, LIMITS.temperatureC.min, LIMITS.temperatureC.max),
    pressureHpa: pressure,
    ball: isBallId(r.ball) ? r.ball : d.ball,
    reboundIn: num(r.reboundIn, d.reboundIn, LIMITS.reboundIn.min, LIMITS.reboundIn.max),
    corPerDegree: num(r.corPerDegree, d.corPerDegree, LIMITS.corPerDegree.min, LIMITS.corPerDegree.max),
    walls: isWallMaterialId(r.walls) ? r.walls : d.walls,
    floor: isFloorMaterialId(r.floor) ? r.floor : d.floor,
    wallCorFactor: num(r.wallCorFactor, d.wallCorFactor, LIMITS.corFactor.min, LIMITS.corFactor.max),
    wallFriction: num(r.wallFriction, d.wallFriction, LIMITS.friction.min, LIMITS.friction.max),
    floorCorFactor: num(r.floorCorFactor, d.floorCorFactor, LIMITS.corFactor.min, LIMITS.corFactor.max),
    floorFriction: num(r.floorFriction, d.floorFriction, LIMITS.friction.min, LIMITS.friction.max),
    ballStiffnessKpa: num(
      r.ballStiffnessKpa,
      d.ballStiffnessKpa,
      LIMITS.ballStiffnessKpa.min,
      LIMITS.ballStiffnessKpa.max,
    ),
    corSpeedLoss: num(r.corSpeedLoss, d.corSpeedLoss, LIMITS.corSpeedLoss.min, LIMITS.corSpeedLoss.max),
  };
};

/** Cambiar de ciudad fija su altitud; 'custom' conserva la que haya. */
export const withPlace = (v: Venue, place: PlaceId): Venue =>
  place === 'custom'
    ? { ...v, place }
    : { ...v, place, altitude: PLACES[place].altitude };

/** Cambiar de pelota trae su rebote estimado. */
export const withBall = (v: Venue, ball: BallId): Venue => ({
  ...v,
  ball,
  reboundIn: BALLS[ball].reboundIn,
});

/** Cambiar de material trae sus valores por defecto. */
export const withWalls = (v: Venue, walls: WallMaterialId): Venue => ({
  ...v,
  walls,
  wallCorFactor: WALL_MATERIALS[walls].corFactor,
  wallFriction: WALL_MATERIALS[walls].friction,
});

export const withFloor = (v: Venue, floor: FloorMaterialId): Venue => ({
  ...v,
  floor,
  floorCorFactor: FLOOR_MATERIALS[floor].corFactor,
  floorFriction: FLOOR_MATERIALS[floor].friction,
});

export interface VenueAir {
  /** Pa */
  pressure: number;
  /** kg/m3 */
  density: number;
  /** 1/m */
  dragK: number;
  /** Si la presion es la estandar o una medida. */
  pressureSource: 'standard' | 'measured';
}

export const venueAir = (v: Venue): VenueAir => {
  const measured = v.pressureHpa != null && v.pressureHpa > 0;
  const pressure = measured ? v.pressureHpa! * 100 : standardPressure(v.altitude);
  const density = airDensity(v);
  return {
    pressure,
    density,
    dragK: dragConstant(density, BALL),
    pressureSource: measured ? 'measured' : 'standard',
  };
};

/** COR de la pelota a la temperatura de la cancha, antes de la superficie. */
export const venueBallCor = (v: Venue): number =>
  corAtTemperature(corForRebound(v.reboundIn), v.temperatureC, v.corPerDegree);

export const venueReynolds = (v: Venue, speed: number): number =>
  reynolds(speed, venueAir(v).density, v.temperatureC, BALL.diameter);

const WALLS: readonly SurfaceId[] = ['front', 'back', 'left', 'right', 'ceiling'];

/**
 * El sitio de juego como opciones del motor. El geometrico las ignora (no
 * tiene aire ni perdidas); el balistico usa todas.
 */
export const venueSimOptions = (v: Venue): VenuePhysics => {
  const e = venueBallCor(v);
  const surfaceRestitution: Partial<Record<SurfaceId, number>> = {};
  const surfaceFriction: Partial<Record<SurfaceId, number>> = {};
  for (const id of WALLS) {
    surfaceRestitution[id] = Math.min(0.98, e * v.wallCorFactor);
    surfaceFriction[id] = v.wallFriction;
  }
  surfaceRestitution.floor = Math.min(0.98, e * v.floorCorFactor);
  surfaceFriction.floor = v.floorFriction;
  return {
    dragK: venueAir(v).dragK,
    surfaceRestitution,
    surfaceFriction,
    ballStiffness: v.ballStiffnessKpa * 1000,
    corSpeedLoss: v.corSpeedLoss,
  };
};

export const sameVenue = (a: Venue, b: Venue): boolean =>
  (Object.keys(a) as (keyof Venue)[]).every((k) => Object.is(a[k], b[k]));
