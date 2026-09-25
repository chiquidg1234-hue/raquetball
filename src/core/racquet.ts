/**
 * La raqueta de verdad: Gearbox AXS 170 Teardrop (INVESTIGACION.md, 10).
 *
 * Lo PUBLICADO: 22 in de largo, 107 in^2 de superficie encordada, 170 g sin
 * cordaje, 13 mm cargada de cabeza, cordaje de 18 g. Lo que Gearbox NO
 * publica (ancho de la cabeza, patron de cuerdas, momento de inercia) se
 * MODELA aqui y se dice:
 *   - La cabeza es una lagrima: la mitad del ancho sigue sin(pi t^1.5)^0.6
 *     (mas ancha arriba, t = 0 en la garganta). El ancho sale de pedir
 *     exactamente los 107 in^2.
 *   - La masa se reparte en mango (varilla), marco (a lo largo del borde) y
 *     cuerdas (placa). El reparto mango/marco sale de pedir el balance
 *     publicado. De ahi, el centro de masas y la inercia, integrando.
 *
 * Con eso, la fisica de impacto (Cross, "sweet spots" de un implemento):
 *   masa efectiva en x:   1/Me = 1/M + (x - x_cm)^2 / I_cm
 *   salida, pelota quieta: v = V (1 + e) Me/(Me + m)
 *   centro de percusion:  x_cop = x_cm + I_cm/(M (x_cm - x_pivote))
 * y el corte (slice) con el mismo modelo de agarre que las paredes.
 *
 * Coordenadas de la raqueta: `s` a lo largo, desde la punta del mango
 * (0) hasta la punta de la cabeza (L); `u` de lado a lado.
 */

import { BALL } from './constants.js';
import { SPIN } from './spin.js';
import type { Vec3 } from './types.js';
import { cross, length, normalize, scale } from './vec3.js';

const IN = 0.0254;

/** Lo que publica Gearbox (y RacquetWorld) de la AXS 170 Teardrop. */
export const AXS_170T = {
  name: 'Gearbox AXS 170 Teardrop',
  length: 22 * IN,
  stringArea: 107 * IN * IN,
  massUnstrung: 0.17,
  /** Hacia la cabeza, desde el centro del largo. */
  headHeavy: 0.013,
  stringMass: 0.018,
} as const;

/** Lo modelado, no publicado: se dice en pantalla. */
export const AXS_MODEL = {
  /**
   * Donde empieza el encordado, desde la punta del mango. En una lagrima
   * las cuerdas bajan casi hasta el mango: 16.5 cm deja 6.5 in de mango.
   */
  throat: 0.165,
  /** Ancho del marco (del borde exterior al encordado). */
  frame: 0.012,
  /**
   * Forma de lagrima: medio ancho = W sin(pi t^P)^Q, lo mas ancho a 63 % de
   * la cabeza. Con P = 1.5 y Q = 0.45 los 107 in^2 dan una cabeza de 25 cm
   * (9.8 in) de ancho, lo tipico de una raqueta de racquetball de ese
   * tamano. Gearbox no publica ni el ancho ni el patron.
   */
  teardropP: 1.5,
  teardropQ: 0.45,
  /** Donde va el centro de la mano en el mango. */
  handAt: 0.07,
  /**
   * COR pelota-cuerdas. No medido para racquetball; el de la prueba de la
   * pelota. Solo escala la salida: no mueve los puntos dulces.
   */
  stringCor: 0.85,
} as const;

/** Donde va el pivote del golpe, a lo largo de la raqueta (s, en m). */
export const PIVOTS = {
  /** Golpe de muñeca: la muñeca, justo por debajo del mango. */
  wrist: -0.05,
  /** Brazo entero: el codo, un antebrazo mas atras. */
  arm: -0.35,
} as const;
export type PivotId = keyof typeof PIVOTS;

const tipInner = AXS_170T.length - AXS_MODEL.frame;
const headLength = tipInner - AXS_MODEL.throat;

const shape = (t: number): number =>
  t <= 0 || t >= 1 ? 0 : Math.pow(Math.sin(Math.PI * Math.pow(t, AXS_MODEL.teardropP)), AXS_MODEL.teardropQ);

const N = 400;
/** Integral de la forma entre 0 y 1 (regla del punto medio). */
const shapeIntegral = (() => {
  let acc = 0;
  for (let i = 0; i < N; i++) acc += shape((i + 0.5) / N);
  return acc / N;
})();

/** Medio ancho maximo del encordado, para que el area sea la publicada. */
export const HALF_WIDTH = AXS_170T.stringArea / (2 * headLength * shapeIntegral);

/** Medio ancho del encordado a la altura s (0 fuera de la cabeza). */
export const stringHalfWidth = (s: number): number =>
  HALF_WIDTH * shape((s - AXS_MODEL.throat) / headLength);

/**
 * Contorno del encordado (y, con el marco, del exterior) como polilinea
 * cerrada en (u, s), para dibujarla.
 */
export const headOutline = (outset = 0, points = 96): { u: number; s: number }[] => {
  const right: { u: number; s: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const s = AXS_MODEL.throat + t * headLength;
    right.push({ u: stringHalfWidth(s) + outset * shape(t) ** 0.2, s: s + (t === 1 ? outset : 0) - (t === 0 ? outset : 0) });
  }
  const left = right.slice().reverse().map((p) => ({ u: -p.u, s: p.s }));
  return [...right, ...left];
};

// --------------------------------------------------------- reparto de masa

interface Segment {
  mass: number;
  /** Primer y segundo momento de la distribucion por unidad de masa. */
  mean: number;
  meanSq: number;
}

/** Cuerdas: placa uniforme sobre el area encordada. */
const strings = ((): Segment => {
  let a = 0;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < N; i++) {
    const s = AXS_MODEL.throat + ((i + 0.5) / N) * headLength;
    const w = 2 * stringHalfWidth(s);
    a += w;
    m1 += w * s;
    m2 += w * s * s;
  }
  return { mass: AXS_170T.stringMass, mean: m1 / a, meanSq: m2 / a };
})();

/** Marco: masa uniforme a lo largo del contorno. */
const frameShape = ((): Omit<Segment, 'mass'> => {
  const o = headOutline(AXS_MODEL.frame / 2, 200);
  let len = 0;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i]!;
    const q = o[(i + 1) % o.length]!;
    const d = Math.hypot(q.u - p.u, q.s - p.s);
    const sMid = (p.s + q.s) / 2;
    len += d;
    m1 += d * sMid;
    m2 += d * sMid * sMid;
  }
  return { mean: m1 / len, meanSq: m2 / len };
})();

/** Mango: varilla uniforme desde la punta del mango hasta la garganta. */
const handleShape: Omit<Segment, 'mass'> = {
  mean: AXS_MODEL.throat / 2,
  meanSq: (AXS_MODEL.throat * AXS_MODEL.throat) / 3,
};

/**
 * Reparto mango/marco que da el balance publicado SIN cordaje:
 *   m_h s_h + (170 g - m_h) s_f = 170 g (L/2 + 13 mm)
 */
const handleMass = (() => {
  const target = AXS_170T.massUnstrung * (AXS_170T.length / 2 + AXS_170T.headHeavy);
  return (AXS_170T.massUnstrung * frameShape.mean - target) / (frameShape.mean - handleShape.mean);
})();

const SEGMENTS: Segment[] = [
  { mass: handleMass, ...handleShape },
  { mass: AXS_170T.massUnstrung - handleMass, ...frameShape },
  strings,
];

/** Lo que sale del modelo: masa, centro de masas e inercia (encordada). */
export const RACQUET_MASS = (() => {
  const M = SEGMENTS.reduce((a, g) => a + g.mass, 0);
  const cm = SEGMENTS.reduce((a, g) => a + g.mass * g.mean, 0) / M;
  const aboutButt = SEGMENTS.reduce((a, g) => a + g.mass * g.meanSq, 0);
  const iCm = aboutButt - M * cm * cm;
  const unstrungCm =
    (SEGMENTS[0]!.mass * SEGMENTS[0]!.mean + SEGMENTS[1]!.mass * SEGMENTS[1]!.mean) / AXS_170T.massUnstrung;
  return {
    handle: SEGMENTS[0]!.mass,
    frame: SEGMENTS[1]!.mass,
    strings: SEGMENTS[2]!.mass,
    mass: M,
    /** Centro de masas encordada, desde la punta del mango (m). */
    cm,
    unstrungCm,
    /** Momento de inercia respecto al centro de masas (kg m^2), eje transversal. */
    iCm,
    /** "Swingweight": respecto a un eje a 10 cm de la punta del mango. */
    swingweight: iCm + M * (cm - 0.1) * (cm - 0.1),
  };
})();

// --------------------------------------------------------- puntos dulces

/** Masa efectiva de la raqueta en el punto s (golpe en su eje largo). */
export const effectiveMass = (s: number): number =>
  1 / (1 / RACQUET_MASS.mass + (s - RACQUET_MASS.cm) ** 2 / RACQUET_MASS.iCm);

/**
 * Velocidad de salida de una pelota QUIETA golpeada en s, por cada m/s de
 * velocidad angular de la raqueta alrededor del pivote:
 *   v/Omega = (s - s_p) (1 + e) Me/(Me + m)
 */
export const exitPerOmega = (s: number, pivot: number, e = AXS_MODEL.stringCor): number => {
  const me = effectiveMass(s);
  return (s - pivot) * (1 + e) * (me / (me + BALL.mass));
};

/** El punto del encordado que mas velocidad le da a la pelota con ese pivote. */
export const powerPoint = (pivot: number): number => {
  let best: number = AXS_MODEL.throat;
  let bestV = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const s = AXS_MODEL.throat + (i / 400) * headLength;
    const v = exitPerOmega(s, pivot);
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  return best;
};

/**
 * Centro de percusion para un golpe que gira alrededor del pivote: ahi el
 * impacto no le da tiron a la mano. x_cop = x_cm + I_cm/(M (x_cm - x_p)).
 */
export const centerOfPercussion = (pivot: number): number =>
  RACQUET_MASS.cm + RACQUET_MASS.iCm / (RACQUET_MASS.mass * (RACQUET_MASS.cm - pivot));

/** Donde esta la mano: el pivote de la sacudida en la mano misma. */
export const COP_HAND = centerOfPercussion(AXS_MODEL.handAt);

/**
 * A que velocidad tiene que ir la raqueta EN EL PUNTO DE IMPACTO para que
 * una pelota quieta salga a `ballSpeed` (el saque, tras el bote).
 *   V = v (Me + m)/((1 + e) Me)
 */
export const requiredHeadSpeed = (ballSpeed: number, s: number, e = AXS_MODEL.stringCor): number => {
  const me = effectiveMass(s);
  return (ballSpeed * (me + BALL.mass)) / ((1 + e) * me);
};

// ---------------------------------------------------------------- el corte

/**
 * Friccion pelota-cuerdas. NO medida para racquetball (monofilamento
 * liso): en tenis va de 0.3 a 0.5. Se usa 0.4; solo decide cuando el
 * corte satura.
 */
export const STRING_FRICTION = 0.4;

export interface SliceResult {
  /** rad/s. */
  spin: Vec3;
  rpm: number;
  /** El agarre se saturo: la pelota deslizo por las cuerdas. */
  slipped: boolean;
  /** Velocidad de la raqueta a lo largo de la cara (m/s). */
  faceSlide: number;
}

/**
 * Giro que da un golpe cortado (bevel > 0: la cara abierta y la raqueta
 * bajando por detras de la pelota) o liftado (bevel < 0). La raqueta va a
 * V_n = requiredHeadSpeed en la normal y a V_t = V_n tan(bevel) a lo largo
 * de la cara; la pelota, casi quieta, agarra en las cuerdas como en una
 * pared (spin.ts): R w = (1 + e_x) V_t/(1 + alpha), salvo que la friccion
 * no alcance (mu J_n). El eje: horizontal y perpendicular al tiro; el corte
 * hace que la parte de abajo de la pelota vaya hacia delante.
 */
export const sliceSpin = (
  ballSpeed: number,
  bevelDeg: number,
  direction: Vec3,
  s = COP_HAND,
): SliceResult => {
  const vn = requiredHeadSpeed(ballSpeed, s);
  const vt = Math.abs(vn * Math.tan((bevelDeg * Math.PI) / 180));
  const a = SPIN.inertiaFactor;
  // En unidades de R w: con agarre, R w = (1 + e_x) V_t/(1 + alpha). El
  // impulso tangencial es alpha R w, y no puede pasar de mu J_n, con J_n
  // (por unidad de masa) ~ lo que sale la pelota: R w <= mu v/alpha.
  const grip = ((1 + SPIN.tangentialCor) * vt) / (1 + a);
  const limit = (STRING_FRICTION * ballSpeed) / a;
  const slipped = grip > limit;
  const surfaceSpeed = slipped ? limit : grip;
  const w = surfaceSpeed / BALL.radius;
  const flat = normalize({ x: direction.x, y: 0, z: direction.z });
  const axis = cross({ x: 0, y: 1, z: 0 }, flat); // sentido de rodar hacia delante
  const sign = bevelDeg > 0 ? -1 : 1; // cortado: al reves que rodar
  const spin = length(axis) > 1e-9 && w > 0 ? scale(normalize(axis), sign * w) : { x: 0, y: 0, z: 0 };
  return { spin, rpm: (w * 60) / (2 * Math.PI), slipped, faceSlide: vt };
};
