import { describe, expect, it } from 'vitest';

import { COURT, DEFAULT_CONTACT_HEIGHT, SERVICE_ZONE } from '../src/core/constants.js';
import { simulate } from '../src/core/engine.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import type { Trajectory } from '../src/core/types.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const STANCE = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, COURT.length * 0.68);

const run = (id: string, stance = STANCE): Trajectory => {
  const preset = PRESETS.find((p) => p.id === id)!;
  const r = resolvePreset(preset, stance);
  return simulate(
    {
      origin: r.origin,
      direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
      speed: r.speed,
    },
    { model: preset.prefersBallistic ? 'ballistic' : 'geometric', maxBounces: 8 },
  );
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

  it('el around-the-world recorre lateral, frontal y lateral opuesta', () => {
    expect(run('around-the-world-left').bounces.slice(0, 3).map((b) => b.surface))
      .toEqual(['left', 'front', 'right']);
    expect(run('around-the-world-right').bounces.slice(0, 3).map((b) => b.surface))
      .toEqual(['right', 'front', 'left']);
  });
});
