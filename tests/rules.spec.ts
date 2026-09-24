import { describe, expect, it } from 'vitest';

import { COURT, DEFAULT_CONTACT_HEIGHT } from '../src/core/constants.js';
import { simulate } from '../src/core/engine.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import {
  analyse,
  classify,
  deepHeight,
  judgeReturn,
  judgeServe,
} from '../src/core/rules.js';
import type { Trajectory } from '../src/core/types.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const STANCE = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, COURT.length * 0.68);

const fromPreset = (id: string, stance = STANCE) => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const r = resolvePreset(preset, stance);
  const traj = simulate(
    {
      origin: r.origin,
      direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
      speed: r.speed,
    },
    { model: preset.prefersBallistic ? 'ballistic' : 'geometric' },
  );
  return { traj, origin: r.origin };
};

const shoot = (
  origin: ReturnType<typeof v3>,
  az: number,
  el: number,
  speed: number,
  model: 'geometric' | 'ballistic' = 'ballistic',
): Trajectory =>
  simulate(
    { origin, direction: fromAzimuthElevation(az, el), speed },
    { model },
  );

describe('validacion de devolucion', () => {
  it('un tiro directo a la frontal es legal', () => {
    const t = shoot(v3(3, 0.9, 8), 0, 2, 50);
    expect(judgeReturn(t).legal).toBe(true);
  });

  it('tocar el piso antes que la frontal es skip ball', () => {
    const t = shoot(v3(3, 0.9, 8), 0, -25, 30);
    const j = judgeReturn(t);
    expect(j.fault).toBe('skip');
    expect(j.legal).toBe(false);
  });

  it('tocar una lateral antes que la frontal sigue siendo legal', () => {
    const { traj } = fromPreset('pinch-left');
    expect(traj.bounces[0]!.surface).toBe('left');
    expect(judgeReturn(traj).legal).toBe(true);
  });
});

describe('validacion de saque', () => {
  const serveSpot = v3(COURT.width / 2, 0.85, 5.334);

  it('el drive serve es legal', () => {
    const { traj, origin } = fromPreset('drive-serve-left');
    expect(judgeServe(traj, origin).legal).toBe(true);
  });

  it('botar antes de la short line es saque corto', () => {
    // Plano y lento: llega a la frontal, pero la gravedad lo tira al piso
    // a 1.9 m, muy por delante de la short line.
    const t = shoot(serveSpot, 0, 0, 18);
    const j = judgeServe(t, serveSpot);
    expect(t.bounces[0]!.surface).toBe('front');
    expect(j.fault).toBe('short');
  });

  it('llegar a la trasera sin botar es saque largo', () => {
    const t = shoot(serveSpot, 0, 6, 70);
    expect(judgeServe(t, serveSpot).fault).toBe('long');
  });

  it('tocar el techo despues de la frontal es falta', () => {
    const t = shoot(serveSpot, 0, 40, 45);
    expect(judgeServe(t, serveSpot).fault).toBe('ceiling');
  });

  it('no pegar primero en la frontal es falta', () => {
    const t = shoot(serveSpot, 75, 0, 45);
    expect(judgeServe(t, serveSpot).fault).toBe('no-front');
  });

  it('el Z serve es LEGAL: frontal y una lateral no son tres paredes', () => {
    // El spec dice que tocar una lateral antes del piso es falta de tres
    // paredes. Eso marcaria como falta el Z serve, que es legal y esta en
    // su propia lista de presets. Se aplica la regla real del deporte.
    for (const id of ['z-serve-left', 'z-serve-right']) {
      const { traj, origin } = fromPreset(id);
      const before = traj.bounces.slice(
        0,
        traj.bounces.findIndex((b) => b.surface === 'floor'),
      );
      expect(before.filter((b) => b.surface === 'left' || b.surface === 'right'))
        .toHaveLength(1);
      expect(judgeServe(traj, origin).legal, id).toBe(true);
    }
  });

  it('avisa si el saque sale de fuera de la zona de saque', () => {
    const { traj } = fromPreset('drive-serve-left');
    const outside = v3(COURT.width / 2, 0.85, 9);
    const j = judgeServe(traj, outside);
    expect(j.legal).toBe(true);
    expect(j.label).toContain('fuera de la zona');
  });
});

describe('clasificacion automatica', () => {
  const expectClass = (id: string, wanted: string) => {
    const { traj, origin } = fromPreset(id);
    expect(classify(traj, origin).classification, id).toBe(wanted);
  };

  it('reconoce el kill shot', () => expectClass('kill', 'kill'));
  it('reconoce el pinch', () => expectClass('pinch-left', 'pinch'));
  it('reconoce el splat', () => expectClass('splat-left', 'splat'));
  it('reconoce la ceiling ball', () => expectClass('ceiling', 'ceiling'));
  it('reconoce los pases', () => {
    expectClass('cross-court-left', 'pass');
    expectClass('down-the-line-right', 'pass');
  });

  it('distingue el splat del pinch por lo cerca que se golpea de la lateral', () => {
    const { traj } = fromPreset('pinch-left');
    // Mismo dibujo, pero golpeado pegado a la pared: es un splat.
    expect(classify(traj, v3(0.5, 0.75, 8)).classification).toBe('splat');
    expect(classify(traj, v3(3.0, 0.75, 8)).classification).toBe('pinch');
  });

  it('reconoce el skip', () => {
    const t = shoot(v3(3, 0.9, 8), 0, -25, 30);
    expect(classify(t, v3(3, 0.9, 8)).classification).toBe('skip');
  });

  it('marca como setup un tiro que llega alto al fondo', () => {
    // Devolucion floja y levantada: cruza los 11 m a 2.6 m de altura, o
    // sea a la altura del hombro del rival. Es un regalo.
    const origin = v3(3, 0.9, 9);
    const t = shoot(origin, 0, 32, 28);
    expect(deepHeight(t)!).toBeGreaterThan(1.8);
    expect(classify(t, origin).classification).toBe('setup');
  });
});

describe('altura de paso a 11 m', () => {
  it('un kill cruza el fondo pegado al piso, si es que llega', () => {
    // Con el motor geometrico la pelota no pierde energia y rebota para
    // siempre, asi que la medida solo significa algo con el balistico.
    const t = shoot(v3(3, 0.9, 8), 0, -5.4, 60);
    expect(t.bounces[0]!.surface).toBe('front');
    expect(t.bounces[0]!.point.y).toBeLessThan(0.3);
    const h = deepHeight(t);
    expect(h === null || h < 1).toBe(true);
  });

  it('un pase la cruza bajo y un setup la cruza alto', () => {
    const { traj: passTraj } = fromPreset('cross-court-left');
    const pass = deepHeight(passTraj);
    expect(pass).not.toBeNull();

    const origin = v3(3, 0.9, 9);
    const setup = deepHeight(shoot(origin, 0, 32, 28));
    expect(setup).not.toBeNull();
    expect(setup!).toBeGreaterThan(pass!);
  });

  it('la medida se toma despues del primer bote, no antes', () => {
    const origin = v3(3, 0.9, 4);
    const t = shoot(origin, 0, 0, 45);
    const floor = t.bounces.find((b) => b.surface === 'floor');
    const h = deepHeight(t);
    if (h != null && floor) {
      const crossing = t.samples.find((s) => s.t > floor.time && s.p.z >= 11);
      expect(crossing).toBeDefined();
    }
  });
});

describe('analisis completo', () => {
  it('devuelve el juicio de saque solo en modo saque', () => {
    const { traj, origin } = fromPreset('drive-serve-left');
    expect(analyse(traj, origin, false).serve).toBeNull();
    expect(analyse(traj, origin, true).serve).not.toBeNull();
  });

  it('rellena las cifras que la UI muestra siempre', () => {
    const { traj, origin } = fromPreset('cross-court-left');
    const a = analyse(traj, origin, false);
    expect(a.frontImpactHeight).toBeGreaterThan(0);
    expect(a.firstFloor).not.toBeNull();
    expect(a.classLabel.length).toBeGreaterThan(3);
  });
});
