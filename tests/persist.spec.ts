import { describe, expect, it } from 'vitest';

import { DOC_VERSION, fromShotDoc, isDoc, toShotDoc } from '../src/persist/schema.js';
import { decodeDoc, encodeDoc } from '../src/persist/share.js';
import { v3 } from '../src/core/vec3.js';

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
