/**
 * El efecto: lo que pasa en cada contacto cuando la pelota gira.
 *
 * Tres piezas, todas puras (sin estado, sin Three.js), y todas con su
 * cuenta en INVESTIGACION.md, secciones 7 y 8:
 *
 *   1. `spinBounce`: el rebote con friccion, "agarre o deslizamiento"
 *      (Cross 2002). Es lo que hace que el Z salga casi paralelo a la
 *      pared trasera despues de la segunda lateral.
 *   2. `nickCheck`: el criterio del rollout al crack (Ravisankar et al.,
 *      PNAS 2025). Si la pelota llega bajando a la banda del crack y
 *      termina de rodar por la pared DESPUES de tocar el piso, sale rodando.
 *   3. `settleRolling`: la pelota que se arrastra por el piso termina
 *      rodando; se conserva el momento angular respecto al punto de apoyo.
 *
 * Convenios: n es la normal de la superficie hacia la cancha; r = -R n va
 * del centro de la pelota al punto de contacto; w es la velocidad angular
 * en rad/s. Los impulsos van por unidad de masa (m se cancela en todo).
 */

import { BALL } from './constants.js';
import type { Vec3 } from './types.js';
import { add, addScaled, cross, dot, length, scale } from './vec3.js';

export const SPIN = {
  /**
   * alpha = I/(m R^2). Cascaron grueso de goma: con la masa, el diametro y
   * una goma de 1.1-1.2 g/cm3 la pared sale de 3.7-4.1 mm, y eso da 0.56-0.60
   * (formula del apendice de PNAS 2025). Macizo seria 0.4; cascara fina 0.667.
   */
  inertiaFactor: 0.58,
  /**
   * e_x: el punto de contacto sale con -e_x veces el deslizamiento que
   * traia. Con una pelota de racquetball real (Illouz 2014, 600 fps) sale
   * 0 +- 0.12; Cross da 0.1-0.2 para una de tenis. Se usa 0.05.
   */
  tangentialCor: 0.05,
  /**
   * mu: friccion de deslizamiento goma-superficie dura. Illouz 2014: a 80
   * grados el giro solo cae ~10 %, y eso pide mu ~ 1.0. Se usa 0.9 en
   * paredes y piso; se calibra por superficie en el panel Cancha.
   */
  friction: 0.9,
  /**
   * E efectivo de la pelota (Pa), para el tiempo de contacto de Hertz del
   * nick. NO ESTA PUBLICADO para racquetball: se estima k ~ 2 N/mm y
   * E = 4k/(pi D) ~ 45 kPa (la misma cuenta con la squash da 102 kPa, igual
   * que su medida). Calibrable en el panel Cancha.
   */
  stiffness: 45e3,
  /** Banda del nick: altura del centro entre 0.6 y 0.75 diametros (PNAS 2025). */
  nickBand: { min: 0.6, max: 0.75 },
  /**
   * Resistencia a la rodadura. ESTIMACION: la de una pelota de tenis sobre
   * tres pistas distintas es 0.04 +- 0.005 aplastada con 37 N por pelota
   * (Cross 2003); una pelota lisa que rueda con su propio peso se aplasta
   * mucho menos. Se usa la mitad.
   */
  rollingResistance: 0.02,
  /** Por debajo de esta velocidad la pelota que rueda se da por parada. */
  rollingStopSpeed: 0.3,
} as const;

export interface ContactParams {
  /** COR normal de esa superficie. */
  restitution: number;
  /** mu de esa superficie. */
  friction: number;
  /** e_x. */
  tangentialCor: number;
  /** alpha = I/(m R^2). */
  inertiaFactor: number;
  radius: number;
}

export interface SpinBounceResult {
  v: Vec3;
  w: Vec3;
  /** true si la friccion se satura (desliza todo el contacto). */
  slipped: boolean;
  /** Impulso normal por unidad de masa (m/s). */
  jn: number;
  /** Impulso tangencial por unidad de masa (m/s). */
  jt: Vec3;
}

/** Velocidad del punto de la pelota que toca la superficie de normal n. */
export const contactPointVelocity = (v: Vec3, w: Vec3, n: Vec3, radius: number): Vec3 =>
  add(v, cross(w, scale(n, -radius)));

/**
 * Rebote con friccion (Cross 2002, "grip-slip"):
 *
 *   u   = v + w x r                      velocidad del punto de contacto
 *   jn  = (1 + e) |v.n|                  impulso normal
 *   jt  = -alpha (1 + e_x) u_t/(1 + alpha)   agarre: el punto sale a -e_x u_t
 *   si |jt| > mu jn: desliza, jt = -mu jn u_t/|u_t|
 *   v'  = v + jn n + jt                  w' = w + (r x jt)/(alpha R^2)
 *
 * El agarre sale de pedir u_t' = -e_x u_t: con I = alpha m R^2,
 * u_t' = u_t + jt (1 + alpha)/alpha. Todo impulso pasa por el punto de
 * contacto, asi que el momento angular respecto a ese punto se conserva
 * siempre (lo comprueba un test).
 */
export const spinBounce = (v: Vec3, w: Vec3, n: Vec3, p: ContactParams): SpinBounceResult => {
  const R = p.radius;
  const a = p.inertiaFactor;
  const r = scale(n, -R);
  const vn = dot(v, n);
  const jn = (1 + p.restitution) * Math.max(0, -vn);

  const u = add(v, cross(w, r));
  const ut = addScaled(u, n, -dot(u, n));
  const slip = length(ut);

  let jt: Vec3 = { x: 0, y: 0, z: 0 };
  let slipped = false;
  if (slip > 1e-12) {
    const grip = scale(ut, (-a * (1 + p.tangentialCor)) / (1 + a));
    const limit = p.friction * jn;
    if (length(grip) <= limit) {
      jt = grip;
    } else {
      jt = scale(ut, -limit / slip);
      slipped = true;
    }
  }

  return {
    v: add(addScaled(v, n, jn), jt),
    w: add(w, scale(cross(r, jt), 1 / (a * R * R))),
    slipped,
    jn,
    jt,
  };
};

/**
 * Energia cinetica por unidad de masa, traslacion + rotacion:
 * v^2/2 + alpha R^2 w^2/2.
 */
export const kineticEnergy = (v: Vec3, w: Vec3, inertiaFactor: number, radius: number): number =>
  0.5 * dot(v, v) + 0.5 * inertiaFactor * radius * radius * dot(w, w);

/**
 * Momento angular por unidad de masa respecto a un punto q:
 * (c - q) x v + alpha R^2 w, con c el centro.
 */
export const angularMomentumAbout = (
  center: Vec3,
  v: Vec3,
  w: Vec3,
  q: Vec3,
  inertiaFactor: number,
  radius: number,
): Vec3 => addScaled(cross(addScaled(center, q, -1), v), w, inertiaFactor * radius * radius);

export interface NickParams {
  /** E efectivo (Pa). */
  stiffness: number;
  mass: number;
  diameter: number;
  inertiaFactor: number;
  band: { min: number; max: number };
}

export interface NickCheck {
  /** Altura del centro en diametros (H*). */
  heightRatio: number;
  inBand: boolean;
  /** true si llega bajando. */
  descending: boolean;
  /** Tiempo de contacto de Hertz con la pared (s). */
  contactTime: number;
  /** Tiempo que tarda en rodar por la pared hasta el piso (s). */
  rollTime: number;
  /** tau = rollTime/contactTime. Nick si < 1. Infinity si no baja. */
  tau: number;
  rollout: boolean;
}

/**
 * Criterio del nick (Ravisankar et al., PNAS 2025), para una pared
 * vertical de normal n y el centro a `height` del piso:
 *
 *   t_c = 3.29 (m^2/(D E^2 U_n))^(1/5)          Hertz, con la normal U0 cos(th0)
 *   t_r = H (1 + alpha)/(U_down + alpha s)     rodar por la pared una altura H
 *   rollout si 0.6 < H/D < 0.75, baja, y t_r < t_c
 *
 * (1 + alpha) es el 4 kappa + 1 del paper (kappa = alpha/4), y alpha s su
 * 2 kappa D w0. La cuenta sale de conservar el momento angular respecto al
 * punto de contacto con la pared: la pelota termina rodando pared abajo a
 * (U_down + alpha s)/(1 + alpha), donde s es cuanto SUBE el punto de
 * contacto por el giro que ya traia. Un corte (backspin) hacia la pared
 * sube ese punto: la pelota llega "ya rodando" y el nick es mas facil.
 * Con H* = 0.65 y E = 45 kPa sale el beta = 0.623 del paper.
 */
export const nickCheck = (
  v: Vec3,
  w: Vec3,
  n: Vec3,
  height: number,
  p: NickParams,
): NickCheck => {
  const R = p.diameter / 2;
  const heightRatio = height / p.diameter;
  const inBand = heightRatio > p.band.min && heightRatio < p.band.max;
  const un = Math.max(0, -dot(v, n));
  const down = -v.y;
  const descending = down > 1e-9;
  const s = cross(w, scale(n, -R)).y;
  const drive = down + p.inertiaFactor * s;
  const contactTime =
    un > 1e-9
      ? 3.29 * Math.pow((p.mass * p.mass) / (p.diameter * p.stiffness * p.stiffness * un), 1 / 5)
      : Infinity;
  const rollTime = descending && drive > 1e-9 ? (height * (1 + p.inertiaFactor)) / drive : Infinity;
  const tau = Number.isFinite(contactTime) ? rollTime / contactTime : Infinity;
  return {
    heightRatio,
    inBand,
    descending,
    contactTime,
    rollTime,
    tau,
    rollout: inBand && descending && un > 1e-9 && tau < 1,
  };
};

const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Giro de rodadura sin deslizar sobre el piso, conservando el giro vertical. */
export const rollingSpin = (v: Vec3, radius: number, spinY = 0): Vec3 => {
  const h = { x: v.x, y: 0, z: v.z };
  const w = scale(cross(UP, h), 1 / radius);
  return { x: w.x, y: spinY, z: w.z };
};

/**
 * Una pelota que se arrastra por el piso termina rodando. La friccion
 * actua en el punto de apoyo, asi que el momento angular respecto a ese
 * punto se conserva:
 *
 *   l = R (y x v) + alpha R^2 w_h  =  R (1 + alpha) (y x v_r)
 *   => v_r = (l x y)/(R (1 + alpha))
 *
 * Sin giro previo sale v/(1 + alpha): el 63 % de la velocidad. El giro
 * alrededor del eje vertical no cambia (el piso no hace par en ese eje).
 */
export const settleRolling = (
  v: Vec3,
  w: Vec3,
  radius: number,
  inertiaFactor: number,
): { v: Vec3; w: Vec3 } => {
  const h = { x: v.x, y: 0, z: v.z };
  const wh = { x: w.x, y: 0, z: w.z };
  const l = addScaled(scale(cross(UP, h), radius), wh, inertiaFactor * radius * radius);
  const vr = scale(cross(l, UP), 1 / (radius * (1 + inertiaFactor)));
  return { v: vr, w: rollingSpin(vr, radius, w.y) };
};

/** Parametros por defecto del contacto, para una superficie con COR e. */
export const defaultContact = (restitution: number): ContactParams => ({
  restitution,
  friction: SPIN.friction,
  tangentialCor: SPIN.tangentialCor,
  inertiaFactor: SPIN.inertiaFactor,
  radius: BALL.radius,
});

export const defaultNick = (): NickParams => ({
  stiffness: SPIN.stiffness,
  mass: BALL.mass,
  diameter: BALL.diameter,
  inertiaFactor: SPIN.inertiaFactor,
  band: SPIN.nickBand,
});

/** rad/s -> rpm, para la pantalla. */
export const rpm = (w: number): number => (w * 60) / (2 * Math.PI);
