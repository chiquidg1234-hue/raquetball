import { describe, expect, it } from 'vitest';

import { COURT } from '../src/core/constants.js';
import { simulateGeometric } from '../src/core/engine-geometric.js';
import {
  pathLength,
  splitByBounce,
  stateAt,
} from '../src/core/trajectory-utils.js';
import { normalize, v3 } from '../src/core/vec3.js';
import { FRONT, PLAN, PROJECTIONS, SIDE } from '../src/render2d/projections.js';

const traj = simulateGeometric({
  origin: v3(2.1, 0.9, 8),
  direction: normalize(v3(0.28, 0.12, -1)),
  speed: 45,
});

describe('proyecciones ortograficas', () => {
  it('cada vista descarta exactamente un eje', () => {
    expect(PLAN.dropped).toBe('y');
    expect(FRONT.dropped).toBe('z');
    expect(SIDE.dropped).toBe('x');
  });

  it('project y unproject son inversas', () => {
    const p = v3(1.7, 2.3, 9.4);
    const missing = { y: p.y, z: p.z, x: p.x } as const;
    for (const proj of PROJECTIONS) {
      const back = proj.unproject(proj.project(p), missing[proj.dropped]);
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
      expect(back.z).toBeCloseTo(p.z, 12);
    }
  });

  it('el viewBox de cada vista es el rectangulo real de la cancha', () => {
    expect(PLAN.width).toBeCloseTo(COURT.width, 12);
    expect(PLAN.height).toBeCloseTo(COURT.length, 12);
    expect(FRONT.width).toBeCloseTo(COURT.width, 12);
    expect(FRONT.height).toBeCloseTo(COURT.height, 12);
    expect(SIDE.width).toBeCloseTo(COURT.length, 12);
    expect(SIDE.height).toBeCloseTo(COURT.height, 12);
  });

  it('el piso queda abajo en los dos alzados', () => {
    const floor = v3(3, 0, 6);
    const ceiling = v3(3, COURT.height, 6);
    expect(FRONT.project(floor).v).toBeGreaterThan(FRONT.project(ceiling).v);
    expect(SIDE.project(floor).v).toBeGreaterThan(SIDE.project(ceiling).v);
  });

  it('la pared frontal queda arriba en planta y a la izquierda en lateral', () => {
    expect(PLAN.project(v3(3, 1, 0)).v).toBeLessThan(
      PLAN.project(v3(3, 1, COURT.length)).v,
    );
    expect(SIDE.project(v3(3, 1, 0)).u).toBeLessThan(
      SIDE.project(v3(3, 1, COURT.length)).u,
    );
  });

  it('las tres vistas proyectan el MISMO arreglo de muestras', () => {
    for (const proj of PROJECTIONS) {
      const pts = traj.samples.map((s) => proj.project(s.p));
      expect(pts).toHaveLength(traj.samples.length);
      expect(pts.every((p) => Number.isFinite(p.u) && Number.isFinite(p.v))).toBe(
        true,
      );
    }
  });
});

describe('utilidades de trayectoria', () => {
  it('splitByBounce produce un tramo mas que rebotes', () => {
    const segments = splitByBounce(traj);
    expect(traj.bounces.length).toBeGreaterThan(1);
    expect(segments.length).toBe(traj.bounces.length + 1);
  });

  it('los tramos comparten el punto de rebote: no hay huecos', () => {
    const segments = splitByBounce(traj);
    for (let i = 1; i < segments.length; i++) {
      const prevEnd = segments[i - 1]!.at(-1)!;
      const nextStart = segments[i]![0]!;
      expect(nextStart.t).toBeCloseTo(prevEnd.t, 12);
      expect(nextStart.p.x).toBeCloseTo(prevEnd.p.x, 12);
    }
  });

  it('stateAt interpola y satura en los extremos', () => {
    expect(stateAt(traj, -1)!.t).toBeCloseTo(0, 12);
    expect(stateAt(traj, 1e6)!.t).toBeCloseTo(traj.totalTime, 12);
    const mid = stateAt(traj, traj.totalTime / 2)!;
    expect(mid.t).toBeCloseTo(traj.totalTime / 2, 12);
  });

  it('pathLength = velocidad x tiempo en el motor geometrico', () => {
    expect(pathLength(traj)).toBeCloseTo(45 * traj.totalTime, 4);
  });
});
