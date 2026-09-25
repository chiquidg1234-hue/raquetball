import { describe, expect, it } from 'vitest';

import { BALL, DRAG_K } from '../src/core/constants.js';
import { floorBounces } from '../src/core/contacts.js';
import { simulate } from '../src/core/engine.js';
import { solveAim } from '../src/core/solve.js';
import { SPIN } from '../src/core/spin.js';
import { FLOOR_MATERIALS, WALL_MATERIALS } from '../src/core/surfaces.js';
import type { Trajectory } from '../src/core/types.js';
import {
  DEFAULT_VENUE,
  PLACES,
  normalizeVenue,
  venueAir,
  venueBallCor,
  venueSimOptions,
  withBall,
  withFloor,
  withPlace,
  withWalls,
  type Venue,
} from '../src/core/venue.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const drive = (venue: Venue, speed = 55, elevationDeg = 3): Trajectory =>
  simulate(
    {
      origin: v3(3.048, 0.9, 8),
      direction: fromAzimuthElevation(0, elevationDeg),
      speed,
    },
    { model: 'ballistic', ...venueSimOptions(venue) },
  );

const santaCruz = withPlace(DEFAULT_VENUE, 'scz');
const elAlto = withPlace(DEFAULT_VENUE, 'elalto');

describe('el mismo tiro en Santa Cruz y en El Alto (test obligatorio)', () => {
  const low = drive(santaCruz);
  const high = drive(elAlto);
  const frontLow = low.bounces[0]!;
  const frontHigh = high.bounces[0]!;

  it('las dos pegan primero en la frontal', () => {
    expect(frontLow.surface).toBe('front');
    expect(frontHigh.surface).toBe('front');
  });

  it('en El Alto llega a la frontal mas rapido: +4 a +8 %', () => {
    const ratio = frontHigh.incomingSpeed / frontLow.incomingSpeed;
    expect(ratio).toBeGreaterThan(1.04);
    expect(ratio).toBeLessThan(1.08);
    // 55 m/s desde 8 m: 47.4 m/s en Santa Cruz, 50.1 en El Alto.
    expect(frontLow.incomingSpeed).toBeCloseTo(47.4, 0);
    expect(frontHigh.incomingSpeed).toBeCloseTo(50.1, 0);
  });

  it('en El Alto pierde un 35 % menos de velocidad hasta la frontal', () => {
    const lostLow = 55 - frontLow.incomingSpeed;
    const lostHigh = 55 - frontHigh.incomingSpeed;
    const ratio = lostHigh / lostLow;
    // El arrastre es proporcional a rho: El Alto/Santa Cruz = 0.627.
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.72);
  });

  it('y llega antes: la frontal, un 2-4 % antes', () => {
    const ratio = frontHigh.time / frontLow.time;
    expect(ratio).toBeGreaterThan(0.96);
    expect(ratio).toBeLessThan(0.98);
  });

  it('el primer bote llega mas vivo y mas cerca de la frontal', () => {
    const b1Low = floorBounces(low)[0]!;
    const b1High = floorBounces(high)[0]!;
    // Con el COR constante (antes) salia de la frontal a 41 m/s y el bote
    // caia a 3.9 m (Santa Cruz) y 1.5 m (El Alto). Con el COR que baja con
    // la velocidad del impacto (constants.ts, COR_SPEED) sale a 28.7 y 30.4
    // m/s, pasa por la trasera, y el 1.er bote es de 16.8 m/s a 9.9 m en
    // Santa Cruz y de 18.6 m/s a 8.6 m en El Alto. La diferencia sigue
    // siendo la misma: en El Alto llega mas vivo y antes.
    expect(b1High.incomingSpeed / b1Low.incomingSpeed).toBeGreaterThan(1.08);
    expect(b1Low.point.z - b1High.point.z).toBeGreaterThan(1.0);
  });

  it('la k de El Alto es un 37 % menor que la de Santa Cruz', () => {
    expect(venueAir(elAlto).dragK / venueAir(santaCruz).dragK).toBeCloseTo(0.627, 2);
  });
});

describe('sitio de juego', () => {
  it('el sitio por defecto es exactamente el motor de siempre', () => {
    const opts = venueSimOptions(DEFAULT_VENUE);
    expect(opts.dragK).toBe(DRAG_K);
    expect(venueBallCor(DEFAULT_VENUE)).toBeCloseTo(BALL.restitution, 12);
    const a = drive(DEFAULT_VENUE);
    const b = simulate(
      { origin: v3(3.048, 0.9, 8), direction: fromAzimuthElevation(0, 3), speed: 55 },
      { model: 'ballistic' },
    );
    expect(a.bounces.map((x) => x.point)).toEqual(b.bounces.map((x) => x.point));
  });

  it('elegir ciudad fija su altitud', () => {
    for (const place of Object.values(PLACES)) {
      expect(withPlace(DEFAULT_VENUE, place.id).altitude).toBe(place.altitude);
    }
    const custom = withPlace({ ...DEFAULT_VENUE, altitude: 1234 }, 'custom');
    expect(custom.altitude).toBe(1234);
  });

  it('altitudes confirmadas con el INE (Tarija y Sucre corregidas)', () => {
    expect(PLACES.scz.altitude).toBe(416);
    expect(PLACES.tja.altitude).toBe(1866);
    expect(PLACES.cbba.altitude).toBe(2558);
    expect(PLACES.sucre.altitude).toBe(2790);
    expect(PLACES.lpz.altitude).toBe(3640);
    expect(PLACES.elalto.altitude).toBe(4150);
  });

  it('normalizeVenue repara lo que no entiende', () => {
    expect(normalizeVenue(null)).toEqual(DEFAULT_VENUE);
    const v = normalizeVenue({
      place: 'lpz',
      altitude: 12, // se ignora: la ciudad manda
      temperatureC: 99,
      ball: 'pelota-de-tenis',
      walls: 'glass',
      floor: 'moqueta',
      reboundIn: 80,
      pressureHpa: 'mucha',
    });
    expect(v.altitude).toBe(3640);
    expect(v.temperatureC).toBe(40);
    expect(v.ball).toBe(DEFAULT_VENUE.ball);
    expect(v.walls).toBe('glass');
    expect(v.floor).toBe(DEFAULT_VENUE.floor);
    expect(v.reboundIn).toBe(72);
    expect(v.pressureHpa).toBeNull();
  });

  it('la pelota mas viva devuelve mas en la pared', () => {
    const black = venueSimOptions(withBall(DEFAULT_VENUE, 'gearbox-black'));
    const blue = venueSimOptions(withBall(DEFAULT_VENUE, 'gearbox-blue'));
    expect(blue.surfaceRestitution!.front!).toBeGreaterThan(black.surfaceRestitution!.front!);
  });

  it('los materiales arrancan iguales: no hay medida publicada (INVESTIGACION 2 y 7)', () => {
    // Antes cada material traia una "restitucion tangencial" de 0.65 sin
    // fuente. Ahora traen la friccion mu, que es lo que decide el efecto, y
    // es la misma para todos: la unica medida es la de Illouz 2014.
    for (const m of [...Object.values(WALL_MATERIALS), ...Object.values(FLOOR_MATERIALS)]) {
      expect(m.corFactor).toBe(1);
      expect(m.friction).toBe(SPIN.friction);
    }
  });

  it('cambiar de material descarta la calibracion anterior', () => {
    const tuned = { ...DEFAULT_VENUE, wallCorFactor: 1.05, floorFriction: 0.5 };
    expect(withWalls(tuned, 'glass').wallCorFactor).toBe(1);
    expect(withFloor(tuned, 'concrete').floorFriction).toBe(SPIN.friction);
  });

  it('calibrar el piso cambia solo el piso', () => {
    const opts = venueSimOptions({ ...DEFAULT_VENUE, floorCorFactor: 0.9, floorFriction: 0.5 });
    expect(opts.surfaceRestitution!.floor!).toBeCloseTo(BALL.restitution * 0.9, 12);
    expect(opts.surfaceRestitution!.front!).toBeCloseTo(BALL.restitution, 12);
    expect(opts.surfaceFriction!.floor).toBe(0.5);
    expect(opts.surfaceFriction!.left).toBe(SPIN.friction);
  });

  it('la rigidez de la pelota llega al motor en pascales', () => {
    expect(venueSimOptions(DEFAULT_VENUE).ballStiffness).toBe(SPIN.stiffness);
    expect(venueSimOptions({ ...DEFAULT_VENUE, ballStiffnessKpa: 80 }).ballStiffness).toBe(80e3);
  });

  it('el aire caliente frena menos que el frio', () => {
    const cold = drive({ ...elAlto, temperatureC: 0 });
    const warm = drive({ ...elAlto, temperatureC: 35 });
    expect(warm.bounces[0]!.incomingSpeed).toBeGreaterThan(cold.bounces[0]!.incomingSpeed);
  });
});

describe('el solver apunta con el aire del sitio de juego', () => {
  it('el mismo bote pide otro angulo en El Alto, y cae donde se pide', () => {
    const target = { x: 1.2, z: 9.5, bounceIndex: 1 as const };
    const base = { origin: v3(3.048, 0.9, 7.5), speed: 40, model: 'ballistic' as const };
    const atSea = solveAim({ ...base, physics: venueSimOptions(DEFAULT_VENUE) }, target);
    const atAltitude = solveAim({ ...base, physics: venueSimOptions(elAlto) }, target);
    expect(atSea.ok).toBe(true);
    expect(atAltitude.ok).toBe(true);
    expect(
      Math.abs(atSea.elevationDeg - atAltitude.elevationDeg) +
        Math.abs(atSea.azimuthDeg - atAltitude.azimuthDeg),
    ).toBeGreaterThan(0.2);

    // Comprobacion independiente: simular la solucion con el aire de El
    // Alto deja el bote donde se pidio.
    const check = simulate(
      {
        origin: base.origin,
        direction: fromAzimuthElevation(atAltitude.azimuthDeg, atAltitude.elevationDeg),
        speed: atAltitude.speed,
      },
      { model: 'ballistic', ...venueSimOptions(elAlto) },
    );
    const b1 = floorBounces(check)[0]!;
    expect(Math.hypot(b1.point.x - target.x, b1.point.z - target.z)).toBeLessThan(0.05);
  });
});
