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

import {
  BALL_TEST_AIR,
  REFERENCE_AIR,
  airDensity,
  corFromDropTest,
  dragConstant,
} from './atmosphere.js';
import type { SurfaceId } from './types.js';

export const FT = 0.3048;
export const IN = 0.0254;
export const MPH = 0.44704; // m/s

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

/**
 * Prueba de homologacion de la pelota (USAR regla 2, IRF regla 2.2): se
 * suelta desde 100 in y tiene que rebotar entre 68 y 72 in, a 70-74 F.
 */
export const BALL_TEST = {
  dropHeight: 100 * IN,
  reboundMin: 68 * IN,
  reboundMax: 72 * IN,
  /** Pelota de referencia del motor: el centro del rango. */
  reboundReference: 70 * IN,
} as const;

const BALL_SHAPE = {
  diameter: 2.25 * IN, // 0.05715 m
  radius: 1.125 * IN, //  0.028575 m
  mass: 0.0397, //        kg (1.4 oz)
  /**
   * Esfera lisa en regimen subcritico (Re <= 2e5). No hay medida publicada
   * del Cd de una pelota de racquetball: ver INVESTIGACION.md, seccion 3.
   */
  dragCoefficient: 0.5,
} as const;

export const BALL = {
  ...BALL_SHAPE,

  /**
   * COR de la pelota de referencia (70 in), sacado de la prueba de
   * homologacion CON arrastre, en el aire de la prueba (nivel del mar,
   * 72 F): 0.872. La cuenta sin arrastre, sqrt(70/100) = 0.837, dejaba a
   * la pelota del motor rebotando a 64.6 in: no pasaba su propia norma.
   */
  restitution: corFromDropTest(
    BALL_TEST.reboundReference,
    BALL_TEST.dropHeight,
    dragConstant(airDensity(BALL_TEST_AIR), BALL_SHAPE),
  ),

  /**
   * Restitucion tangencial: cuanta velocidad paralela conserva al rebotar.
   * No hay norma ni medida publicada. 0.65 da trayectorias creibles. Se
   * calibra por superficie en el panel Cancha.
   */
  tangentialRestitution: 0.65,
} as const;

/**
 * Densidad del aire de referencia: nivel del mar y 20 C con la atmosfera
 * estandar, 1.2041 kg/m3. La del sitio de juego sale de src/core/atmosphere.ts.
 */
export const AIR_DENSITY = airDensity(REFERENCE_AIR);
export const GRAVITY = 9.81; // m/s2

/** Area frontal de la pelota, para el arrastre. */
export const BALL_AREA = Math.PI * BALL.radius * BALL.radius;

/**
 * Coeficiente de arrastre agrupado A NIVEL DEL MAR Y 20 C:
 *   a_drag = -k * |v| * v,   k = 0.5 * rho * Cd * A / m  = 0.01945 1/m
 *
 * Ya no es una constante del juego: es el valor por defecto cuando la
 * simulacion no trae el `dragK` de un sitio de juego. En El Alto, a la
 * misma temperatura, es 0.0116: un 40 % menos.
 * Con este valor el arrastre domina sobre la gravedad en todo el rango
 * util (1.8 g a 30 m/s, 14.3 g a 85 m/s). No es un refinamiento opcional.
 */
export const DRAG_K = dragConstant(AIR_DENSITY, BALL);

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

/**
 * Velocidades de referencia a la salida de la raqueta (m/s). Todas las
 * lecturas publicadas son de radar, que marca el pico: el de justo despues
 * del golpe. Fuente y tabla completa: INVESTIGACION.md, seccion 4
 * (Pro Racquetball Stats, T. Boss, 2023).
 */
export const SPEED = {
  min: 10,
  /** ~190 mph: la lectura mas alta que la fuente considera creible. */
  max: 85,
  default: 45,
  /** Estimacion: no hay medida publicada de peloteo. */
  rallyComfortable: 30,
  /** Estimacion: no hay medida publicada de drive. */
  drive: 48,
  /** 133 mph: un jugador "low open", medido con radar. */
  hardAmateurServe: 133 * MPH,
  /** ~150 mph: "the 150 range we generally see harder hitters" (pros de hoy). */
  proServe: 150 * MPH,
  /** 186 mph: Fredenberg, US Open 2001, segun la prensa. */
  recordServe: 186 * MPH,
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
