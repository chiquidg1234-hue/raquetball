/**
 * FASE 3 — Las tres vistas 2D son proyecciones ortograficas del MISMO
 * arreglo de puntos que consume la vista 3D. No hay un "motor 2D".
 *
 *   Planta         = descartar Y   (X, Z)
 *   Alzado frontal = descartar Z   (X, Y)
 *   Alzado lateral = descartar X   (Z, Y)
 *
 * Por construccion no se pueden desincronizar del 3D.
 *
 * Todas las coordenadas de vista estan en METROS, y el viewBox del SVG es
 * literalmente el rectangulo de la cancha. Asi no hay ninguna matematica de
 * escala repartida por el codigo de dibujo: grosores, radios y tamanos de
 * texto se expresan en metros y salen a escala solos.
 */

import { COURT } from '../core/constants.js';
import type { Vec3 } from '../core/types.js';

export type ProjectionId = 'plan' | 'front' | 'side';

export interface Point2 {
  u: number;
  v: number;
}

export interface Projection {
  id: ProjectionId;
  label: string;
  /** Para que sirve esta vista. Se muestra en la UI. */
  hint: string;
  /** Eje de cancha que esta vista descarta. */
  dropped: 'x' | 'y' | 'z';
  /** Ancho y alto del viewBox, en metros. */
  width: number;
  height: number;
  project(p: Vec3): Point2;
  /** Inversa, dado el valor del eje descartado. */
  unproject(pt: Point2, missing: number): Vec3;
  /** Etiquetas de los bordes, para orientarse. */
  edges: { top: string; bottom: string; left: string; right: string };
}

export const PLAN: Projection = {
  id: 'plan',
  label: 'Planta',
  hint: 'Angulos horizontales, cobertura de cancha, posicion de jugadores.',
  dropped: 'y',
  width: COURT.width,
  height: COURT.length,
  project: (p) => ({ u: p.x, v: p.z }),
  unproject: (pt, y) => ({ x: pt.u, y, z: pt.v }),
  edges: {
    top: 'pared frontal',
    bottom: 'pared trasera',
    left: 'izquierda',
    right: 'derecha',
  },
};

export const FRONT: Projection = {
  id: 'front',
  label: 'Alzado frontal',
  hint: 'Altura de impacto en la pared frontal: donde muere un kill shot.',
  dropped: 'z',
  width: COURT.width,
  height: COURT.height,
  project: (p) => ({ u: p.x, v: COURT.height - p.y }),
  unproject: (pt, z) => ({ x: pt.u, y: COURT.height - pt.v, z }),
  edges: {
    top: 'techo',
    bottom: 'piso',
    left: 'izquierda',
    right: 'derecha',
  },
};

export const SIDE: Projection = {
  id: 'side',
  label: 'Alzado lateral',
  hint: 'Altura del arco, ceiling balls, si la bola pasa la pared trasera.',
  dropped: 'x',
  width: COURT.length,
  height: COURT.height,
  project: (p) => ({ u: p.z, v: COURT.height - p.y }),
  unproject: (pt, x) => ({ x, y: COURT.height - pt.v, z: pt.u }),
  edges: {
    top: 'techo',
    bottom: 'piso',
    left: 'pared frontal',
    right: 'pared trasera',
  },
};

export const PROJECTIONS: readonly Projection[] = [PLAN, FRONT, SIDE];

export const projectionById = (id: ProjectionId): Projection => {
  const found = PROJECTIONS.find((p) => p.id === id);
  if (!found) throw new Error(`proyeccion desconocida: ${id}`);
  return found;
};
