import { describe, expect, it } from 'vitest';

import { COURT, DEFAULT_CONTACT_HEIGHT } from '../src/core/constants.js';
import {
  floorBounce,
  floorBounces,
  floorCountPerSegment,
  isSkip,
  labelContacts,
  readableSequence,
  segmentOpacity,
} from '../src/core/contacts.js';
import { simulate } from '../src/core/engine.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import { splitByBounce } from '../src/core/trajectory-utils.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const STANCE = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, COURT.length * 0.68);

const fromPreset = (id: string) => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const r = resolvePreset(preset, STANCE);
  return simulate(
    {
      origin: r.origin,
      direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
      speed: r.speed,
    },
    { model: preset.prefersBallistic ? 'ballistic' : 'geometric' },
  );
};

describe('botes de piso frente a rebotes de pared', () => {
  it('el Z serve se lee frontal, lateral y RECIEN ahi el bote 1', () => {
    // El ejemplo de Gael: la pelota toca la frontal, despues la lateral,
    // y solo entonces da su primer bote. Antes salia numerado "1, 2, 3",
    // y ese "3" era en realidad el primer bote.
    const traj = fromPreset('z-serve-left');
    const contacts = labelContacts(traj);

    expect(contacts[0]!.label).toBe('F');
    expect(contacts[1]!.label).toBe('I');
    expect(contacts[2]!.kind).toBe('floor');
    expect(contacts[2]!.label).toBe('1');
    expect(readableSequence(traj, 3)).toBe('F → I → bote 1');
  });

  it('el bote 1 es el primer contacto con el piso, no el primer contacto', () => {
    const traj = fromPreset('z-serve-right');
    const first = labelContacts(traj).find((c) => c.floorIndex === 1)!;
    expect(first.bounce.surface).toBe('floor');
    expect(first.bounce).toBe(traj.bounces.find((b) => b.surface === 'floor'));
    expect(first.bounce.index).toBeGreaterThan(1);
  });

  it('los botes de piso se numeran seguidos sin contar las paredes', () => {
    const traj = fromPreset('ceiling');
    const floors = labelContacts(traj).filter((c) => c.kind === 'floor');
    floors.forEach((c, i) => expect(c.floorIndex).toBe(i + 1));
    const walls = labelContacts(traj).filter((c) => c.kind === 'wall');
    for (const w of walls) {
      expect(w.floorIndex).toBeNull();
      expect(w.label).toMatch(/^[FIDTC]$/);
    }
  });

  it('las paredes llevan su inicial y el techo la C', () => {
    const traj = fromPreset('ceiling');
    const first = labelContacts(traj)[0]!;
    expect(first.bounce.surface).toBe('ceiling');
    expect(first.label).toBe('C');
    expect(first.kind).toBe('wall');
  });

  it('solo los tres primeros botes de piso son principales', () => {
    const traj = simulate(
      { origin: v3(3, 1.2, 8), direction: fromAzimuthElevation(8, -3), speed: 50 },
      { model: 'ballistic', maxBounces: 12 },
    );
    const floors = labelContacts(traj).filter((c) => c.kind === 'floor');
    expect(floors.length).toBeGreaterThanOrEqual(4);
    floors.forEach((c) => expect(c.primary).toBe(c.floorIndex! <= 3));
  });

  it('floorBounce(k) devuelve el k-esimo bote de piso', () => {
    const traj = fromPreset('ceiling');
    expect(floorBounce(traj, 1)).toBe(floorBounces(traj)[0]);
    expect(floorBounce(traj, 2)).toBe(floorBounces(traj)[1]);
    expect(floorBounce(traj, 99)).toBeNull();
  });
});

describe('skip: el piso antes que la frontal', () => {
  const skipShot = () =>
    simulate(
      { origin: v3(3, 0.9, 8), direction: fromAzimuthElevation(0, -25), speed: 30 },
      { model: 'ballistic' },
    );

  it('se marca en los datos de la vista, no solo en el inspector', () => {
    const traj = skipShot();
    expect(isSkip(traj)).toBe(true);
    const contacts = labelContacts(traj);
    expect(contacts[0]!.skip).toBe(true);
    expect(contacts[0]!.kind).toBe('floor');
    expect(contacts.slice(1).every((c) => !c.skip)).toBe(true);
  });

  it('la secuencia legible canta el skip como PISO', () => {
    expect(readableSequence(skipShot(), 2).startsWith('PISO → ')).toBe(true);
  });

  it('un tiro legal no es skip', () => {
    expect(isSkip(fromPreset('kill'))).toBe(false);
    expect(labelContacts(fromPreset('kill')).some((c) => c.skip)).toBe(false);
  });
});

describe('atenuacion por botes de piso', () => {
  it('cada tramo tiene su contador, y cuenta los botes de piso previos', () => {
    // Cuando el tiro termina justo en un contacto, splitByBounce no crea
    // el ultimo tramo vacio: puede sobrar un contador al final, nunca faltar.
    const traj = fromPreset('ceiling');
    const counts = floorCountPerSegment(traj);
    const segments = splitByBounce(traj);
    expect(counts.length).toBeGreaterThanOrEqual(segments.length);
    segments.forEach((seg, i) => {
      const floorsBefore = traj.bounces
        .slice(0, i)
        .filter((b) => b.surface === 'floor').length;
      expect(counts[i], `tramo ${i}`).toBe(floorsBefore);
      expect(seg.length).toBeGreaterThan(0);
    });
  });

  it('antes del primer bote se dibuja entero y se va apagando bote a bote', () => {
    expect(segmentOpacity(0, false)).toBe(1);
    const seq = [0, 1, 2, 3, 4].map((n) => segmentOpacity(n, false));
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeLessThan(seq[i - 1]!);
  });

  it('tras un skip todo lo que sigue queda casi apagado', () => {
    expect(segmentOpacity(1, true)).toBeLessThan(segmentOpacity(4, false));
  });

  it('en un Z serve el tramo que cruza tras la lateral sigue entero: aun no ha botado', () => {
    const counts = floorCountPerSegment(fromPreset('z-serve-left'));
    // tramo 0: raqueta -> F; tramo 1: F -> I; tramo 2: I -> bote 1
    expect(counts.slice(0, 3)).toEqual([0, 0, 0]);
    expect(counts[3]).toBe(1);
  });
});
