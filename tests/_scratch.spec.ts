import { it } from 'vitest';
import { simulate } from '../src/core/engine.js';
import { presetById, resolvePreset } from '../src/core/presets.js';
import { readableSequence } from '../src/core/contacts.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';
it('jac', () => {
  const origin = v3(3.048, 0.9, 8.2);
  const pass = resolvePreset(presetById('cross-court-left')!, origin, { model: 'ballistic', physics: {} });
  const b3At = (az: number, el: number, v: number) => {
    const t = simulate({ origin, direction: fromAzimuthElevation(az, el), speed: v }, { model: 'ballistic', maxBounces: 12, stopAfterFloorBounces: 3, sampleDt: 1 / 60 });
    const b = t.bounces.filter((x) => x.surface === 'floor')[2];
    return b ? `(${b.point.x.toFixed(3)},${b.point.z.toFixed(3)}) ${readableSequence(t, 6)}` : 'none';
  };
  const az = -6.22, el = 3.07;
  console.log('base', b3At(az, el, 28));
  console.log('+az', b3At(az + 0.2, el, 28));
  console.log('+el', b3At(az, el + 0.2, 28));
  console.log('+v', b3At(az, el, 28.3));
  console.log('+v2', b3At(az, el, 30));
  console.log('+v3', b3At(az, el, 34));
  console.log('pass', pass.azimuthDeg, pass.elevationDeg);
});
