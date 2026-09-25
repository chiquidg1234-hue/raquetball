import { describe, expect, it } from 'vitest';

import { COURT, DEFAULT_CONTACT_HEIGHT } from '../src/core/constants.js';
import { CENTER_BOX } from '../src/core/court.js';
import { simulate } from '../src/core/engine.js';
import { presetById, resolvePreset } from '../src/core/presets.js';
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

describe('segundo y tercer bote de piso', () => {
  // Antes este test aceptaba que el solver no convergiera. Gael quiere
  // arrastrar el 2.º bote y que el tiro se recalcule: tiene que salir.
  const landsWithin = (target: AimTarget, speed: number, cm: number) => {
    const r = solveAim({ origin: STANCE, speed, model: 'ballistic' }, target);
    expect(r.ok, `${JSON.stringify(target)} a ${speed} m/s: ${r.note}`).toBe(true);
    const hit = landing(STANCE, r.azimuthDeg, r.elevationDeg, r.speed, 'ballistic', target.bounceIndex)!;
    expect(
      Math.hypot(hit.point.x - target.x, hit.point.z - target.z),
    ).toBeLessThan(cm / 100);
    return r;
  };

  it('coloca el 2.º bote a menos de 5 cm del punto pedido', () => {
    for (const [x, z] of [
      [3.0, 11.0],
      [0.6, 10.5],
      [5.5, 9.5],
      [1.8, 8.5],
    ] as const) {
      landsWithin({ x, z, bounceIndex: 2 }, 45, 5);
    }
  });

  it('resuelve a varias velocidades sin tocar la fuerza', () => {
    for (const speed of [30, 60]) {
      const r = landsWithin({ x: 4.3, z: 10.5, bounceIndex: 2 }, speed, 5);
      expect(r.speed).toBe(speed);
    }
  });

  it('tambien el 3.er bote', () => {
    landsWithin({ x: 3.05, z: 10.0, bounceIndex: 3 }, 45, 5);
    landsWithin({ x: 1.2, z: 8.0, bounceIndex: 3 }, 45, 5);
  });

  it('el punto de mira es donde la pelota pega de verdad en la frontal', () => {
    const target: AimTarget = { x: 2.0, z: 10.5, bounceIndex: 2 };
    const r = solveAim({ origin: STANCE, speed: 45, model: 'ballistic' }, target);
    const traj = simulate(
      { origin: STANCE, direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg), speed: r.speed },
      { model: 'ballistic' },
    );
    const front = traj.bounces.find((b) => b.surface === 'front')!;
    expect(r.aimPoint!.x).toBeCloseTo(front.point.x, 6);
    expect(r.aimPoint!.y).toBeCloseTo(front.point.y, 6);
  });
});

describe('continuidad al arrastrar un bote', () => {
  it('partiendo del tiro actual, un arrastre corto cambia el tiro poco', () => {
    // Tiro de partida y donde cae su 2.º bote.
    const az0 = -6.5;
    const el0 = 0.5;
    const b2 = landing(STANCE, az0, el0, 45, 'ballistic', 2)!;

    // Se arrastra ese bote medio metro.
    const target: AimTarget = { x: b2.point.x + 0.4, z: b2.point.z + 0.3, bounceIndex: 2 };
    const r = solveAim(
      { origin: STANCE, speed: 45, model: 'ballistic', seed: [az0, el0] },
      target,
    );
    expect(r.ok).toBe(true);
    expect(Math.abs(r.azimuthDeg - az0)).toBeLessThan(5);
    expect(Math.abs(r.elevationDeg - el0)).toBeLessThan(5);
  });

  it('arrastrar el 2.º bote al otro rincon no convierte un pase en un kill', () => {
    // El caso real que salio al probarlo en el navegador. Desde (3.05,
    // 0.9, 8.2) a 45 m/s hay varias familias de tiros que dejan el 2.º
    // bote en el rincon trasero derecho: un kill que bota a 1.2 m de la
    // frontal, un pase cruzado que bota a 6 m, un ceiling... Comparando
    // angulos ganaba el kill. Conservando los botes anteriores, el pase.
    const origin = v3(3.05, 0.9, 8.2);
    const b1Before = landing(origin, -6.5, 0.5, 45, 'ballistic', 1)!;
    const r = solveAim(
      {
        origin,
        speed: 45,
        model: 'ballistic',
        seed: [-6.5, 0.5],
        keepBounces: [{ x: b1Before.point.x, z: b1Before.point.z }],
      },
      { x: 4.6, z: 10.8, bounceIndex: 2 },
    );
    expect(r.ok, r.note).toBe(true);
    const b1After = landing(origin, r.azimuthDeg, r.elevationDeg, r.speed, 'ballistic', 1)!;
    // El 1.er bote no se va pegado a la frontal: sigue en media cancha.
    expect(b1After.point.z).toBeGreaterThan(4.5);
  });
});

describe('alternativas', () => {
  it('ofrece varias formas de dejar el 2.º bote, una por tipo de tiro', () => {
    const origin = v3(3.05, 0.9, 8.2);
    const b1 = landing(origin, -6.5, 0.5, 45, 'ballistic', 1)!;
    const r = solveAim(
      {
        origin,
        speed: 45,
        model: 'ballistic',
        seed: [-6.5, 0.5],
        keepBounces: [{ x: b1.point.x, z: b1.point.z }],
        firstSurface: 'front',
      },
      { x: 4.6, z: 10.8, bounceIndex: 2 },
    );
    const alts = r.alternatives ?? [];
    expect(alts.length).toBeGreaterThanOrEqual(2);
    expect(alts.length).toBeLessThanOrEqual(4);
    // Un tipo de tiro por opcion.
    expect(new Set(alts.map((a) => a.kindLabel)).size).toBe(alts.length);
    // La elegida es la primera, y todas dejan el bote donde se pidio.
    expect(alts[0]!.azimuthDeg).toBe(r.azimuthDeg);
    for (const a of alts) {
      const hit = landing(origin, a.azimuthDeg, a.elevationDeg, a.speed, 'ballistic', 2)!;
      expect(Math.hypot(hit.point.x - 4.6, hit.point.z - 10.8)).toBeLessThan(0.06);
    }
  });

  it('por defecto conserva que el tiro abra por la frontal', () => {
    // Antes se partia de un pase a 45 m/s. Con el efecto y el COR que baja
    // con la velocidad, ese tiro sube por la pared del fondo y vuelve: su
    // 2.o bote ya no esta en el fondo y el escenario no existe. Se parte
    // del pase cruzado de la biblioteca (28 m/s, frontal a 0.8 m), que da
    // el 2.o bote en el rincon izquierdo, y se arrastra al centro del fondo.
    const origin = v3(3.05, 0.9, 8.2);
    const pass = resolvePreset(presetById('cross-court-left')!, origin, {
      model: 'ballistic',
      physics: {},
    });
    const seed: [number, number] = [pass.azimuthDeg, pass.elevationDeg];
    const b1 = landing(origin, seed[0], seed[1], pass.speed, 'ballistic', 1)!;
    const r = solveAim(
      {
        origin,
        speed: pass.speed,
        model: 'ballistic',
        seed,
        keepBounces: [{ x: b1.point.x, z: b1.point.z }],
        firstSurface: 'front',
      },
      { x: 2.4, z: 11.0, bounceIndex: 2 },
    );
    expect(r.ok).toBe(true);
    expect(r.family!.startsWith('F')).toBe(true);
    expect(r.kindLabel).toBe('passing shot');
  });
});

describe('solo tiros legales', () => {
  const isLegal = (az: number, el: number, speed: number, origin = STANCE) => {
    const t = simulate(
      { origin, direction: fromAzimuthElevation(az, el), speed },
      { model: 'ballistic' },
    );
    const front = t.bounces.findIndex((b) => b.surface === 'front');
    const floor = t.bounces.findIndex((b) => b.surface === 'floor');
    return front !== -1 && (floor === -1 || front < floor);
  };

  it('un objetivo delante del jugador no se resuelve con un skip', () => {
    // Tirar al suelo delante de uno mismo seria la forma "facil" de poner
    // el 1.er bote ahi. Es un skip: el punto se pierde. No vale.
    const target: AimTarget = { x: 3.05, z: 6.0, bounceIndex: 1 };
    const r = solveAim({ origin: STANCE, speed: 45, model: 'ballistic' }, target);
    expect(isLegal(r.azimuthDeg, r.elevationDeg, r.speed)).toBe(true);
  });

  it('toda solucion del barrido de 2.º bote es legal', () => {
    for (const [x, z] of [
      [0.6, 7.5],
      [3.05, 9.5],
      [5.5, 11.5],
    ] as const) {
      const r = solveAim({ origin: STANCE, speed: 45, model: 'ballistic' }, { x, z, bounceIndex: 2 });
      expect(isLegal(r.azimuthDeg, r.elevationDeg, r.speed), `${x},${z}`).toBe(true);
    }
  });
});

describe('parada temprana del motor', () => {
  it('stopAfterFloorBounces corta en el bote pedido sin mover ese bote', () => {
    const shot = { origin: STANCE, direction: fromAzimuthElevation(10, 6), speed: 45 };
    const full = simulate(shot, { model: 'ballistic' });
    const cut = simulate(shot, { model: 'ballistic', stopAfterFloorBounces: 2 });
    const floorsCut = cut.bounces.filter((b) => b.surface === 'floor');
    const floorsFull = full.bounces.filter((b) => b.surface === 'floor');
    expect(floorsCut).toHaveLength(2);
    expect(floorsCut[1]!.point.x).toBe(floorsFull[1]!.point.x);
    expect(floorsCut[1]!.point.z).toBe(floorsFull[1]!.point.z);
    expect(cut.totalTime).toBeLessThan(full.totalTime);
  });
});
