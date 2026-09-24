import { describe, expect, it } from 'vitest';

import { BALL, COURT, SIM } from '../src/core/constants.js';
import { CENTER_BOX, penetrationDepth } from '../src/core/court.js';
import { simulateGeometric } from '../src/core/engine-geometric.js';
import type { Shot } from '../src/core/types.js';
import {
  fromAzimuthElevation,
  length,
  normalize,
  sub,
  v3,
} from '../src/core/vec3.js';

const shot = (partial: Partial<Shot> = {}): Shot => ({
  origin: v3(COURT.width / 2, 0.9, 8),
  direction: v3(0, 0, -1),
  speed: 45,
  ...partial,
});

describe('convenio de radio de pelota', () => {
  it('la caja del centro esta encogida por el radio en los seis lados', () => {
    expect(CENTER_BOX.xMin).toBeCloseTo(BALL.radius, 12);
    expect(CENTER_BOX.xMax).toBeCloseTo(COURT.width - BALL.radius, 12);
    expect(CENTER_BOX.yMin).toBeCloseTo(BALL.radius, 12);
    expect(CENTER_BOX.yMax).toBeCloseTo(COURT.height - BALL.radius, 12);
    expect(CENTER_BOX.zMin).toBeCloseTo(BALL.radius, 12);
    expect(CENTER_BOX.zMax).toBeCloseTo(COURT.length - BALL.radius, 12);
  });

  it('ningun punto de contacto mete la pelota dentro de la pared', () => {
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(0.31, 0.17, -1)) }),
    );
    for (const b of traj.bounces) {
      expect(penetrationDepth(b.point)).toBeLessThan(1e-9);
    }
    for (const s of traj.samples) {
      expect(penetrationDepth(s.p)).toBeLessThan(1e-9);
    }
  });
});

describe('motor geometrico: reflexion especular', () => {
  it('un tiro perpendicular a la frontal vuelve por donde vino', () => {
    const traj = simulateGeometric(shot({ direction: v3(0, 0, -1) }));
    const first = traj.bounces[0]!;
    expect(first.surface).toBe('front');
    expect(first.point.z).toBeCloseTo(BALL.radius, 12);
    expect(first.incidenceAngleDeg).toBeCloseTo(0, 9);

    const second = traj.bounces[1]!;
    expect(second.surface).toBe('back');
    expect(second.point.x).toBeCloseTo(COURT.width / 2, 9);
  });

  it('el angulo de salida es igual al de entrada', () => {
    const traj = simulateGeometric(
      shot({
        origin: v3(1.0, 0.9, 4),
        direction: normalize(v3(0.5, 0, -1)),
        speed: 40,
      }),
    );
    const b = traj.bounces[0]!;
    expect(b.surface).toBe('front');
    // 0.5 en X por 1 en -Z -> atan(0.5) = 26.565 grados de la normal.
    expect(b.incidenceAngleDeg).toBeCloseTo(
      (Math.atan(0.5) * 180) / Math.PI,
      6,
    );
  });

  it('conserva la velocidad en todos los rebotes', () => {
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(0.2, 0, -1)), speed: 52 }),
    );
    expect(traj.bounces.length).toBeGreaterThan(3);
    for (const b of traj.bounces) {
      expect(b.incomingSpeed).toBeCloseTo(52, 9);
      expect(b.outgoingSpeed).toBeCloseTo(52, 9);
    }
    for (const s of traj.samples) {
      expect(length(s.v)).toBeCloseTo(52, 9);
    }
  });

  it('el tiempo de cada tramo cuadra con la distancia recorrida', () => {
    const speed = 37;
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(-0.3, 0.2, -1)), speed }),
    );
    let prevPoint = traj.samples[0]!.p;
    let prevTime = 0;
    for (const b of traj.bounces) {
      const d = length(sub(b.point, prevPoint));
      expect(b.time - prevTime).toBeCloseTo(d / speed, 9);
      prevPoint = b.point;
      prevTime = b.time;
    }
  });
});

describe('pared trasera de 12 ft', () => {
  it('un lob que cruza la trasera por encima de 12 ft sale de la cancha', () => {
    // Apuntar alto a la frontal para que el rebote suba y se pase por detras.
    const traj = simulateGeometric(
      shot({
        origin: v3(COURT.width / 2, 1.0, 7),
        direction: fromAzimuthElevation(0, 42),
        speed: 45,
      }),
    );
    expect(traj.terminated).toBe('exitedCourt');
    const last = traj.bounces[traj.bounces.length - 1]!;
    expect(last.surface).not.toBe('back');
  });

  it('un tiro bajo si rebota en la trasera', () => {
    const traj = simulateGeometric(
      shot({ origin: v3(3, 0.8, 4), direction: v3(0, 0, 1), speed: 30 }),
    );
    expect(traj.bounces[0]!.surface).toBe('back');
    expect(traj.bounces[0]!.point.y).toBeLessThan(COURT.backWallHeight);
  });
});

describe('terminacion', () => {
  it('se detiene en maxBounces', () => {
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(0.2, 0.05, -1)) }),
      { maxBounces: 5, maxTime: 60 },
    );
    expect(traj.terminated).toBe('maxBounces');
    expect(traj.bounces).toHaveLength(5);
  });

  it('se detiene en maxTime y la ultima muestra cae justo en maxTime', () => {
    const traj = simulateGeometric(shot({ speed: 12 }), {
      maxBounces: 999,
      maxTime: 1.3,
    });
    expect(traj.terminated).toBe('maxTime');
    expect(traj.totalTime).toBeCloseTo(1.3, 12);
    expect(traj.samples[traj.samples.length - 1]!.t).toBeCloseTo(1.3, 12);
  });

  it('una direccion nula no cuelga el motor', () => {
    const traj = simulateGeometric(shot({ direction: v3(0, 0, 0) }));
    expect(traj.bounces).toHaveLength(0);
    expect(traj.totalTime).toBe(0);
  });
});

describe('muestreo', () => {
  it('hay un vertice exacto en cada rebote', () => {
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(0.33, 0.21, -1)) }),
    );
    for (const b of traj.bounces) {
      const hit = traj.samples.find((s) => Math.abs(s.t - b.time) < 1e-12);
      expect(hit, `falta muestra en el rebote ${b.index}`).toBeDefined();
      expect(hit!.p.x).toBeCloseTo(b.point.x, 12);
      expect(hit!.p.y).toBeCloseTo(b.point.y, 12);
      expect(hit!.p.z).toBeCloseTo(b.point.z, 12);
    }
  });

  it('las muestras van estrictamente hacia adelante en el tiempo', () => {
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(-0.45, 0.3, -1)), speed: 70 }),
    );
    for (let i = 1; i < traj.samples.length; i++) {
      expect(traj.samples[i]!.t).toBeGreaterThan(traj.samples[i - 1]!.t);
    }
  });

  it('no deja huecos mayores que el paso de muestreo', () => {
    const traj = simulateGeometric(
      shot({ direction: normalize(v3(0.1, 0.4, -1)), speed: 60 }),
    );
    for (let i = 1; i < traj.samples.length; i++) {
      const gap = traj.samples[i]!.t - traj.samples[i - 1]!.t;
      expect(gap).toBeLessThanOrEqual(SIM.sampleDt + 1e-9);
    }
  });
});

describe('rendimiento', () => {
  it('mil simulaciones tardan menos de 200 ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      simulateGeometric(
        shot({ direction: fromAzimuthElevation((i % 60) - 30, (i % 20) - 5) }),
      );
    }
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
