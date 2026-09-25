import { describe, expect, it } from 'vitest';

import { COURT, DEFAULT_CONTACT_HEIGHT, SERVICE_ZONE } from '../src/core/constants.js';
import { floorBounces } from '../src/core/contacts.js';
import { simulate } from '../src/core/engine.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import type { Trajectory } from '../src/core/types.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';
import { DEFAULT_VENUE, venueSimOptions, withPlace } from '../src/core/venue.js';

const STANCE = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, COURT.length * 0.68);
const PHYSICS = venueSimOptions(DEFAULT_VENUE);

/**
 * Como lo carga la app: los que piden el motor balistico se resuelven con
 * la fisica (el primer contacto cae de verdad en el punto de mira) y se
 * simulan con el aire y la cancha de referencia.
 */
const run = (id: string, stance = STANCE, physics = PHYSICS): Trajectory => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const model = preset.prefersBallistic ? 'ballistic' : 'geometric';
  const r = resolvePreset(preset, stance, { model, physics });
  return simulate(
    {
      origin: r.origin,
      direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
      speed: r.speed,
    },
    { model, maxBounces: 8, ...(model === 'ballistic' ? physics : {}) },
  );
};

/** El mismo preset con el motor balistico, aunque no lo pida. */
const runBallistic = (id: string, stance = STANCE, physics = PHYSICS): Trajectory => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const r = resolvePreset(preset, stance, { model: 'ballistic', physics });
  expect(r.solved, `${id} resuelto con la fisica`).toBe(true);
  return simulate(
    {
      origin: r.origin,
      direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
      speed: r.speed,
    },
    { model: 'ballistic', maxBounces: 10, ...physics },
  );
};

/** Grados entre la salida de un contacto y la normal de esa pared (plano horizontal). */
const exitFromNormal = (t: Trajectory, index: number): number => {
  const b = t.bounces[index]!;
  const s = t.samples.find((q) => Math.abs(q.t - b.time) < 1e-12)!;
  return (Math.atan2(Math.abs(s.v.z), Math.abs(s.v.x)) * 180) / Math.PI;
};

const firstFloor = (t: Trajectory) => t.bounces.find((b) => b.surface === 'floor');

describe('catalogo de presets', () => {
  it('todos tienen texto de cuando usarlo y velocidad en rango', () => {
    for (const p of PRESETS) {
      expect(p.when.length, p.id).toBeGreaterThan(30);
      expect(p.speed, p.id).toBeGreaterThanOrEqual(10);
      expect(p.speed, p.id).toBeLessThanOrEqual(90);
    }
  });

  it('los identificadores son unicos', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada preset produce la secuencia de superficies que dice su nombre', () => {
    // Esta es la prueba que congela la calibracion: si alguien retoca un
    // angulo y el pinch deja de pegar primero en la lateral, salta aqui.
    for (const preset of PRESETS) {
      if (!preset.expect) continue;
      const seq = run(preset.id).bounces.map((b) => b.surface);
      preset.expect.forEach((surface, i) => {
        expect(seq[i], `${preset.id} rebote ${i + 1}`).toBe(surface);
      });
    }
  });
});

describe('los saques se tiran desde la zona de saque', () => {
  it('drive, Z y lob salen de entre la service line y la short line', () => {
    for (const preset of PRESETS.filter((p) => p.group === 'saque')) {
      const r = resolvePreset(preset, STANCE);
      expect(r.origin.z, preset.id).toBeGreaterThanOrEqual(SERVICE_ZONE.zMin);
      expect(r.origin.z, preset.id).toBeLessThanOrEqual(SERVICE_ZONE.zMax);
    }
  });

  it('el drive serve bota pasada la short line, que es lo que lo hace legal', () => {
    for (const id of ['drive-serve-left', 'drive-serve-right']) {
      const floor = firstFloor(run(id))!;
      expect(floor.point.z, id).toBeGreaterThan(COURT.shortLine);
    }
  });

  it('el lob serve bota pasada la receiving line: muere en el fondo', () => {
    for (const id of ['lob-serve-left', 'lob-serve-right']) {
      const floor = firstFloor(run(id))!;
      expect(floor.point.z, id).toBeGreaterThan(COURT.receivingLine);
    }
  });

  it('el Z serve cruza al lado contrario del que sale', () => {
    const floorLeft = firstFloor(run('z-serve-left'))!;
    const floorRight = firstFloor(run('z-serve-right'))!;
    expect(floorLeft.point.x).toBeGreaterThan(COURT.width / 2);
    expect(floorRight.point.x).toBeLessThan(COURT.width / 2);
  });
});

describe('el efecto que describe Gael, en los presets (INVESTIGACION 7)', () => {
  it('Z serve: bota al fondo pegado a la otra lateral y sale casi paralelo a la trasera', () => {
    for (const [id, second] of [
      ['z-serve-right', 'left'],
      ['z-serve-left', 'right'],
    ] as const) {
      const t = run(id);
      const i = t.bounces.findIndex((b, k) => k > 1 && b.surface === second);
      expect(i, id).toBeGreaterThan(1);
      const b1 = floorBounces(t)[0]!;
      expect(b1.point.z, id).toBeGreaterThan(9);
      // Pegado a la otra lateral (a menos de 1 m).
      expect(Math.min(b1.point.x, COURT.width - b1.point.x), id).toBeLessThan(1);
      // Sale de la segunda lateral a menos de 12 grados de su normal: casi
      // paralelo a la pared del fondo. Sin efecto saldria a mas de 40.
      expect(exitFromNormal(t, i), id).toBeLessThan(12);
    }
  });

  it('Z serve sin efecto: la misma trayectoria no se endereza', () => {
    const preset = PRESETS.find((p) => p.id === 'z-serve-right')!;
    const r = resolvePreset(preset, STANCE, { model: 'ballistic', physics: PHYSICS });
    const t = simulate(
      { origin: r.origin, direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg), speed: r.speed },
      { model: 'ballistic', ...PHYSICS, disableSpin: true },
    );
    const i = t.bounces.findIndex((b, k) => k > 1 && (b.surface === 'left' || b.surface === 'right'));
    expect(exitFromNormal(t, i)).toBeGreaterThan(30);
  });

  it('Z-ball: cruza por el aire y sale de la otra lateral casi paralela a la trasera', () => {
    for (const [id, first, second] of [
      ['z-ball-right', 'right', 'left'],
      ['z-ball-left', 'left', 'right'],
    ] as const) {
      const t = run(id);
      expect(t.bounces.slice(0, 3).map((b) => b.surface), id).toEqual(['front', first, second]);
      expect(exitFromNormal(t, 2), id).toBeLessThan(16);
    }
  });
});

describe('los tiros al crack salen rodando (INVESTIGACION 8)', () => {
  for (const id of ['crack-serve-left', 'crack-serve-right', 'kill-crack']) {
    it(`${id}: toca en la franja, tau < 1, y sale rodando`, () => {
      const t = run(id);
      const crack = t.bounces.find((b) => b.rollout)!;
      expect(crack, id).toBeDefined();
      expect(crack.nickTau!).toBeLessThan(1);
      expect(crack.point.y).toBeGreaterThan(0.6 * 0.05715);
      expect(crack.point.y).toBeLessThan(0.75 * 0.05715);
      expect(floorBounces(t)[0]!.rolling).toBe(true);
    });
  }

  it('el saque al crack sale rodando pasada la linea corta: es legal y es ace', () => {
    for (const id of ['crack-serve-left', 'crack-serve-right']) {
      const b1 = floorBounces(run(id))[0]!;
      expect(b1.point.z, id).toBeGreaterThan(COURT.shortLine);
    }
  });

  it('en El Alto tambien: se apunta con el aire de alli', () => {
    const t = run('crack-serve-right', STANCE, venueSimOptions(withPlace(DEFAULT_VENUE, 'elalto')));
    expect(t.bounces.some((b) => b.rollout)).toBe(true);
  });
});

describe('con el motor balistico los presets llegan de verdad donde apuntan', () => {
  it('el kill toca la frontal a 15 cm, no mas abajo por la gravedad, y no es un nick', () => {
    const t = runBallistic('kill');
    expect(t.bounces[0]!.surface).toBe('front');
    expect(t.bounces[0]!.point.y).toBeCloseTo(0.15, 3);
    expect(t.bounces.some((b) => b.rollout)).toBe(false);
  });

  it('el drive serve bota pasada la linea corta', () => {
    for (const id of ['drive-serve-left', 'drive-serve-right']) {
      expect(floorBounces(runBallistic(id))[0]!.point.z, id).toBeGreaterThan(COURT.shortLine);
    }
  });

  it('el pase cruzado da el segundo bote antes de la pared del fondo', () => {
    for (const id of ['cross-court-left', 'cross-court-right']) {
      const t = runBallistic(id);
      const b2 = floorBounces(t)[1]!;
      const back = t.bounces.findIndex((b) => b.surface === 'back');
      expect(back === -1 || t.bounces[back]!.time > b2.time, id).toBe(true);
      expect(b2.point.z, id).toBeGreaterThan(COURT.receivingLine);
    }
  });

  it('la ceiling ball no se va por encima de la pared del fondo', () => {
    for (const stance of [STANCE, v3(2, 0.9, 10.5), v3(4.5, 1.0, 9)]) {
      const t = run('ceiling', stance);
      expect(t.terminated).not.toBe('exitedCourt');
    }
  });
});

describe('los tiros de ataque mueren cerca de la pared frontal', () => {
  it('el kill shot pega muy bajo en la frontal', () => {
    const front = run('kill').bounces[0]!;
    expect(front.surface).toBe('front');
    expect(front.point.y).toBeLessThan(0.35);
  });

  it('el kill shot bota antes de la short line', () => {
    expect(firstFloor(run('kill'))!.point.z).toBeLessThan(COURT.shortLine);
  });

  it('el pinch pega en la lateral antes que en la frontal', () => {
    for (const [id, wall] of [
      ['pinch-left', 'left'],
      ['pinch-right', 'right'],
    ] as const) {
      const seq = run(id).bounces.map((b) => b.surface);
      expect(seq[0], id).toBe(wall);
      expect(seq[1], id).toBe('front');
    }
  });

  it('el splat se tira pegado a la lateral: es lo que lo distingue del pinch', () => {
    const left = resolvePreset(PRESETS.find((p) => p.id === 'splat-left')!, STANCE);
    const right = resolvePreset(PRESETS.find((p) => p.id === 'splat-right')!, STANCE);
    expect(left.origin.x).toBeLessThan(1.0);
    expect(right.origin.x).toBeGreaterThan(COURT.width - 1.0);
  });
});

describe('los pases botan profundo', () => {
  it('cross-court y down-the-line botan pasada la short line', () => {
    for (const id of [
      'cross-court-left',
      'cross-court-right',
      'down-the-line-left',
      'down-the-line-right',
    ]) {
      expect(firstFloor(run(id))!.point.z, id).toBeGreaterThan(COURT.shortLine);
    }
  });

  it('el cross-court cruza y el down-the-line no', () => {
    // Saliendo del centro-derecha, el cross-court a izquierda debe acabar
    // en la mitad izquierda.
    const stance = v3(COURT.width * 0.7, DEFAULT_CONTACT_HEIGHT, 8.5);
    const cross = firstFloor(run('cross-court-left', stance))!;
    expect(cross.point.x).toBeLessThan(COURT.width / 2);

    const line = firstFloor(run('down-the-line-right', stance))!;
    expect(line.point.x).toBeGreaterThan(COURT.width / 2);
  });
});

describe('los tiros defensivos usan la altura', () => {
  it('la ceiling ball pega primero en el techo', () => {
    expect(run('ceiling').bounces[0]!.surface).toBe('ceiling');
  });

  it('la ceiling ball manda el segundo bote al fondo', () => {
    const floors = run('ceiling').bounces.filter((b) => b.surface === 'floor');
    expect(floors.length).toBeGreaterThanOrEqual(2);
    expect(floors[1]!.point.z).toBeGreaterThan(COURT.receivingLine);
  });

  it('la ceiling ball se tira desde el fondo', () => {
    const r = resolvePreset(PRESETS.find((p) => p.id === 'ceiling')!, v3(3, 0.9, 6));
    expect(r.origin.z).toBeGreaterThanOrEqual(9);
  });

  it('el around-the-world recorre lateral, frontal y lateral opuesta', () => {
    expect(run('around-the-world-left').bounces.slice(0, 3).map((b) => b.surface))
      .toEqual(['left', 'front', 'right']);
    expect(run('around-the-world-right').bounces.slice(0, 3).map((b) => b.surface))
      .toEqual(['right', 'front', 'left']);
  });
});
