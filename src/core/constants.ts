/**
 * Constantes fisicas y geometricas. Fuente unica de verdad.
 *
 * Sistema de coordenadas (mano derecha, metros), origen en la esquina
 * inferior izquierda de la pared frontal, visto por un jugador que mira
 * hacia la pared frontal:
 *
 *   X -> ancho.   0 = pared izquierda,  6.096 = pared derecha
 *   Y -> altura.  0 = piso,             6.096 = techo
 *   Z -> fondo.   0 = pared frontal,   12.192 = pared trasera
 */

import type { SurfaceId } from './types.js';

export const FT = 0.3048;
export const IN = 0.0254;

export const COURT = {
  length: 40 * FT, //   12.192 m  (pared frontal -> pared trasera)
  width: 20 * FT, //     6.096 m
  height: 20 * FT, //    6.096 m

  /**
   * La pared trasera reglamentaria sube solo 12 ft. Por encima hay aire
   * (o cristal en canchas de exhibicion). Una pelota que cruza Z = length
   * por encima de esta altura sale de la cancha, no rebota.
   */
  backWallHeight: 12 * FT, // 3.6576 m

  serviceLine: 15 * FT, //    4.572 m desde la pared frontal
  shortLine: 20 * FT, //      6.096 m desde la pared frontal
  receivingLine: 25 * FT, //  7.620 m desde la pared frontal
  driveServeLineOffset: 3 * FT, // 0.9144 m desde cada pared lateral

  /** Las cajas de dobles ocupan 18 in a cada lado de la zona de saque. */
  doublesBoxWidth: 18 * IN,
} as const;

/** La zona de saque: franja del piso entre serviceLine y shortLine. */
export const SERVICE_ZONE = {
  zMin: COURT.serviceLine,
  zMax: COURT.shortLine,
  depth: COURT.shortLine - COURT.serviceLine, // 1.524 m
} as const;

export const BALL = {
  diameter: 2.25 * IN, // 0.05715 m
  radius: 1.125 * IN, //  0.028575 m
  mass: 0.0397, //        kg (~40 g)

  /**
   * COR derivado de la norma oficial: soltada desde 100 in a 70-74 F debe
   * rebotar entre 68 y 72 in.  COR = sqrt(70/100) = 0.8367
   */
  restitution: 0.837,

  /**
   * Restitucion tangencial: cuanta velocidad paralela conserva al rebotar.
   * No hay norma. 0.65 da trayectorias creibles. Parametro a calibrar.
   */
  tangentialRestitution: 0.65,

  /** Esfera lisa a estos numeros de Reynolds. */
  dragCoefficient: 0.5,
} as const;

export const AIR_DENSITY = 1.2; // kg/m3
export const GRAVITY = 9.81; // m/s2

/** Area frontal de la pelota, para el arrastre. */
export const BALL_AREA = Math.PI * BALL.radius * BALL.radius;

/**
 * Coeficiente de arrastre agrupado:  a_drag = -k * |v| * v
 *   k = 0.5 * rho * Cd * A / m   ~= 0.0194 m^-1
 *
 * Con este valor el arrastre domina sobre la gravedad en todo el rango
 * util (1.8 g a 30 m/s, 14.3 g a 85 m/s). No es un refinamiento opcional.
 */
export const DRAG_K =
  (0.5 * AIR_DENSITY * BALL.dragCoefficient * BALL_AREA) / BALL.mass;

/**
 * COR normal por superficie. Se expone aunque al principio todas valgan lo
 * mismo: una pared frontal de cristal y un piso de madera no se comportan
 * igual, y el dia que se calibre cada una el motor ya lo admite.
 */
export const SURFACE_COR: Record<SurfaceId, number> = {
  front: BALL.restitution,
  back: BALL.restitution,
  left: BALL.restitution,
  right: BALL.restitution,
  floor: BALL.restitution,
  ceiling: BALL.restitution,
};

/** Velocidades de referencia, para calibrar sliders y presets (m/s). */
export const SPEED = {
  min: 10,
  max: 90,
  default: 45,
  rallyComfortable: 30,
  drive: 48,
  hardAmateurServe: 60,
  proServe: 80,
} as const;

/** Altura de contacto tipica de un golpe normal. */
export const DEFAULT_CONTACT_HEIGHT = 0.9;

/** Limites de integracion y de simulacion. */
export const SIM = {
  maxBounces: 12,
  maxTime: 8, //       s
  physicsDt: 1 / 1000, // s — paso fijo, desacoplado del render
  sampleDt: 1 / 240, //   s — muestreo para dibujar
  /** Por debajo de esta velocidad normal tras botar en el piso, reposo. */
  restingSpeed: 0.4, // m/s
  epsilon: 1e-7,
} as const;
