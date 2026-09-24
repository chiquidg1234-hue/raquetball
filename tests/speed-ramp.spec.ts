import { describe, expect, it } from 'vitest';

import { SPEED } from '../src/core/constants.js';
import { speedColor } from '../src/render3d/trajectoryMesh.js';

/** Saturacion aproximada: cuanto se separa el canal mayor del menor. */
const chroma = (c: { r: number; g: number; b: number }): number =>
  Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

describe('rampa de color por velocidad', () => {
  it('es una escala absoluta, no relativa al tiro', () => {
    // El mismo valor de m/s da el mismo color siempre.
    expect(speedColor(45).getHex()).toBe(speedColor(45).getHex());
  });

  it('no se desatura en la mitad del rango util', () => {
    // Una interpolacion directa azul -> naranja cae a gris justo aqui.
    for (const speed of [25, 35, 45, 55, 65]) {
      expect(chroma(speedColor(speed))).toBeGreaterThan(0.3);
    }
  });

  it('va de frio a calido segun sube la velocidad', () => {
    const slow = speedColor(12);
    const fast = speedColor(85);
    expect(slow.b).toBeGreaterThan(slow.r);
    expect(fast.r).toBeGreaterThan(fast.b);
  });

  it('satura fuera de rango en vez de salirse de la rampa', () => {
    expect(speedColor(-10).getHex()).toBe(speedColor(0).getHex());
    expect(speedColor(500).getHex()).toBe(speedColor(SPEED.max).getHex());
  });
});
