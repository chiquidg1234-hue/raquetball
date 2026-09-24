import { describe, expect, it } from 'vitest';

import {
  BALL,
  COURT,
  DRAG_K,
  GRAVITY,
  IN,
  SIM,
} from '../src/core/constants.js';
import { CENTER_BOX, penetrationDepth } from '../src/core/court.js';
import { simulateBallistic } from '../src/core/engine-ballistic.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import type { Shot } from '../src/core/types.js';
import { fromAzimuthElevation, length, v3 } from '../src/core/vec3.js';

const shot = (partial: Partial<Shot> = {}): Shot => ({
  origin: v3(COURT.width / 2, 0.9, 8),
  direction: v3(0, 0, -1),
  speed: 45,
  ...partial,
});

/** Energia especifica: v^2/2 + g*y. Sin masa, que se cancela. */
const energy = (p: { y: number }, v: { x: number; y: number; z: number }) =>
  (v.x * v.x + v.y * v.y + v.z * v.z) / 2 + GRAVITY * p.y;

// ---------------------------------------------------------------- arrastre

describe('el arrastre domina sobre la gravedad', () => {
  it('k vale 0.0194 1/m con los valores oficiales', () => {
    expect(DRAG_K).toBeCloseTo(0.0194, 4);
  });

  it('reproduce la tabla de aceleraciones del spec', () => {
    // velocidad -> arrastre en múltiplos de g
    const expected: [number, number][] = [
      [30, 1.8],
      [45, 4.0],
      [60, 7.1],
      [85, 14.3],
    ];
    for (const [speed, gs] of expected) {
      expect((DRAG_K * speed * speed) / GRAVITY).toBeCloseTo(gs, 1);
    }
  });

  it('una pelota rapida pierde velocidad de forma visible', () => {
    const traj = simulateBallistic(shot({ speed: 80 }), { maxBounces: 1 });
    const final = length(traj.samples.at(-1)!.v);
    expect(final).toBeLessThan(80 * 0.9);
  });
});

// ------------------------------------------- criterios de aceptacion §6.3

describe('criterios de aceptacion del motor balistico', () => {
  it('1. caida libre desde 100 in sin arrastre rebota a 70 in ± 2 cm', () => {
    const dropHeight = 100 * IN; // 2.54 m
    const traj = simulateBallistic(
      { origin: v3(COURT.width / 2, dropHeight, COURT.length / 2), direction: v3(0, -1, 0), speed: 0 },
      { disableDrag: true, maxBounces: 2, maxTime: 4 },
    );

    const first = traj.bounces[0]!;
    expect(first.surface).toBe('floor');

    const apex = Math.max(
      ...traj.samples.filter((s) => s.t > first.time).map((s) => s.p.y),
    );
    expect(apex).toBeCloseTo(70 * IN, 1);
    expect(Math.abs(apex - 70 * IN)).toBeLessThan(0.02);
  });

  it('2. la energia total nunca aumenta entre dos muestras consecutivas', () => {
    for (const az of [-35, -10, 0, 18, 44]) {
      const traj = simulateBallistic(
        shot({ direction: fromAzimuthElevation(az, 12), speed: 62 }),
      );
      for (let i = 1; i < traj.samples.length; i++) {
        const prev = traj.samples[i - 1]!;
        const cur = traj.samples[i]!;
        const before = energy(prev.p, prev.v);
        const after = energy(cur.p, cur.v);
        // Tolerancia solo para el ruido de coma flotante del integrador.
        expect(after, `az=${az} muestra ${i}`).toBeLessThanOrEqual(
          before + 1e-6 * Math.max(1, before),
        );
      }
    }
  });

  it('3. ningun punto de samples queda fuera de la cancha por mas de 1 mm', () => {
    for (const speed of [20, 45, 70, 90]) {
      for (const az of [-60, -22, 0, 31, 70]) {
        const traj = simulateBallistic(
          shot({ direction: fromAzimuthElevation(az, 8), speed }),
        );
        for (const s of traj.samples) {
          expect(penetrationDepth(s.p), `${speed} m/s az=${az}`).toBeLessThan(
            0.001,
          );
        }
      }
    }
  });

  it('4. anti-tunneling: 85 m/s a la frontal da exactamente un rebote front', () => {
    const traj = simulateBallistic(
      shot({ origin: v3(COURT.width / 2, 1.2, 8), speed: 85 }),
      { maxBounces: 1 },
    );
    expect(traj.bounces).toHaveLength(1);
    expect(traj.bounces[0]!.surface).toBe('front');
    for (const s of traj.samples) {
      expect(s.p.z).toBeGreaterThan(CENTER_BOX.zMin - 0.001);
    }
  });

  it('4b. el anti-tunneling lo hace la prueba de segmento, no el paso', () => {
    // A 1/30 s y 90 m/s la pelota "avanza" 3 m por paso, media cancha.
    // Un integrador de mover-y-comprobar se saltaria paredes enteras.
    // Como se prueba el SEGMENTO, aqui no se cuela ni con ese paso.
    const traj = simulateBallistic(
      shot({ direction: fromAzimuthElevation(28, 6), speed: 90 }),
      { physicsDt: 1 / 30 },
    );
    expect(traj.bounces.length).toBeGreaterThan(2);
    for (const s of traj.samples) {
      expect(penetrationDepth(s.p)).toBeLessThan(0.001);
    }
  });

  it('5. todo tiro termina en menos de 8 s simulados y 20 ms de reloj', () => {
    for (const az of [-80, -40, 0, 40, 80]) {
      for (const el of [-20, 0, 25, 55]) {
        const t0 = performance.now();
        const traj = simulateBallistic(
          shot({ direction: fromAzimuthElevation(az, el), speed: 75 }),
        );
        const wall = performance.now() - t0;
        expect(traj.totalTime, `az=${az} el=${el}`).toBeLessThanOrEqual(
          SIM.maxTime + 1e-9,
        );
        expect(wall, `az=${az} el=${el}`).toBeLessThan(20);
      }
    }
  });
});

// ---------------------------------------------------------------- rebotes

describe('modelo de rebote', () => {
  it('el COR normal se aplica a la componente normal', () => {
    const traj = simulateBallistic(
      shot({ origin: v3(3, 2.5, 6), direction: v3(0, -1, 0), speed: 10 }),
      { disableDrag: true, maxBounces: 1 },
    );
    const b = traj.bounces[0]!;
    expect(b.surface).toBe('floor');
    expect(b.outgoingSpeed / b.incomingSpeed).toBeCloseTo(BALL.restitution, 3);
  });

  it('la restitucion tangencial frena la componente paralela', () => {
    const traj = simulateBallistic(
      shot({
        origin: v3(3, 2.0, 8),
        direction: fromAzimuthElevation(0, -45),
        speed: 20,
      }),
      { disableDrag: true, maxBounces: 1 },
    );
    const contact = traj.bounces[0]!.time;
    // La muestra del contacto guarda la velocidad SALIENTE.
    const after = traj.samples.find((s) => Math.abs(s.t - contact) < 1e-12)!;
    const before = traj.samples.filter((s) => s.t < contact).at(-1)!;
    // La componente Z es tangencial al piso: se conserva al 65 %.
    expect(Math.abs(after.v.z / before.v.z)).toBeCloseTo(
      BALL.tangentialRestitution,
      2,
    );
  });

  it('admite un COR distinto por superficie', () => {
    const soft = simulateBallistic(
      shot({ origin: v3(3, 2.5, 6), direction: v3(0, -1, 0), speed: 0 }),
      { disableDrag: true, maxBounces: 1, surfaceRestitution: { floor: 0.2 } },
    );
    expect(soft.bounces[0]!.outgoingSpeed / soft.bounces[0]!.incomingSpeed)
      .toBeCloseTo(0.2, 3);
  });

  it('se detiene por reposo en vez de micro-rebotar sin fin', () => {
    const traj = simulateBallistic(
      { origin: v3(3, 0.35, 6), direction: v3(0, -1, 0), speed: 0 },
      { maxBounces: 200, maxTime: 30 },
    );
    expect(traj.terminated).toBe('restingOnFloor');
    expect(traj.totalTime).toBeLessThan(30);
    const last = traj.samples.at(-1)!;
    expect(last.p.y).toBeLessThan(BALL.radius + 0.05);
  });

  it('la pared trasera de 12 ft sigue dejando salir la pelota', () => {
    // Una pelota que ya viene alta y va hacia el fondo: cruza Z = 12.192
    // por encima de 3.6576 m, donde no hay pared.
    const traj = simulateBallistic(
      { origin: v3(3, 4.5, 9), direction: v3(0, 0.1, 1), speed: 25 },
      { maxTime: 12, maxBounces: 30 },
    );
    expect(traj.terminated).toBe('exitedCourt');
    expect(traj.samples.at(-1)!.p.y).toBeGreaterThan(COURT.backWallHeight);
  });
});

// ---------------------------------------------------------------- presets

describe('los presets no rompen el motor balistico', () => {
  it('ninguno se sale de la cancha ni tarda de mas', () => {
    for (const preset of PRESETS) {
      const r = resolvePreset(preset, v3(COURT.width / 2, 0.9, 8.29));
      const traj = simulateBallistic({
        origin: r.origin,
        direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
        speed: r.speed,
      });
      for (const s of traj.samples) {
        expect(penetrationDepth(s.p), preset.id).toBeLessThan(0.001);
      }
      expect(traj.totalTime, preset.id).toBeLessThanOrEqual(SIM.maxTime + 1e-9);
    }
  });
});
