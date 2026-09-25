/**
 * Donde hay que pegarle a la pelota: la geometria del golpe de derecha y
 * de reves, pura, sin Three.js (el modelo 3D la consume y los tests la
 * comprueban).
 *
 * Lo que dicen las fuentes (INVESTIGACION.md, seccion 6):
 *   - Derecha: "contact is made with the ball at front heel"
 *     (Racquetball Ireland).
 *   - Reves: la misma guia dice lo mismo; Rocky Carson lo pone "just in
 *     front of leading foot".
 * El encargo suponia que la derecha iba MAS adelantada que el reves; las
 * fuentes no lo respaldan, y si acaso dicen lo contrario. Aqui se modela
 * lo que dicen: derecha a la altura del talon delantero, reves justo por
 * delante de la punta del pie adelantado.
 *
 * Distancias que NO estan publicadas y aqui son aproximadas (se dicen en
 * pantalla): el largo del pie y a que distancia lateral queda el cuerpo.
 */

import { BALL } from './constants.js';
import type { Vec3 } from './types.js';

export type Stroke = 'forehand' | 'backhand';
export type Handedness = 'right' | 'left';

/**
 * Medidas de la raqueta para DIBUJARLA. El largo total es el maximo del
 * reglamento (22 in, IRF 2.4); el reparto cabeza/mango es ilustrativo.
 */
export const RACQUET = {
  length: 22 * 0.0254, // 0.5588 m
  headLength: 0.33,
  headWidth: 0.245,
} as const;

/** Aproximaciones para dibujar los pies. Sin fuente: se avisa en pantalla. */
export const STANCE = {
  footLength: 0.26,
  footWidth: 0.1,
  /** Pies separados como los hombros, a lo largo de la linea de tiro. */
  stanceWidth: 0.55,
  /** Del centro de la pelota a la linea de los pies, hacia el cuerpo. */
  lateralReach: 0.8,
} as const;

export interface FootPrint {
  /** Centro de la huella en el piso. */
  center: Vec3;
  heel: Vec3;
  toe: Vec3;
}

export interface StrokeGeometry {
  /** Centro de la pelota en el golpe. */
  contact: Vec3;
  /** Direccion del tiro: la normal de la cara del cordaje. */
  faceNormal: Vec3;
  /** Horizontal y en el plano de la cara: de la cabeza hacia el mango. */
  handleDir: Vec3;
  /** Punto del cordaje que toca la pelota (centro de la cabeza). */
  stringsCenter: Vec3;
  gripEnd: Vec3;
  /** Donde va la mano (sobre el mango). */
  hand: Vec3;
  frontFoot: FootPrint;
  backFoot: FootPrint;
  /**
   * Cuanto va la pelota por delante del talon del pie adelantado, medido
   * a lo largo del tiro. Derecha ~0; reves ~ un pie.
   */
  aheadOfFrontHeel: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const onFloor = (a: Vec3): Vec3 => ({ x: a.x, y: 0, z: a.z });

/**
 * El mango va hacia el CUERPO. Diestro de derecha: el pecho mira a la
 * lateral derecha y la pelota queda a su derecha, asi que el cuerpo (y el
 * mango) queda a la izquierda de la pelota mirando a la frontal. En el
 * reves, al reves; y el zurdo es el espejo.
 */
export const handleSide = (stroke: Stroke, hand: Handedness): 1 | -1 =>
  (stroke === 'forehand') === (hand === 'right') ? -1 : 1;

export const strokeGeometry = (
  contact: Vec3,
  direction: Vec3,
  stroke: Stroke,
  hand: Handedness,
): StrokeGeometry => {
  const d = norm(direction);
  // Horizontal del tiro. Si el tiro es vertical puro no hay "adelante":
  // se toma hacia la frontal.
  const flat = Math.hypot(d.x, d.z) > 1e-6 ? norm({ x: d.x, y: 0, z: d.z }) : { x: 0, y: 0, z: -1 };
  // Perpendicular horizontal, a la derecha del tiro: (cos az, 0, sin az).
  const right: Vec3 = { x: -flat.z, y: 0, z: flat.x };
  const handleDir = scale(right, handleSide(stroke, hand));

  // El cordaje toca la pelota por detras: su centro esta un radio atras.
  const stringsCenter = add(contact, scale(d, -BALL.radius));
  const throat = add(stringsCenter, scale(handleDir, RACQUET.headLength / 2));
  const handleLength = RACQUET.length - RACQUET.headLength;
  const gripEnd = add(throat, scale(handleDir, handleLength));
  const handPoint = add(throat, scale(handleDir, handleLength * 0.62));

  // Pies: en la linea de tiro, del lado del cuerpo. Derecha: la pelota a
  // la altura del talon delantero. Reves: justo por delante de la punta.
  const side = scale(handleDir, STANCE.lateralReach);
  const ahead = stroke === 'forehand' ? 0 : STANCE.footLength + 0.05;
  const frontHeel = onFloor(add(add(contact, side), scale(flat, -ahead)));
  const foot = (heel: Vec3): FootPrint => ({
    heel,
    toe: add(heel, scale(flat, STANCE.footLength)),
    center: add(heel, scale(flat, STANCE.footLength / 2)),
  });
  const frontFoot = foot(frontHeel);
  const backFoot = foot(add(frontHeel, scale(flat, -STANCE.stanceWidth)));

  return {
    contact,
    faceNormal: d,
    handleDir,
    stringsCenter,
    gripEnd,
    hand: handPoint,
    frontFoot,
    backFoot,
    aheadOfFrontHeel: ahead,
  };
};

export const STROKE_LABEL: Record<Stroke, string> = {
  forehand: 'derecha',
  backhand: 'revés',
};

/** Una linea para el rotulo del 3D: lo que dicen las fuentes, sin mas. */
export const strokeAdvice = (stroke: Stroke): string =>
  stroke === 'forehand'
    ? 'Derecha: contacto a la altura del talón del pie adelantado.'
    : 'Revés: contacto justo por delante del pie adelantado.';
