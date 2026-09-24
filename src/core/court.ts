/**
 * Las seis superficies de la cancha, como planos con normal hacia adentro.
 *
 * CONVENIO DE RADIO (fijado en la fase 0, no negociable):
 *
 *   Todas las pruebas de colision se hacen contra planos DESPLAZADOS HACIA
 *   ADENTRO por BALL.radius, y todo punto que se registra o se dibuja es el
 *   CENTRO de la pelota. Mezclar los dos convenios es la fuente numero uno
 *   de bugs de "la pelota se mete medio centimetro en la pared".
 *
 * El volumen donde puede estar el centro de la pelota es por tanto una caja
 * mas pequena que la cancha: [r, width-r] x [r, height-r] x [r, length-r].
 */

import { BALL, COURT, SIM } from './constants.js';
import type { SurfaceId, Vec3 } from './types.js';
import { v3 } from './vec3.js';

export type Axis = 'x' | 'y' | 'z';

export interface Surface {
  id: SurfaceId;
  axis: Axis;
  /** Coordenada del plano fisico (la pared misma). */
  wallCoord: number;
  /** Coordenada del plano desplazado por el radio (donde vive el centro). */
  centerCoord: number;
  /** Normal unitaria hacia el interior de la cancha. */
  normal: Vec3;
  /** +1 si el interior esta en coordenada creciente, -1 si decreciente. */
  inwardSign: 1 | -1;
  /** Etiqueta legible, para la UI. */
  label: string;
}

const r = BALL.radius;

export const SURFACES: readonly Surface[] = [
  {
    id: 'front',
    axis: 'z',
    wallCoord: 0,
    centerCoord: r,
    normal: v3(0, 0, 1),
    inwardSign: 1,
    label: 'frontal',
  },
  {
    id: 'back',
    axis: 'z',
    wallCoord: COURT.length,
    centerCoord: COURT.length - r,
    normal: v3(0, 0, -1),
    inwardSign: -1,
    label: 'trasera',
  },
  {
    id: 'left',
    axis: 'x',
    wallCoord: 0,
    centerCoord: r,
    normal: v3(1, 0, 0),
    inwardSign: 1,
    label: 'izquierda',
  },
  {
    id: 'right',
    axis: 'x',
    wallCoord: COURT.width,
    centerCoord: COURT.width - r,
    normal: v3(-1, 0, 0),
    inwardSign: -1,
    label: 'derecha',
  },
  {
    id: 'floor',
    axis: 'y',
    wallCoord: 0,
    centerCoord: r,
    normal: v3(0, 1, 0),
    inwardSign: 1,
    label: 'piso',
  },
  {
    id: 'ceiling',
    axis: 'y',
    wallCoord: COURT.height,
    centerCoord: COURT.height - r,
    normal: v3(0, -1, 0),
    inwardSign: -1,
    label: 'techo',
  },
] as const;

export const SURFACE_BY_ID: Readonly<Record<SurfaceId, Surface>> =
  Object.fromEntries(SURFACES.map((s) => [s.id, s])) as Record<
    SurfaceId,
    Surface
  >;

/** La caja donde puede estar el centro de la pelota. */
export const CENTER_BOX = {
  xMin: r,
  xMax: COURT.width - r,
  yMin: r,
  yMax: COURT.height - r,
  zMin: r,
  zMax: COURT.length - r,
} as const;

/**
 * La pared trasera solo mide 12 ft. Un impacto en la trasera por encima de
 * esta altura no rebota: la pelota sale de la cancha. Es exactamente lo que
 * pasa con un lob que se pasa, y hay que modelarlo desde el dia uno.
 */
export const clearsBackWall = (y: number): boolean => y > COURT.backWallHeight;

/**
 * El punto de impacto cae dentro del rectangulo de esa superficie?
 * Con tolerancia, porque el punto viene de una interseccion numerica.
 */
export const withinSurfaceRect = (
  surface: Surface,
  p: Vec3,
  tol = 1e-6,
): boolean => {
  const inRange = (v: number, lo: number, hi: number) =>
    v >= lo - tol && v <= hi + tol;
  switch (surface.axis) {
    case 'x':
      return (
        inRange(p.y, CENTER_BOX.yMin, CENTER_BOX.yMax) &&
        inRange(p.z, CENTER_BOX.zMin, CENTER_BOX.zMax)
      );
    case 'y':
      return (
        inRange(p.x, CENTER_BOX.xMin, CENTER_BOX.xMax) &&
        inRange(p.z, CENTER_BOX.zMin, CENTER_BOX.zMax)
      );
    case 'z':
      return (
        inRange(p.x, CENTER_BOX.xMin, CENTER_BOX.xMax) &&
        inRange(p.y, CENTER_BOX.yMin, CENTER_BOX.yMax)
      );
  }
};

export const coordOf = (p: Vec3, axis: Axis): number => p[axis];

/** El centro de la pelota esta dentro de la caja jugable? */
export const isCenterInside = (p: Vec3, tol = 1e-6): boolean =>
  p.x >= CENTER_BOX.xMin - tol &&
  p.x <= CENTER_BOX.xMax + tol &&
  p.y >= CENTER_BOX.yMin - tol &&
  p.y <= CENTER_BOX.yMax + tol &&
  p.z >= CENTER_BOX.zMin - tol &&
  p.z <= CENTER_BOX.zMax + tol;

/** Cuanto se sale de la caja jugable, en metros. 0 si esta dentro. */
export const penetrationDepth = (p: Vec3): number =>
  Math.max(
    0,
    CENTER_BOX.xMin - p.x,
    p.x - CENTER_BOX.xMax,
    CENTER_BOX.yMin - p.y,
    p.y - CENTER_BOX.yMax,
    CENTER_BOX.zMin - p.z,
    p.z - CENTER_BOX.zMax,
  );

/** Empuja un punto dentro de la caja jugable. Para sanear inputs de la UI. */
export const clampToCourt = (p: Vec3): Vec3 => ({
  x: Math.min(Math.max(p.x, CENTER_BOX.xMin), CENTER_BOX.xMax),
  y: Math.min(Math.max(p.y, CENTER_BOX.yMin), CENTER_BOX.yMax),
  z: Math.min(Math.max(p.z, CENTER_BOX.zMin), CENTER_BOX.zMax),
});

export interface PlaneHit {
  surface: Surface;
  /** Parametro a lo largo del rayo o del segmento. */
  t: number;
  point: Vec3;
}

/**
 * Primer cruce de un SEGMENTO p0 -> p1 con alguno de los seis planos
 * desplazados. Devuelve null si el segmento entero queda dentro.
 *
 * Funciona a cualquier longitud de segmento: esta es la pieza que hace
 * imposible el tunneling, no el tamano del paso. A 85 m/s con dt = 1/60 s
 * la pelota avanza 1.42 m por frame y la cancha mide 6.1 m de ancho; un
 * integrador de "avanza, luego mira si estas dentro" se salta paredes.
 *
 * `tMin` permite reanudar justo despues de un rebote sin volver a detectar
 * el mismo contacto.
 */
export const firstSegmentCrossing = (
  p0: Vec3,
  p1: Vec3,
  tMin = 0,
): PlaneHit | null => {
  let best: PlaneHit | null = null;

  for (const surface of SURFACES) {
    const a = p0[surface.axis];
    const b = p1[surface.axis];
    const delta = b - a;
    if (Math.abs(delta) < SIM.epsilon) continue;

    const t = (surface.centerCoord - a) / delta;
    if (t < tMin || t > 1) continue;

    // Solo cuenta si el segmento va SALIENDO por ese plano, no entrando.
    const movingOutward = surface.inwardSign === 1 ? delta < 0 : delta > 0;
    if (!movingOutward) continue;

    if (best !== null && t >= best.t) continue;

    const point: Vec3 = {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      z: p0.z + (p1.z - p0.z) * t,
    };
    // Clavar la coordenada del eje al plano exacto: quita el ruido de
    // coma flotante que si no se acumula rebote a rebote.
    point[surface.axis] = surface.centerCoord;

    if (!withinSurfaceRect(surface, point)) continue;

    best = { surface, t, point };
  }

  return best;
};

/**
 * Primer plano que corta un RAYO p + d*s con d unitario. Version para el
 * motor geometrico, donde el movimiento es rectilineo e ilimitado.
 */
export const firstRayCrossing = (
  p: Vec3,
  d: Vec3,
  sMin = SIM.epsilon,
): (PlaneHit & { distance: number }) | null => {
  let best: (PlaneHit & { distance: number }) | null = null;

  for (const surface of SURFACES) {
    const dir = d[surface.axis];
    if (Math.abs(dir) < SIM.epsilon) continue; // rayo paralelo al plano

    const s = (surface.centerCoord - p[surface.axis]) / dir;
    if (s <= sMin || !Number.isFinite(s)) continue;

    const movingOutward = surface.inwardSign === 1 ? dir < 0 : dir > 0;
    if (!movingOutward) continue;

    if (best !== null && s >= best.distance) continue;

    const point: Vec3 = {
      x: p.x + d.x * s,
      y: p.y + d.y * s,
      z: p.z + d.z * s,
    };
    point[surface.axis] = surface.centerCoord;

    if (!withinSurfaceRect(surface, point)) continue;

    best = { surface, t: s, distance: s, point };
  }

  return best;
};

/** Esta el punto (x, z) dentro de la zona de saque? */
export const isInServiceZone = (x: number, z: number): boolean =>
  z >= COURT.serviceLine &&
  z <= COURT.shortLine &&
  x >= 0 &&
  x <= COURT.width;
