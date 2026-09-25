import { describe, expect, it } from 'vitest';

import { BALL } from '../src/core/constants.js';
import { RACQUET, STANCE, handleSide, strokeGeometry } from '../src/core/stroke.js';
import type { Vec3 } from '../src/core/types.js';
import { fromAzimuthElevation, v3 } from '../src/core/vec3.js';

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

const contact = v3(3, 0.72, 5.3);
const straight = fromAzimuthElevation(0, 6);

describe('la raqueta en el golpe', () => {
  it('la cara del cordaje mira hacia donde sale la pelota', () => {
    const g = strokeGeometry(contact, straight, 'forehand', 'right');
    expect(dot(g.faceNormal, straight)).toBeCloseTo(1, 12);
    // El cordaje toca la pelota por detras: un radio atras del centro.
    expect(len(sub(contact, g.stringsCenter))).toBeCloseTo(BALL.radius, 12);
    expect(dot(sub(contact, g.stringsCenter), straight)).toBeGreaterThan(0);
  });

  it('el mango es horizontal y esta en el plano de la cara', () => {
    for (const az of [-40, 0, 25]) {
      const d = fromAzimuthElevation(az, 12);
      const g = strokeGeometry(contact, d, 'backhand', 'right');
      expect(g.handleDir.y).toBeCloseTo(0, 12);
      expect(dot(g.handleDir, d)).toBeCloseTo(0, 12);
    }
  });

  it('mide lo que permite el reglamento: 22 in de punta a punta', () => {
    const g = strokeGeometry(contact, straight, 'forehand', 'right');
    const tipToGrip = len(sub(g.gripEnd, g.stringsCenter)) + RACQUET.headLength / 2;
    expect(tipToGrip).toBeCloseTo(22 * 0.0254, 9);
  });

  it('diestro: derecha con el cuerpo a la izquierda de la pelota, reves a la derecha', () => {
    expect(strokeGeometry(contact, straight, 'forehand', 'right').handleDir.x).toBeLessThan(-0.99);
    expect(strokeGeometry(contact, straight, 'backhand', 'right').handleDir.x).toBeGreaterThan(0.99);
  });

  it('zurdo: el espejo exacto', () => {
    expect(handleSide('forehand', 'left')).toBe(-handleSide('forehand', 'right'));
    expect(handleSide('backhand', 'left')).toBe(-handleSide('backhand', 'right'));
    const r = strokeGeometry(contact, straight, 'forehand', 'right');
    const l = strokeGeometry(contact, straight, 'forehand', 'left');
    expect(l.gripEnd.x - contact.x).toBeCloseTo(-(r.gripEnd.x - contact.x), 12);
  });
});

describe('donde se le pega respecto al pie adelantado (INVESTIGACION 6)', () => {
  const along = (p: Vec3, g: ReturnType<typeof strokeGeometry>) => {
    const flat = { x: g.faceNormal.x, y: 0, z: g.faceNormal.z };
    const l = Math.hypot(flat.x, flat.z);
    return dot(sub(g.contact, p), { x: flat.x / l, y: 0, z: flat.z / l });
  };

  it('derecha: la pelota a la altura del talon delantero', () => {
    const g = strokeGeometry(contact, straight, 'forehand', 'right');
    expect(along(g.frontFoot.heel, g)).toBeCloseTo(0, 9);
    expect(g.aheadOfFrontHeel).toBe(0);
  });

  it('reves: la pelota justo por delante de la punta del pie', () => {
    const g = strokeGeometry(contact, straight, 'backhand', 'right');
    const pastToe = along(g.frontFoot.toe, g);
    expect(pastToe).toBeGreaterThan(0);
    expect(pastToe).toBeLessThan(0.1);
  });

  it('el reves va MAS adelantado que la derecha, no menos', () => {
    const fh = strokeGeometry(contact, straight, 'forehand', 'right');
    const bh = strokeGeometry(contact, straight, 'backhand', 'right');
    expect(bh.aheadOfFrontHeel - fh.aheadOfFrontHeel).toBeGreaterThan(STANCE.footLength);
  });

  it('los pies van en el piso, del lado del cuerpo', () => {
    const g = strokeGeometry(contact, straight, 'forehand', 'right');
    expect(g.frontFoot.center.y).toBe(0);
    expect(g.backFoot.center.y).toBe(0);
    expect(g.frontFoot.center.x).toBeLessThan(contact.x);
  });
});

describe('va enganchada al tiro', () => {
  it('mover al jugador mueve la raqueta con el', () => {
    const a = strokeGeometry(contact, straight, 'forehand', 'right');
    const moved = v3(contact.x + 1.2, contact.y, contact.z - 0.5);
    const b = strokeGeometry(moved, straight, 'forehand', 'right');
    expect(b.gripEnd.x - a.gripEnd.x).toBeCloseTo(1.2, 12);
    expect(b.gripEnd.z - a.gripEnd.z).toBeCloseTo(-0.5, 12);
  });

  it('girar el tiro gira la raqueta', () => {
    const a = strokeGeometry(contact, fromAzimuthElevation(0, 5), 'forehand', 'right');
    const b = strokeGeometry(contact, fromAzimuthElevation(30, 5), 'forehand', 'right');
    const angle = (Math.acos(dot(a.handleDir, b.handleDir)) * 180) / Math.PI;
    expect(angle).toBeCloseTo(30, 6);
  });
});
