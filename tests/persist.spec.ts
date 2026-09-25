import { describe, expect, it } from 'vitest';

import {
  DOC_VERSION,
  fromShotDoc,
  fromVenueDoc,
  isDoc,
  toDoc,
  toShotDoc,
  toVenueDoc,
} from '../src/persist/schema.js';
import { decodeDoc, encodeDoc } from '../src/persist/share.js';
import { v3 } from '../src/core/vec3.js';
import { DEFAULT_VENUE, withBall, withPlace, withWalls } from '../src/core/venue.js';

const sample = {
  origin: v3(2.137, 0.912, 8.421),
  azimuthDeg: -23.5,
  elevationDeg: 7.25,
  speed: 62,
  model: 'ballistic' as const,
};

describe('formato de documento', () => {
  it('ida y vuelta conserva el tiro con 3 decimales', () => {
    const back = fromShotDoc(toShotDoc(sample))!;
    expect(back.origin.x).toBeCloseTo(sample.origin.x, 3);
    expect(back.origin.y).toBeCloseTo(sample.origin.y, 3);
    expect(back.origin.z).toBeCloseTo(sample.origin.z, 3);
    expect(back.azimuthDeg).toBeCloseTo(sample.azimuthDeg, 3);
    expect(back.elevationDeg).toBeCloseTo(sample.elevationDeg, 3);
    expect(back.speed).toBe(62);
    expect(back.model).toBe('ballistic');
  });

  it('nunca lanza con basura de fuera', () => {
    for (const junk of [null, undefined, 0, 'x', {}, { o: 'no' }, { o: [1, 2] }]) {
      expect(() => fromShotDoc(junk)).not.toThrow();
      expect(fromShotDoc(junk)).toBeNull();
    }
  });

  it('rellena huecos en vez de romperse', () => {
    const partial = fromShotDoc({ o: [1, 2, 3] })!;
    expect(partial.speed).toBe(45);
    expect(partial.model).toBe('geometric');
  });

  it('isDoc rechaza versiones que no conoce', () => {
    expect(isDoc({ v: DOC_VERSION, shot: toShotDoc(sample) })).toBe(true);
    expect(isDoc({ v: 99, shot: toShotDoc(sample) })).toBe(false);
    expect(isDoc({ v: DOC_VERSION })).toBe(false);
  });
});

describe('compartir por URL', () => {
  it('comprimir y descomprimir devuelve el mismo documento', () => {
    const doc = { v: DOC_VERSION, shot: toShotDoc(sample) } as const;
    const decoded = decodeDoc(encodeDoc(doc));
    expect(decoded).toEqual(doc);
  });

  it('el payload cabe de sobra en una URL', () => {
    const encoded = encodeDoc({ v: DOC_VERSION, shot: toShotDoc(sample) });
    // Los navegadores aguantan mucho mas, pero por debajo de 2000 el
    // enlace funciona hasta pegado en un chat.
    expect(encoded.length).toBeLessThan(200);
  });

  it('el payload es seguro dentro de un hash', () => {
    const encoded = encodeDoc({ v: DOC_VERSION, shot: toShotDoc(sample) });
    expect(encoded).toBe(encodeURIComponent(encoded));
  });

  it('un payload corrupto devuelve null en vez de romper la app', () => {
    for (const junk of ['', 'no-es-lz-string', 'AAAA', '%%%']) {
      expect(decodeDoc(junk)).toBeNull();
    }
  });
});

describe('documento v2: la cancha viaja con el tiro', () => {
  const venue = {
    ...withWalls(withBall(withPlace(DEFAULT_VENUE, 'elalto'), 'gearbox-black'), 'glass'),
    temperatureC: 9,
    pressureHpa: 628,
    wallFriction: 0.58,
    ballStiffnessKpa: 60,
  };

  it('la version actual es la 2', () => {
    expect(DOC_VERSION).toBe(2);
  });

  it('ida y vuelta conserva la cancha entera', () => {
    expect(fromVenueDoc(toVenueDoc(venue))).toEqual(venue);
  });

  it('un enlace de antes del efecto se abre: su "restitucion tangencial" se ignora', () => {
    // Los v2 de antes traian wt/ft (0.3-0.95). No hay forma honesta de
    // convertirla en friccion, asi que se usa la de la superficie.
    const old = { ...toVenueDoc(venue), wt: 0.4, ft: 0.5 } as Record<string, unknown>;
    delete old.wm;
    delete old.fm;
    delete old.e;
    const back = fromVenueDoc(old);
    expect(back.wallFriction).toBe(DEFAULT_VENUE.wallFriction);
    expect(back.floorFriction).toBe(DEFAULT_VENUE.floorFriction);
    expect(back.ballStiffnessKpa).toBe(DEFAULT_VENUE.ballStiffnessKpa);
    expect(back.place).toBe('elalto');
  });

  it('por URL tambien', () => {
    const doc = toDoc({ ...sample, venue });
    const decoded = decodeDoc(encodeDoc(doc))!;
    expect(decoded.v).toBe(2);
    expect(fromVenueDoc(decoded.venue)).toEqual(venue);
    // Con la cancha dentro sigue cabiendo en cualquier chat.
    expect(encodeDoc(doc).length).toBeLessThan(400);
  });

  it('un enlace v1 se sigue abriendo, con la cancha de referencia', () => {
    const v1 = { v: 1, shot: toShotDoc(sample) };
    expect(isDoc(v1)).toBe(true);
    const decoded = decodeDoc(encodeDoc(v1 as never))!;
    expect(fromShotDoc(decoded.shot)!.speed).toBe(62);
    expect(fromVenueDoc(decoded.venue)).toEqual(DEFAULT_VENUE);
  });

  it('una cancha con basura se repara, no rompe', () => {
    const repaired = fromVenueDoc({ p: 'marte', h: 'alto', t: 500, b: 7, w: 'papel' });
    expect(repaired.place).toBe(DEFAULT_VENUE.place);
    expect(repaired.temperatureC).toBe(40);
    expect(repaired.ball).toBe(DEFAULT_VENUE.ball);
    expect(repaired.walls).toBe(DEFAULT_VENUE.walls);
  });
});
