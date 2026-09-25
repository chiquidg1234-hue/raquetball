import { describe, expect, it } from 'vitest';

import { CRACK_HEIGHT, crackPoint, solveWallAim } from '../src/core/aimWall.js';
import { BALL } from '../src/core/constants.js';
import { crackReport } from '../src/core/crack.js';
import { readableSequence } from '../src/core/contacts.js';
import { simulate } from '../src/core/engine.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';
import { DEFAULT_VENUE, venueSimOptions } from '../src/core/venue.js';

const physics = venueSimOptions(DEFAULT_VENUE);

/** Un tiro a la frontal que la toca con el centro a `h` del piso. */
const toFront = (origin: ReturnType<typeof v3>, speed: number, h: number) => {
  const r = solveWallAim(origin, speed, physics, {
    surface: 'front',
    point: { ...crackPoint('front', origin.x), y: h },
  });
  expect(r.ok).toBe(true);
  return simulate(
    { origin, direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg), speed },
    { model: 'ballistic', ...physics },
  );
};

describe('por que salio rodando, o por que no', () => {
  it('rollout: desde la cintura, bajando, en la franja', () => {
    const t = toFront(v3(3, 1.1, 7), 45, CRACK_HEIGHT);
    const r = crackReport(t)!;
    expect(r.kind).toBe('rollout');
    expect(r.tau).toBeLessThan(1);
    expect(r.text).toContain('sale rodando');
    expect(readableSequence(t, 2)).toBe('F (nick) → bote 1 rodando');
  });

  it('en la franja pero plana: desde la rodilla no sale nunca (tau ~ 1.8)', () => {
    const t = toFront(v3(3, 0.45, 7), 45, CRACK_HEIGHT);
    const r = crackReport(t)!;
    expect(r.kind).toBe('flat');
    expect(r.tau).toBeGreaterThan(1.5);
    expect(r.text).toContain('demasiado plana');
    expect(t.bounces.some((b) => b.rollout)).toBe(false);
  });

  it('cerca: a unos mm de la franja lo dice, con cuantos', () => {
    // 49 mm: 6 mm por encima de los 43 de la franja.
    const t = toFront(v3(3, 1.1, 7), 45, 0.049);
    const r = crackReport(t)!;
    expect(r.kind).toBe('near');
    expect(r.text).toMatch(/6 mm por encima/);
    // Bajaba lo bastante: dentro de la franja habria salido.
    expect(r.text).toContain('habría salido rodando');
  });

  it('lejos del crack no dice nada', () => {
    const t = toFront(v3(3, 1.1, 7), 45, 0.3);
    expect(crackReport(t)).toBeNull();
  });

  it('despues del 2.o bote ya no avisa: la jugada se acabo', () => {
    // El Z serve de la biblioteca toca el crack de la trasera despues de
    // su 2.o bote. Eso no se le cuenta al jugador: el punto ya termino.
    const preset = PRESETS.find((p) => p.id === 'z-serve-right')!;
    const r = resolvePreset(preset, undefined, { model: 'ballistic', physics });
    const t = simulate(
      { origin: r.origin, direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg), speed: r.speed },
      { model: 'ballistic', ...physics },
    );
    const second = t.bounces.filter((b) => b.surface === 'floor')[1]!;
    expect(t.bounces.some((b) => b.nickTau != null && b.time > second.time)).toBe(true);
    expect(crackReport(t)).toBeNull();
  });

  it('la franja son 34-43 mm para una pelota de 57.15 mm', () => {
    const t = toFront(v3(3, 1.1, 7), 45, CRACK_HEIGHT);
    const [lo, hi] = crackReport(t)!.bandMm;
    expect(lo).toBeCloseTo(0.6 * BALL.diameter * 1000, 9);
    expect(lo).toBeCloseTo(34.3, 1);
    expect(hi).toBeCloseTo(42.9, 1);
  });
});
