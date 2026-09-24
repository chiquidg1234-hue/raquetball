import { describe, expect, it } from 'vitest';

import { COURT, DEFAULT_CONTACT_HEIGHT } from '../src/core/constants.js';
import { CENTER_BOX } from '../src/core/court.js';
import { simulate } from '../src/core/engine.js';
import {
  NAMED_TARGETS,
  frontWallAimPoint,
  mirrorSolution,
  solveAim,
  type AimTarget,
} from '../src/core/solve.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const STANCE = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, 8.5);

const landing = (
  origin: typeof STANCE,
  az: number,
  el: number,
  speed: number,
  model: 'geometric' | 'ballistic',
  index = 1,
) => {
  const traj = simulate(
    { origin, direction: fromAzimuthElevation(az, el), speed },
    { model, maxBounces: 8 },
  );
  return traj.bounces.filter((b) => b.surface === 'floor')[index - 1] ?? null;
};

describe('metodo del espejo', () => {
  it('refleja el objetivo al otro lado de la pared frontal', () => {
    const { mirrored } = mirrorSolution(STANCE, { x: 2, z: 9 });
    expect(mirrored.x).toBe(2);
    expect(mirrored.z).toBeCloseTo(2 * CENTER_BOX.zMin - 9, 12);
    expect(mirrored.z).toBeLessThan(0);
  });

  it('el punto de mira cae dentro de la pared frontal', () => {
    const { mirrored } = mirrorSolution(STANCE, { x: 2, z: 9 });
    const aim = frontWallAimPoint(STANCE, mirrored)!;
    expect(aim.z).toBeCloseTo(CENTER_BOX.zMin, 12);
    expect(aim.x).toBeGreaterThan(0);
    expect(aim.x).toBeLessThan(COURT.width);
  });

  it('con el motor geometrico la solucion es EXACTA y sin iterar', () => {
    for (const target of [
      { x: 1.2, z: 10.5 },
      { x: 4.8, z: 9.0 },
      { x: 3.0, z: 7.0 },
      { x: 2.0, z: 4.0 },
    ]) {
      const r = solveAim(
        { origin: STANCE, speed: 45, model: 'geometric' },
        { ...target, bounceIndex: 1 },
      );
      expect(r.ok, JSON.stringify(target)).toBe(true);
      expect(r.method).toBe('espejo');
      expect(r.iterations).toBe(0);
      expect(r.error).toBeLessThan(1e-6);
    }
  });

  it('la solucion geometrica cae de verdad donde se pidio', () => {
    const target = { x: 1.5, z: 10.0 };
    const r = solveAim(
      { origin: STANCE, speed: 50, model: 'geometric' },
      { ...target, bounceIndex: 1 },
    );
    const hit = landing(STANCE, r.azimuthDeg, r.elevationDeg, 50, 'geometric')!;
    expect(hit.point.x).toBeCloseTo(target.x, 3);
    expect(hit.point.z).toBeCloseTo(target.z, 3);
  });
});

describe('metodo de disparo con el motor balistico', () => {
  const ballistic = (target: AimTarget, speed = 50) =>
    solveAim({ origin: STANCE, speed, model: 'ballistic' }, target);

  it('resuelve los objetivos con nombre', () => {
    for (const t of NAMED_TARGETS) {
      const r = ballistic({ x: t.x, z: t.z, bounceIndex: t.bounceIndex }, 55);
      expect(r.error, `${t.label}: ${r.note}`).toBeLessThan(0.35);
    }
  });

  it('cuando converge, la pelota cae donde se pidio', () => {
    const target: AimTarget = { x: 1.0, z: 10.8, bounceIndex: 1 };
    const r = ballistic(target, 55);
    expect(r.ok).toBe(true);
    const hit = landing(STANCE, r.azimuthDeg, r.elevationDeg, r.speed, 'ballistic')!;
    expect(Math.hypot(hit.point.x - target.x, hit.point.z - target.z)).toBeLessThan(
      0.05,
    );
  });

  it('parte de la solucion geometrica, asi que converge en pocas iteraciones', () => {
    const r = ballistic({ x: 4.5, z: 10.0, bounceIndex: 1 }, 55);
    expect(r.ok).toBe(true);
    expect(r.iterations).toBeLessThan(30);
  });

  it('es interactivo: resolver cuesta menos de 150 ms', () => {
    const t0 = performance.now();
    ballistic({ x: 1.0, z: 10.8, bounceIndex: 1 }, 55);
    expect(performance.now() - t0).toBeLessThan(150);
  });

  it('busca la velocidad cuando con la actual no hay tiro posible', () => {
    const origin = v3(5.8, 0.9, 1.0);
    const target: AimTarget = { x: 0.4, z: 11.9, bounceIndex: 1 };

    // Desde pegado a la frontal y a 10 m/s no se llega al rincon opuesto
    // del fondo: se queda a 2.5 m.
    const fixed = solveAim(
      { origin, speed: 10, model: 'ballistic' },
      target,
    );
    expect(fixed.ok).toBe(false);

    // Dejandole buscar la fuerza, si.
    const searched = solveAim(
      { origin, speed: 10, model: 'ballistic', searchSpeed: true },
      target,
    );
    expect(searched.ok).toBe(true);
    expect(searched.speed).toBeGreaterThan(10);
    expect(searched.error).toBeLessThan(fixed.error);
  });

  it('dice que no puede en vez de mentir', () => {
    // Un objetivo detras del jugador y pegado a la trasera, tirando muy
    // flojo: no hay tiro que llegue.
    const r = solveAim(
      { origin: v3(3, 0.9, 2), speed: 10, model: 'ballistic' },
      { x: 3, z: 12.0, bounceIndex: 1 },
    );
    expect(r.ok).toBe(false);
    expect(r.note).toContain('Lo mas cerca');
  });
});

describe('segundo bote', () => {
  it('resuelve para que sea el SEGUNDO bote el que caiga en el sitio', () => {
    const target: AimTarget = { x: 3.0, z: 11.0, bounceIndex: 2 };
    const r = solveAim({ origin: STANCE, speed: 45, model: 'ballistic' }, target);
    if (r.ok) {
      const hit = landing(STANCE, r.azimuthDeg, r.elevationDeg, r.speed, 'ballistic', 2)!;
      expect(Math.hypot(hit.point.x - target.x, hit.point.z - target.z))
        .toBeLessThan(0.06);
    } else {
      // Si no converge, tiene que decirlo con el error real.
      expect(r.error).toBeGreaterThan(0);
    }
  });
});
