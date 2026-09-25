/**
 * Acumulador compartido por los dos motores.
 *
 * Su unico trabajo es producir un `Trajectory` bien formado: muestras a
 * paso fijo en una rejilla de tiempo global, MAS una muestra exacta en
 * cada rebote. Los vertices exactos en los rebotes importan: sin ellos la
 * polilinea 2D corta las esquinas y el scrub no puede pararse en un rebote.
 */

import { SIM } from './constants.js';
import type {
  Bounce,
  PhysicsModel,
  Sample,
  SurfaceId,
  Termination,
  Trajectory,
  Vec3,
} from './types.js';
import { clone, dot, length, normalize } from './vec3.js';

export class TrajectoryBuilder {
  private readonly samples: Sample[] = [];
  private readonly bounces: Bounce[] = [];
  private nextSampleTime = 0;

  constructor(
    private readonly sampleDt: number,
    private readonly model: PhysicsModel,
  ) {}

  /** Muestra en un instante exacto, sin tocar la rejilla. */
  pushExact(t: number, p: Vec3, v: Vec3, w?: Vec3): void {
    const sample: Sample = w
      ? { t, p: clone(p), v: clone(v), w: clone(w) }
      : { t, p: clone(p), v: clone(v) };
    const last = this.samples[this.samples.length - 1];
    if (last && Math.abs(last.t - t) < 1e-12) {
      // Ya hay una muestra en ese instante: sustituir por la exacta.
      this.samples[this.samples.length - 1] = sample;
      return;
    }
    this.samples.push(sample);
    if (t >= this.nextSampleTime) {
      this.nextSampleTime =
        (Math.floor(t / this.sampleDt) + 1) * this.sampleDt;
    }
  }

  /**
   * Rellena la rejilla de muestreo entre t0 y t1 usando `at`, que evalua
   * la trayectoria en un instante dado dentro de ese tramo.
   */
  fillGrid(
    t0: number,
    t1: number,
    at: (t: number) => { p: Vec3; v: Vec3; w?: Vec3 },
  ): void {
    while (this.nextSampleTime <= t1 + 1e-12) {
      const t = this.nextSampleTime;
      if (t >= t0 - 1e-12) {
        const { p, v, w } = at(t);
        const last = this.samples[this.samples.length - 1];
        if (!last || Math.abs(last.t - t) > 1e-12) {
          this.samples.push(
            w ? { t, p: clone(p), v: clone(v), w: clone(w) } : { t, p: clone(p), v: clone(v) },
          );
        }
      }
      this.nextSampleTime += this.sampleDt;
    }
  }

  /**
   * Registra un rebote. `dIn` es la direccion de llegada (unitaria o no),
   * `n` la normal interior de la superficie.
   */
  pushBounce(args: {
    surface: SurfaceId;
    point: Vec3;
    time: number;
    vIn: Vec3;
    vOut: Vec3;
    normal: Vec3;
    /** Lo que sabe el motor con efecto: giro, deslizamiento, nick. */
    extra?: Pick<Bounce, 'spinIn' | 'spinOut' | 'slipped' | 'nickTau' | 'rollout' | 'rolling'>;
  }): Bounce {
    const dIn = normalize(args.vIn);
    // Angulo respecto a la normal: 0 = perpendicular, 90 = rasante.
    const cosTheta = Math.max(-1, Math.min(1, -dot(dIn, args.normal)));
    const bounce: Bounce = {
      index: this.bounces.length + 1,
      surface: args.surface,
      point: clone(args.point),
      time: args.time,
      incomingSpeed: length(args.vIn),
      outgoingSpeed: length(args.vOut),
      incidenceAngleDeg: (Math.acos(cosTheta) * 180) / Math.PI,
      velocityIn: clone(args.vIn),
      velocityOut: clone(args.vOut),
    };
    const x = args.extra;
    if (x) {
      if (x.spinIn) bounce.spinIn = clone(x.spinIn);
      if (x.spinOut) bounce.spinOut = clone(x.spinOut);
      if (x.slipped !== undefined) bounce.slipped = x.slipped;
      if (x.nickTau !== undefined) bounce.nickTau = x.nickTau;
      if (x.rollout) bounce.rollout = true;
      if (x.rolling) bounce.rolling = true;
    }
    this.bounces.push(bounce);
    return bounce;
  }

  get bounceCount(): number {
    return this.bounces.length;
  }

  finish(totalTime: number, terminated: Termination): Trajectory {
    return {
      samples: this.samples,
      bounces: this.bounces,
      totalTime,
      terminated,
      model: this.model,
    };
  }
}

export const defaultSampleDt = (dt?: number): number =>
  dt && dt > 0 ? dt : SIM.sampleDt;
