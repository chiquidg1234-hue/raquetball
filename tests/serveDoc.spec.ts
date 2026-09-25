import { describe, expect, it } from 'vitest';

import { TOSS_DEFAULTS, TOSS_DROP } from '../src/core/serveToss.js';
import { decodeDoc, encodeDoc } from '../src/persist/share.js';
import { applyDoc, currentDoc, state, update } from '../src/ui/state.js';

describe('el saque viaja entero en el enlace', () => {
  it('el lanzamiento y el sitio de la mano vuelven igual, y el golpe cae en el mismo sitio', () => {
    update({
      serveMode: true,
      origin: { x: 2.2, y: 0.9, z: 5.4 },
      serveToss: { ...TOSS_DEFAULTS, throwSpeed: 2.2, throwAzimuthDeg: 20, throwDownDeg: 35 },
    });
    const strike = { ...state.shot.origin };
    const doc = decodeDoc(encodeDoc(currentDoc()))!;
    expect(doc.serve!.x).toBe(2.2);
    expect(doc.serve!.s).toBe(2.2);

    // Otro estado cualquiera, y se abre el enlace.
    update({ serveMode: false, origin: { x: 4, y: 1, z: 8 } });
    expect(applyDoc(doc)).toBe(true);
    expect(state.serveToss.throwSpeed).toBe(2.2);
    expect(state.serveToss.throwAzimuthDeg).toBe(20);
    expect(state.origin.x).toBe(2.2);
    expect(state.shot.origin.x).toBeCloseTo(strike.x, 9);
    expect(state.shot.origin.y).toBeCloseTo(strike.y, 9);
    expect(state.shot.origin.z).toBeCloseTo(strike.z, 9);
  });

  it('un enlace de antes del lanzamiento abre como lo que era: soltarla', () => {
    const doc = currentDoc();
    doc.serve = { r: 1.2, p: 0.9 };
    expect(applyDoc(doc)).toBe(true);
    expect(state.serveToss.throwSpeed).toBe(TOSS_DROP.throwSpeed);
    expect(state.serveToss.releaseHeight).toBe(1.2);
  });
});
