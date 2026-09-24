import { describe, expect, it } from 'vitest';

import { COURT } from '../src/core/constants.js';
import { CENTER_BOX } from '../src/core/court.js';
import { simulateGeometric } from '../src/core/engine-geometric.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import {
  straightLineError,
  unfoldFirstSideBounce,
} from '../src/core/unfold.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const shotFromPreset = (id: string) => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const r = resolvePreset(preset, v3(COURT.width / 2, 0.9, 8.29));
  return simulateGeometric({
    origin: r.origin,
    direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
    speed: r.speed,
  });
};

describe('modo espejo', () => {
  it('no despliega nada si el tiro no toca una lateral', () => {
    const straight = simulateGeometric({
      origin: v3(COURT.width / 2, 0.9, 8),
      direction: v3(0, 0, -1),
      speed: 45,
    });
    expect(unfoldFirstSideBounce(straight)).toBeNull();
  });

  it('despliega el pinch sobre la lateral correcta', () => {
    const left = unfoldFirstSideBounce(shotFromPreset('pinch-left'))!;
    expect(left.wall).toBe('left');
    expect(left.mirrorX).toBeCloseTo(CENTER_BOX.xMin, 12);

    const right = unfoldFirstSideBounce(shotFromPreset('pinch-right'))!;
    expect(right.wall).toBe('right');
    expect(right.mirrorX).toBeCloseTo(CENTER_BOX.xMax, 12);
  });

  it('con el motor geometrico la recta pasa EXACTAMENTE por el rebote', () => {
    // Es la afirmacion entera del modo espejo. Si esto falla, el modo
    // ensena algo falso.
    for (const id of ['pinch-left', 'pinch-right', 'splat-left', 'splat-right']) {
      const u = unfoldFirstSideBounce(shotFromPreset(id))!;
      expect(straightLineError(u), id).toBeLessThan(1e-9);
      expect(u.exact).toBe(true);
    }
  });

  it('el punto espejado esta al otro lado de la pared', () => {
    const u = unfoldFirstSideBounce(shotFromPreset('pinch-left'))!;
    expect(u.mirroredTarget.x).toBeLessThan(CENTER_BOX.xMin);
    expect(u.rect.x1).toBeCloseTo(2 * CENTER_BOX.xMin, 12);
    expect(u.rect.x0).toBeCloseTo(2 * CENTER_BOX.xMin - COURT.width, 12);
  });

  it('reflejar dos veces devuelve el punto original', () => {
    const u = unfoldFirstSideBounce(shotFromPreset('pinch-right'))!;
    for (const s of u.mirroredSamples) {
      const back = 2 * u.mirrorX - s.p.x;
      expect(back).toBeGreaterThanOrEqual(CENTER_BOX.xMin - 1e-9);
      expect(back).toBeLessThanOrEqual(CENTER_BOX.xMax + 1e-9);
    }
  });
});
