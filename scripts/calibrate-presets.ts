/**
 * Banco de calibracion de presets.
 *
 * El spec avisa de que ajustar los angulos de los presets es trabajo
 * iterativo y empirico, y de que se come el calendario. Se come menos si
 * en vez de mirar el dibujo se mide: esto imprime, para cada preset, la
 * secuencia de superficies, donde cae el primer bote en el piso y como
 * termina. Con eso el ajuste es leer una tabla, no entrecerrar los ojos.
 */

import { COURT, DEFAULT_CONTACT_HEIGHT } from '../src/core/constants.js';
import { simulate } from '../src/core/engine.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import { fromAzimuthElevation } from '../src/core/vec3.js';

const STANCE = {
  x: COURT.width / 2,
  y: DEFAULT_CONTACT_HEIGHT,
  z: COURT.length * 0.68,
};

const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n);
const num = (v: number, n = 5): string => v.toFixed(2).padStart(n);

console.log(
  pad('preset', 24),
  pad('motor', 6),
  pad('secuencia', 32),
  pad('1er bote piso', 14),
  pad('2o bote', 10),
  'fin',
);
console.log('-'.repeat(108));

let problems = 0;

for (const preset of PRESETS) {
  const r = resolvePreset(preset, STANCE);
  // Cada preset se mide con el motor con el que tiene sentido: los tiros
  // con arco solo son fieles con gravedad.
  const model = preset.prefersBallistic ? 'ballistic' : 'geometric';
  const traj = simulate(
    {
      origin: r.origin,
      direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
      speed: r.speed,
    },
    { model, maxBounces: 8 },
  );

  const sequence = traj.bounces.map((b) => b.surface);
  const floors = traj.bounces.filter((b) => b.surface === 'floor');
  const first = floors[0];
  const second = floors[1];

  const expected = preset.expect;
  const ok =
    !expected ||
    expected.every((s, i) => sequence[i] === s);
  if (!ok) problems++;

  console.log(
    pad(preset.id, 24),
    pad(model === 'ballistic' ? 'bal' : 'geo', 6),
    pad(sequence.slice(0, 5).join(' > '), 32),
    pad(first ? `z=${num(first.point.z)} x=${num(first.point.x)}` : '-', 14),
    pad(second ? `z=${num(second.point.z)}` : '-', 10),
    traj.terminated,
    ok ? '' : `  <-- esperaba ${expected!.join(' > ')}`,
  );
}

console.log('-'.repeat(95));
console.log(
  problems === 0
    ? 'Todos los presets producen la secuencia de superficies esperada.'
    : `${problems} preset(s) no producen la secuencia esperada.`,
);
