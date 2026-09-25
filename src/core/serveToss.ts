/**
 * El saque de verdad: el sacador lanza la pelota con la mano, la deja botar
 * UNA vez dentro de la zona de saque y le pega en ese rebote.
 *
 * Reglamento IRF (INVESTIGACION.md, seccion 5 y 9):
 *   3.3    "La bola debe rebotar en el piso en la zona de servicio y
 *          despues del primer rebote ser golpeada por la raqueta", "without
 *          the ball touching anything else".
 *   3.8(f) Botarla fuera de la zona de saque es falta.
 *
 * El lanzamiento es SU PROPIO MOVIMIENTO (INVESTIGACION 9): la mano la
 * suelta a una altura, con una fuerza y hacia un lado (adelante, en
 * diagonal) o la deja caer ("drop the ball, don't bounce it", Cliff
 * Swain). Se simula con el MISMO motor balistico que el tiro (el mismo
 * aire, el mismo piso, con efecto), y el PUNTO DE CONTACTO (x, y, z) sale
 * de donde esta la pelota al golpearla: ya no se pone a mano. Lanzarla
 * hacia delante mueve el golpe hacia delante; mas alto, mas alto.
 *
 * El bote de la mano NO es un bote del tiro. Vive en su propia
 * `Trajectory`, separada, y nunca entra en la numeracion 1, 2, 3 de los
 * botes de piso, que empieza despues del golpe.
 */

import { COURT } from './constants.js';
import { simulateBallistic } from './engine-ballistic.js';
import { stateAt } from './trajectory-utils.js';
import type { Bounce, Sample, Trajectory, Vec3, VenuePhysics } from './types.js';
import { fromAzimuthElevation } from './vec3.js';

export interface TossParams {
  /** Altura del centro de la pelota al soltarla, en m. */
  releaseHeight: number;
  /** Con que velocidad sale de la mano (m/s). 0 = dejarla caer. */
  throwSpeed: number;
  /**
   * Hacia donde la lanza, en planta: 0 = hacia la frontal, positivo hacia
   * la derecha, negativo hacia la izquierda (igual que el azimut del tiro).
   */
  throwAzimuthDeg: number;
  /** Cuanto hacia abajo: 0 = horizontal, 90 = derecho al piso. */
  throwDownDeg: number;
  /**
   * Cuando se le pega, medido en fases del rebote:
   *   0 = justo al botar, 1 = en lo mas alto, 2 = al volver a tocar el piso.
   * Por encima de 2 la pelota ya boto dos veces: falta.
   */
  strikePhase: number;
}

/**
 * Por defecto un lanzamiento suave hacia delante y abajo: 1 m/s a 45
 * grados. Bota ~0.3 m por delante de la mano y se le pega subiendo, ~0.4 m
 * por delante de donde se solto.
 */
export const TOSS_DEFAULTS: TossParams = {
  releaseHeight: 1.0,
  throwSpeed: 1.0,
  throwAzimuthDeg: 0,
  throwDownDeg: 45,
  strikePhase: 0.8,
};

/** Soltarla sin lanzarla, como se hacia antes. Los enlaces viejos abren asi. */
export const TOSS_DROP: Pick<TossParams, 'throwSpeed' | 'throwAzimuthDeg' | 'throwDownDeg'> = {
  throwSpeed: 0,
  throwAzimuthDeg: 0,
  throwDownDeg: 90,
};

export const TOSS_LIMITS = {
  releaseHeight: { min: 0.4, max: 2.0 },
  throwSpeed: { min: 0, max: 6 },
  throwAzimuthDeg: { min: -60, max: 60 },
  throwDownDeg: { min: 0, max: 90 },
  strikePhase: { min: 0.05, max: 2.4 },
} as const;

export type TossFault = 'toss-outside' | 'double-bounce' | 'toss-wall';

export interface Toss {
  params: TossParams;
  /**
   * La pelota desde la mano hasta el golpe, en su propio tiempo: 0 es el
   * instante en que sale de la mano y `duration` el del golpe. Es una
   * Trajectory normal para poder dibujarla, pero NO es el tiro.
   */
  path: Trajectory;
  release: Vec3;
  /** El bote de saque: el primer contacto con el piso de `path`. */
  bounce: Bounce;
  apex: { point: Vec3; time: number };
  /** Cuando volveria a tocar el piso si nadie le pega. */
  secondBounceTime: number;
  strike: { point: Vec3; time: number; rising: boolean };
  /** Tiempo desde que sale de la mano hasta el golpe. */
  duration: number;
  fault: TossFault | null;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Normaliza parametros de cualquier procedencia (URL, localStorage). */
export const normalizeToss = (raw: Partial<TossParams> | null | undefined): TossParams => {
  const r = raw ?? {};
  const L = TOSS_LIMITS;
  return {
    releaseHeight: clamp(num(r.releaseHeight, TOSS_DEFAULTS.releaseHeight), L.releaseHeight.min, L.releaseHeight.max),
    throwSpeed: clamp(num(r.throwSpeed, TOSS_DEFAULTS.throwSpeed), L.throwSpeed.min, L.throwSpeed.max),
    throwAzimuthDeg: clamp(num(r.throwAzimuthDeg, TOSS_DEFAULTS.throwAzimuthDeg), L.throwAzimuthDeg.min, L.throwAzimuthDeg.max),
    throwDownDeg: clamp(num(r.throwDownDeg, TOSS_DEFAULTS.throwDownDeg), L.throwDownDeg.min, L.throwDownDeg.max),
    strikePhase: clamp(num(r.strikePhase, TOSS_DEFAULTS.strikePhase), 0, L.strikePhase.max),
  };
};

/** Esta la marca del bote dentro de la zona de saque (lineas incluidas)? */
export const inServiceZone = (z: number): boolean =>
  z >= COURT.serviceLine - 1e-9 && z <= COURT.shortLine + 1e-9;

/**
 * Simula el lanzamiento desde la mano en (x, z). `physics` es el aire y el
 * piso del sitio de juego: la misma pelota bota mas alto en una cancha que
 * en otra solo si el piso o el aire son otros.
 */
export const simulateToss = (
  x: number,
  z: number,
  params: Partial<TossParams>,
  physics: VenuePhysics = {},
): Toss => {
  const p = normalizeToss(params);
  const release: Vec3 = { x, y: p.releaseHeight, z };
  const direction =
    p.throwSpeed > 1e-6
      ? fromAzimuthElevation(p.throwAzimuthDeg, -p.throwDownDeg)
      : { x: 0, y: -1, z: 0 };

  // Hasta el tercer bote: el segundo marca el limite legal, y si el golpe
  // llega despues hay que tener por donde anda la pelota.
  const full = simulateBallistic(
    { origin: release, direction, speed: p.throwSpeed },
    { ...physics, maxBounces: 6, maxTime: 6, sampleDt: 1 / 480, stopAfterFloorBounces: 3 },
  );

  const floors = full.bounces.filter((b) => b.surface === 'floor');
  const bounce = floors[0] ?? full.bounces[0]!;
  // Sin segundo bote (reposo): se toma el final de la simulacion.
  const secondBounceTime = floors[1]?.time ?? full.totalTime;

  // Lo mas alto tras el bote: donde la velocidad vertical cruza cero.
  let apexTime = bounce.time;
  const after = full.samples.filter((s) => s.t > bounce.time && s.t < secondBounceTime);
  for (let i = 1; i < after.length; i++) {
    const a = after[i - 1]!;
    const b = after[i]!;
    if (a.v.y > 0 && b.v.y <= 0) {
      const k = a.v.y / (a.v.y - b.v.y);
      apexTime = a.t + (b.t - a.t) * k;
      break;
    }
  }
  const apexPoint = stateAt(full, apexTime)?.p ?? bounce.point;

  const phase = p.strikePhase;
  const rise = apexTime - bounce.time;
  const fall = secondBounceTime - apexTime;
  const strikeTime =
    phase <= 1
      ? bounce.time + phase * rise
      : phase <= 2
        ? apexTime + (phase - 1) * fall
        : secondBounceTime + (phase - 2) * fall;
  const strikeState = stateAt(full, Math.min(strikeTime, full.totalTime));
  const strikePoint = strikeState?.p ?? apexPoint;

  const samples: Sample[] = full.samples.filter((s) => s.t < strikeTime - 1e-9);
  if (strikeState) samples.push({ t: strikeTime, p: strikeState.p, v: strikeState.v });
  const path: Trajectory = {
    samples,
    bounces: full.bounces.filter((b) => b.time <= strikeTime),
    totalTime: strikeTime,
    terminated: full.terminated,
    model: 'ballistic',
  };

  // "Without the ball touching anything else": una pared antes del golpe
  // tambien es falta, y la primera en mirarse (lo que pase despues ya no
  // es un saque).
  const touchedWall = path.bounces.some((b) => b.surface !== 'floor');
  const fault: TossFault | null = touchedWall
    ? 'toss-wall'
    : bounce.surface !== 'floor' || !inServiceZone(bounce.point.z)
      ? 'toss-outside'
      : strikeTime >= secondBounceTime - 1e-9
        ? 'double-bounce'
        : null;

  return {
    params: p,
    path,
    release,
    bounce,
    apex: { point: apexPoint, time: apexTime },
    secondBounceTime,
    strike: {
      point: strikePoint,
      time: strikeTime,
      rising: (strikeState?.v.y ?? 0) > 0,
    },
    duration: strikeTime,
    fault,
  };
};

/** Donde esta la pelota del lanzamiento a `t` segundos ANTES del golpe. */
export const tossPositionBefore = (toss: Toss, secondsBefore: number): Vec3 | null =>
  stateAt(toss.path, toss.duration - secondsBefore)?.p ?? null;

/** Texto corto del momento del golpe, para el panel. */
export const describeStrike = (toss: Toss): string => {
  const p = toss.params.strikePhase;
  if (toss.fault === 'double-bounce') return 'después del 2.º bote: falta';
  if (Math.abs(p - 1) < 0.04) return 'en lo más alto';
  if (p < 1) return `subiendo, ${Math.round(p * 100)} % del rebote`;
  return `bajando, ${Math.round((p - 1) * 100)} % de la caída`;
};
