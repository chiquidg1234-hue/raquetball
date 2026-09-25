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
import { AXS_170T, AXS_MODEL, COP_HAND, HALF_WIDTH } from './racquet.js';
import type { Vec3 } from './types.js';

export type Stroke = 'forehand' | 'backhand';
export type Handedness = 'right' | 'left';

/**
 * Medidas de la raqueta: la Gearbox AXS 170 Teardrop (src/core/racquet.ts).
 * El largo es el publicado (22 in, el maximo del reglamento); la cabeza,
 * la lagrima modelada con los 107 in^2 publicados.
 */
export const RACQUET = {
  length: AXS_170T.length,
  headLength: AXS_170T.length - AXS_MODEL.throat,
  headWidth: 2 * HALF_WIDTH,
} as const;

/**
 * El golpe animado: cuanto gira la raqueta alrededor del hombro y cuanto
 * tarda, antes y despues del contacto. Es para ENSENAR el gesto, no una
 * medida: acelera al llegar (t^2) y frena al acompanar.
 */
export const SWING = {
  backDeg: 110,
  backTime: 0.28,
  followDeg: 70,
  followTime: 0.15,
  /** Del centro de la mano al hombro, en planta: el radio del giro. */
  shoulder: 0.55,
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
  /**
   * Normal de la cara del cordaje. Es la direccion del tiro, salvo con
   * corte o liftado: entonces la cara va abierta o cerrada la mitad del
   * angulo (la pelota sale entre la normal y el camino de la raqueta).
   */
  faceNormal: Vec3;
  /** Horizontal y en el plano de la cara: de la cabeza hacia el mango. */
  handleDir: Vec3;
  /** Punto del cordaje que toca la pelota: el sitio elegido de la raqueta. */
  hitPoint: Vec3;
  /** Distancia del final del mango al punto de impacto (m). */
  hitS: number;
  /** Final del mango y punta de la cabeza. */
  gripEnd: Vec3;
  tip: Vec3;
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

export interface StrokeOptions {
  /** Donde de la raqueta se le pega: distancia desde el final del mango. */
  hitS?: number;
  /** Corte (+) o liftado (-), en grados: abre o cierra la cara. */
  bevelDeg?: number;
}

export const strokeGeometry = (
  contact: Vec3,
  direction: Vec3,
  stroke: Stroke,
  hand: Handedness,
  opts: StrokeOptions = {},
): StrokeGeometry => {
  const d = norm(direction);
  // Horizontal del tiro. Si el tiro es vertical puro no hay "adelante":
  // se toma hacia la frontal.
  const flat = Math.hypot(d.x, d.z) > 1e-6 ? norm({ x: d.x, y: 0, z: d.z }) : { x: 0, y: 0, z: -1 };
  // Perpendicular horizontal, a la derecha del tiro: (cos az, 0, sin az).
  const right: Vec3 = { x: -flat.z, y: 0, z: flat.x };
  const handleDir = scale(right, handleSide(stroke, hand));

  // La cara se abre (corte) o se cierra (liftado) girando sobre el eje del
  // mango, que es horizontal: el mango sigue siendo horizontal.
  const tilt = (((opts.bevelDeg ?? 0) / 2) * Math.PI) / 180;
  const el = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const faceNormal = norm(add(scale(flat, Math.cos(el + tilt)), { x: 0, y: Math.sin(el + tilt), z: 0 }));

  // El cordaje toca la pelota por detras: el punto elegido esta un radio
  // atras del centro, a lo largo de la normal de la cara.
  const hitS = opts.hitS ?? COP_HAND;
  const hitPoint = add(contact, scale(faceNormal, -BALL.radius));
  const gripEnd = add(hitPoint, scale(handleDir, hitS));
  const tip = add(hitPoint, scale(handleDir, hitS - RACQUET.length));
  const handPoint = add(gripEnd, scale(handleDir, -AXS_MODEL.handAt));

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
    faceNormal,
    handleDir,
    hitPoint,
    hitS,
    gripEnd,
    tip,
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
