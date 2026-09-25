import { describe, expect, it } from 'vitest';

import { BALL, COURT } from '../src/core/constants.js';
import { floorBounces, labelContacts, readableSequence } from '../src/core/contacts.js';
import { simulate } from '../src/core/engine.js';
import { judgeServe } from '../src/core/rules.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import { TOSS_DEFAULTS, inServiceZone, simulateToss } from '../src/core/serveToss.js';
import { DEFAULT_VENUE, venueSimOptions, withPlace } from '../src/core/venue.js';
import { normalize, sub, v3 } from '../src/core/vec3.js';

const physics = venueSimOptions(DEFAULT_VENUE);
const spot = { x: COURT.width / 2 + 0.35, z: (COURT.serviceLine + COURT.shortLine) / 2 };
const toss = (releaseHeight: number, strikePhase: number, at = spot) =>
  simulateToss(at.x, at.z, { releaseHeight, strikePhase }, physics);

describe('el bote con la mano', () => {
  it('cae, bota una vez en el piso y sube menos de lo que cayo', () => {
    const t = toss(1.0, 1);
    expect(t.bounce.surface).toBe('floor');
    expect(t.bounce.point.y).toBeCloseTo(BALL.radius, 6);
    expect(t.path.bounces).toHaveLength(1);
    // Sube a ~COR^2 de la caida: 0.74 m desde 1.0 m.
    expect(t.apex.point.y).toBeLessThan(1.0);
    expect(t.apex.point.y).toBeGreaterThan(0.7);
    // Cae en 0.45 s: la caida libre desde 1 m tarda 0.45 s.
    expect(t.bounce.time).toBeCloseTo(0.446, 2);
  });

  it('la altura de contacto sale del lanzamiento, no se pone a mano', () => {
    const top = toss(1.0, 1);
    expect(top.strike.point.y).toBeCloseTo(top.apex.point.y, 3);

    const rising = toss(1.0, 0.5);
    expect(rising.strike.rising).toBe(true);
    expect(rising.strike.point.y).toBeLessThan(top.strike.point.y);
    expect(rising.strike.time).toBeLessThan(top.apex.time);

    const falling = toss(1.0, 1.5);
    expect(falling.strike.rising).toBe(false);
    expect(falling.strike.time).toBeGreaterThan(top.apex.time);

    // Soltarla mas alto la deja pegar mas alto.
    expect(toss(1.6, 1).strike.point.y).toBeGreaterThan(top.strike.point.y + 0.3);
  });

  it('el golpe es el final del lanzamiento', () => {
    const t = toss(1.2, 0.8);
    expect(t.duration).toBeCloseTo(t.strike.time, 12);
    expect(t.path.totalTime).toBeCloseTo(t.strike.time, 12);
    const last = t.path.samples.at(-1)!;
    expect(last.p.y).toBeCloseTo(t.strike.point.y, 9);
  });

  it('pegarle despues del segundo bote es falta', () => {
    expect(toss(1.0, 1.9).fault).toBeNull();
    const late = toss(1.0, 2.2);
    expect(late.fault).toBe('double-bounce');
    expect(late.strike.time).toBeGreaterThan(late.secondBounceTime);
  });

  it('botarla fuera de la zona de saque es falta', () => {
    expect(inServiceZone(COURT.serviceLine)).toBe(true);
    expect(inServiceZone(COURT.shortLine)).toBe(true);
    const outside = toss(1.0, 0.8, { x: 3, z: 3.2 });
    expect(outside.fault).toBe('toss-outside');
  });

  it('en El Alto el mismo bote sube un poco mas (menos aire)', () => {
    const sea = toss(1.5, 1);
    const high = simulateToss(spot.x, spot.z, { releaseHeight: 1.5, strikePhase: 1 }, venueSimOptions(withPlace(DEFAULT_VENUE, 'elalto')));
    expect(high.apex.point.y).toBeGreaterThan(sea.apex.point.y);
  });

  it('los valores por defecto le pegan subiendo, como pidio Gael', () => {
    const t = simulateToss(spot.x, spot.z, TOSS_DEFAULTS, physics);
    expect(t.strike.rising).toBe(true);
    expect(t.fault).toBeNull();
  });
});

describe('el bote de saque no es un bote del tiro (P1)', () => {
  // El ejemplo de Gael: lob Z serve. Se bota con la mano, se le pega, toca
  // la frontal, luego la lateral, y RECIEN AHI da su primer bote.
  const t = toss(1.0, 0.8);
  const origin = t.strike.point;
  const shot = simulate(
    { origin, direction: normalize(sub(v3(0.8, 3.5, 0), origin)), speed: 22 },
    { model: 'ballistic', ...physics },
  );

  it('se lee frontal -> lateral -> bote 1', () => {
    expect(readableSequence(shot, 3)).toBe('F → I → bote 1');
  });

  it('el bote 1 es el primer contacto con el piso DESPUES del golpe', () => {
    const b1 = floorBounces(shot)[0]!;
    expect(b1.time).toBeGreaterThan(0);
    expect(b1).toBe(shot.bounces.find((b) => b.surface === 'floor'));
    const floorLabels = labelContacts(shot)
      .filter((c) => c.kind === 'floor')
      .map((c) => c.label);
    expect(floorLabels[0]).toBe('1');
  });

  it('el bote de la mano no esta entre los contactos del tiro', () => {
    for (const b of shot.bounces) {
      expect(b.point).not.toEqual(t.bounce.point);
    }
    // Aunque la mano bote la pelota, el tiro empieza en el golpe.
    expect(shot.samples[0]!.p).toEqual(origin);
  });

  it('y el saque es legal', () => {
    expect(judgeServe(shot, origin, t).legal).toBe(true);
  });

  it('con doble bote el mismo tiro pasa a ser falta', () => {
    const late = toss(1.0, 2.2);
    const j = judgeServe(shot, origin, late);
    expect(j.legal).toBe(false);
    expect(j.fault).toBe('double-bounce');
  });
});

describe('los saques de la biblioteca con el bote de mano', () => {
  it('siguen siendo legales con la altura que da el bote por defecto', () => {
    for (const preset of PRESETS.filter((p) => p.group === 'saque')) {
      const r = resolvePreset(preset);
      const t = simulateToss(r.origin.x, r.origin.z, TOSS_DEFAULTS, physics);
      const origin = t.strike.point;
      const shot = simulate(
        { origin, direction: normalize(sub(r.target, origin)), speed: r.speed },
        { model: 'ballistic', ...physics },
      );
      expect(judgeServe(shot, origin, t).legal, preset.id).toBe(true);
    }
  });
});
