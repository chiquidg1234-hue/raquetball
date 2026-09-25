/**
 * El saque de verdad: el sacador suelta la pelota, la deja botar UNA vez
 * dentro de la zona de saque y le pega en el primer rebote.
 *
 * Reglamento IRF (INVESTIGACION.md, seccion 5):
 *   3.3    "La bola debe rebotar en el piso en la zona de servicio y
 *          despues del primer rebote ser golpeada por la raqueta."
 *   3.8(f) Botarla fuera de la zona de saque es falta.
 *
 * El lanzamiento se simula con el MISMO motor balistico que el tiro (el
 * mismo aire, el mismo piso), y de ahi salen la altura y el instante del
 * golpe: ya no se ponen a mano.
 *
 * El bote de la mano NO es un bote del tiro. Vive en su propia
 * `Trajectory`, separada, y nunca entra en la numeracion 1, 2, 3 de los
 * botes de piso, que empieza despues del golpe.
 */

import { COURT } from './constants.js';
import { simulateBallistic } from './engine-ballistic.js';
import { stateAt } from './trajectory-utils.js';
import type { Bounce, Sample, Trajectory, Vec3, VenuePhysics } from './types.js';

export interface TossParams {
  /** Altura del centro de la pelota al soltarla, en m. */
  releaseHeight: number;
  /**
   * Cuando se le pega, medido en fases del rebote:
   *   0 = justo al botar, 1 = en lo mas alto, 2 = al volver a tocar el piso.
   * Por encima de 2 la pelota ya boto dos veces: falta.
   */
  strikePhase: number;
}

export const TOSS_DEFAULTS: TossParams = { releaseHeight: 1.0, strikePhase: 0.8 };

export const TOSS_LIMITS = {
  releaseHeight: { min: 0.4, max: 2.0 },
  strikePhase: { min: 0.05, max: 2.4 },
} as const;

export type TossFault = 'toss-outside' | 'double-bounce';

export interface Toss {
  params: TossParams;
  /**
   * La pelota desde la mano hasta el golpe, en su propio tiempo: 0 es el
   * instante en que sale de la mano y `duration` el del golpe. Es una
   * Trajectory normal para poder dibujarla, pero NO es el tiro.
   */
  path: Trajectory;
  release: Vec3;
  /** El bote de saque: el unico contacto de `path`. */
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

/** Esta la marca del bote dentro de la zona de saque (lineas incluidas)? */
export const inServiceZone = (z: number): boolean =>
  z >= COURT.serviceLine - 1e-9 && z <= COURT.shortLine + 1e-9;

/**
 * Simula el bote con la mano en (x, z). `physics` es el aire y el piso del
 * sitio de juego: la misma pelota bota mas alto en una cancha que en otra
 * solo si el piso o el aire son otros.
 */
export const simulateToss = (
  x: number,
  z: number,
  params: TossParams,
  physics: VenuePhysics = {},
): Toss => {
  const releaseHeight = clamp(
    params.releaseHeight,
    TOSS_LIMITS.releaseHeight.min,
    TOSS_LIMITS.releaseHeight.max,
  );
  const phase = clamp(params.strikePhase, 0, TOSS_LIMITS.strikePhase.max);
  const release: Vec3 = { x, y: releaseHeight, z };

  // Hasta el tercer bote: el segundo marca el limite legal, y si el golpe
  // llega despues hay que tener por donde anda la pelota.
  const full = simulateBallistic(
    { origin: release, direction: { x: 0, y: -1, z: 0 }, speed: 0 },
    { ...physics, maxBounces: 3, maxTime: 6, sampleDt: 1 / 480 },
  );

  const floors = full.bounces.filter((b) => b.surface === 'floor');
  const bounce = floors[0]!;
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

  const fault: TossFault | null = !inServiceZone(bounce.point.z)
    ? 'toss-outside'
    : strikeTime >= secondBounceTime - 1e-9
      ? 'double-bounce'
      : null;

  return {
    params: { releaseHeight, strikePhase: phase },
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
