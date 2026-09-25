import { describe, expect, it } from 'vitest';

import { BALL, COURT } from '../src/core/constants.js';
import { floorBounces, labelContacts, readableSequence } from '../src/core/contacts.js';
import { simulate } from '../src/core/engine.js';
import { judgeServe } from '../src/core/rules.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import {
  TOSS_DEFAULTS,
  TOSS_DROP,
  inServiceZone,
  normalizeToss,
  simulateToss,
} from '../src/core/serveToss.js';
import { DEFAULT_VENUE, venueSimOptions, withPlace } from '../src/core/venue.js';
import { fromAzimuthElevation, normalize, sub, v3 } from '../src/core/vec3.js';

const physics = venueSimOptions(DEFAULT_VENUE);
const spot = { x: COURT.width / 2 + 0.35, z: (COURT.serviceLine + COURT.shortLine) / 2 };
/** Soltarla sin lanzarla: el bote de mano de antes, que estos tests describen. */
const toss = (releaseHeight: number, strikePhase: number, at = spot) =>
  simulateToss(at.x, at.z, { releaseHeight, strikePhase, ...TOSS_DROP }, physics);

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
    const high = simulateToss(
      spot.x,
      spot.z,
      { releaseHeight: 1.5, strikePhase: 1, ...TOSS_DROP },
      venueSimOptions(withPlace(DEFAULT_VENUE, 'elalto')),
    );
    expect(high.apex.point.y).toBeGreaterThan(sea.apex.point.y);
  });

  it('los valores por defecto le pegan subiendo, como pidio Gael', () => {
    const t = simulateToss(spot.x, spot.z, TOSS_DEFAULTS, physics);
    expect(t.strike.rising).toBe(true);
    expect(t.fault).toBeNull();
  });
});

describe('el lanzamiento es su propio movimiento (INVESTIGACION 9)', () => {
  // 1 m/s a 45 grados desde 1 m: 0.71 m/s hacia delante y 0.71 hacia
  // abajo. Llega al piso en t = (-0.71 + sqrt(0.71^2 + 2 g 0.97))/g = 0.38 s,
  // 0.27 m por delante de la mano. En el piso agarra: le queda el 61 % de
  // lo que iba hacia delante, y se le pega subiendo un poco mas alla.
  const thrown = simulateToss(spot.x, spot.z, TOSS_DEFAULTS, physics);

  it('lanzada hacia delante bota por delante de la mano', () => {
    const ahead = spot.z - thrown.bounce.point.z;
    expect(ahead).toBeGreaterThan(0.2);
    expect(ahead).toBeLessThan(0.35);
    expect(thrown.bounce.point.x).toBeCloseTo(spot.x, 6);
  });

  it('el punto de golpe (x, y, z) sale del lanzamiento: mas adelante que el bote', () => {
    const at = thrown.path.samples.at(-1)!.p;
    expect(thrown.strike.point).toEqual(at);
    expect(thrown.strike.point.z).toBeLessThan(thrown.bounce.point.z);
    expect(spot.z - thrown.strike.point.z).toBeGreaterThan(0.3);
    expect(thrown.strike.rising).toBe(true);
    expect(thrown.fault).toBeNull();
  });

  it('mas fuerte, mas lejos; y si bota pasada la linea corta, falta', () => {
    const soft = simulateToss(spot.x, spot.z, { ...TOSS_DEFAULTS, throwSpeed: 1 }, physics);
    const firm = simulateToss(spot.x, spot.z, { ...TOSS_DEFAULTS, throwSpeed: 3, throwDownDeg: 30 }, physics);
    expect(spot.z - firm.bounce.point.z).toBeGreaterThan(spot.z - soft.bounce.point.z + 0.4);
    // 4 m/s casi horizontal: 3.8 m/s hacia delante durante 0.33 s, bota
    // 1.2 m por delante, a z = 4.1: antes de la linea de servicio. Falta.
    const hard = simulateToss(spot.x, spot.z, { ...TOSS_DEFAULTS, throwSpeed: 4, throwDownDeg: 20 }, physics);
    expect(hard.bounce.point.z).toBeLessThan(COURT.serviceLine);
    expect(hard.fault).toBe('toss-outside');
  });

  it('en diagonal el golpe se va hacia ese lado', () => {
    const right = simulateToss(spot.x, spot.z, { ...TOSS_DEFAULTS, throwAzimuthDeg: 45 }, physics);
    const left = simulateToss(spot.x, spot.z, { ...TOSS_DEFAULTS, throwAzimuthDeg: -45 }, physics);
    expect(right.strike.point.x).toBeGreaterThan(spot.x + 0.1);
    expect(left.strike.point.x).toBeLessThan(spot.x - 0.1);
  });

  it('si toca una pared antes del golpe, es falta ("without touching anything else")', () => {
    const nearWall = { x: 0.35, z: spot.z };
    const t = simulateToss(nearWall.x, nearWall.z, { ...TOSS_DEFAULTS, throwSpeed: 4, throwDownDeg: 10, throwAzimuthDeg: -90 }, physics);
    expect(t.fault).toBe('toss-wall');
  });

  it('soltarla (fuerza 0) es el bote de antes: cae derecha', () => {
    const drop = simulateToss(spot.x, spot.z, { ...TOSS_DEFAULTS, throwSpeed: 0 }, physics);
    expect(drop.bounce.point.x).toBeCloseTo(spot.x, 9);
    expect(drop.bounce.point.z).toBeCloseTo(spot.z, 9);
  });

  it('los parametros raros se sanean', () => {
    const p = normalizeToss({ releaseHeight: 9, throwSpeed: -3, throwDownDeg: 200, strikePhase: Number.NaN });
    expect(p.releaseHeight).toBe(2);
    expect(p.throwSpeed).toBe(0);
    expect(p.throwDownDeg).toBe(90);
    expect(p.strikePhase).toBe(TOSS_DEFAULTS.strikePhase);
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
    // Como en la app: primero el bote con la mano da la altura del golpe, y
    // desde ahi el preset se resuelve con la fisica (primer contacto de
    // verdad en su punto de mira).
    for (const preset of PRESETS.filter((p) => p.group === 'saque')) {
      const spot = resolvePreset(preset);
      const t = simulateToss(spot.origin.x, spot.origin.z, TOSS_DEFAULTS, physics);
      const r = resolvePreset(preset, undefined, {
        model: 'ballistic',
        physics,
        strike: t.strike.point,
      });
      const origin = r.origin;
      const shot = simulate(
        { origin, direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg), speed: r.speed },
        { model: 'ballistic', ...physics },
      );
      expect(judgeServe(shot, origin, t).legal, preset.id).toBe(true);
    }
  });
});
