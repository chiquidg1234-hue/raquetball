import { describe, expect, it } from 'vitest';

import {
  AXS_170T,
  AXS_MODEL,
  COP_HAND,
  HALF_WIDTH,
  PIVOTS,
  RACQUET_MASS,
  centerOfPercussion,
  effectiveMass,
  exitPerOmega,
  headOutline,
  powerPoint,
  requiredHeadSpeed,
  sliceSpin,
  stringHalfWidth,
} from '../src/core/racquet.js';

const IN = 0.0254;
const headTop = AXS_170T.length - AXS_MODEL.frame;

describe('la Gearbox AXS 170 Teardrop, con lo que publica Gearbox', () => {
  it('mide 22 in y tiene 107 in^2 encordadas', () => {
    expect(AXS_170T.length).toBeCloseTo(22 * IN, 12);
    // El area de la lagrima, integrada aparte con otra rejilla.
    let area = 0;
    const n = 5000;
    const h = (headTop - AXS_MODEL.throat) / n;
    for (let i = 0; i < n; i++) area += 2 * stringHalfWidth(AXS_MODEL.throat + (i + 0.5) * h) * h;
    expect(area / (IN * IN)).toBeCloseTo(107, 0);
  });

  it('la cabeza sale de 25 cm de ancho, lo mas ancho en la parte de arriba (lagrima)', () => {
    expect(2 * HALF_WIDTH).toBeCloseTo(0.25, 2);
    let widest = 0;
    let at = 0;
    for (let s = AXS_MODEL.throat; s < headTop; s += 0.001) {
      if (stringHalfWidth(s) > widest) {
        widest = stringHalfWidth(s);
        at = s;
      }
    }
    expect((at - AXS_MODEL.throat) / (headTop - AXS_MODEL.throat)).toBeGreaterThan(0.55);
    expect(headOutline().length).toBeGreaterThan(100);
  });

  it('sin cordaje pesa 170 g con el balance publicado: 13 mm hacia la cabeza', () => {
    expect(RACQUET_MASS.handle + RACQUET_MASS.frame).toBeCloseTo(0.17, 12);
    expect(RACQUET_MASS.unstrungCm).toBeCloseTo(AXS_170T.length / 2 + 0.013, 9);
    // Y el reparto tiene sentido: un mango ligero y el marco en la cabeza.
    expect(RACQUET_MASS.handle).toBeGreaterThan(0.02);
    expect(RACQUET_MASS.handle).toBeLessThan(0.08);
  });

  it('encordada: 188 g, y las cuerdas suben el centro de masas', () => {
    expect(RACQUET_MASS.mass).toBeCloseTo(0.188, 12);
    expect(RACQUET_MASS.cm).toBeGreaterThan(RACQUET_MASS.unstrungCm);
    expect(RACQUET_MASS.iCm).toBeGreaterThan(0.003);
    expect(RACQUET_MASS.iCm).toBeLessThan(0.008);
  });
});

describe('donde pegarle: los puntos dulces, con fisica de impacto', () => {
  it('la masa efectiva es la masa entera en el centro de masas y cae hacia la punta', () => {
    expect(effectiveMass(RACQUET_MASS.cm)).toBeCloseTo(RACQUET_MASS.mass, 12);
    expect(effectiveMass(0.45)).toBeLessThan(effectiveMass(0.35));
    expect(effectiveMass(headTop) / RACQUET_MASS.mass).toBeLessThan(0.4);
  });

  it('en el centro de percusion la mano no recibe tiron', () => {
    // Un impulso J en s mueve el punto de la mano a J/M + J (s-cm)(p-cm)/I.
    // En el centro de percusion eso vale 0.
    const p = AXS_MODEL.handAt;
    const { mass: M, cm, iCm: I } = RACQUET_MASS;
    const handKick = (s: number) => 1 / M + ((s - cm) * (p - cm)) / I;
    expect(handKick(COP_HAND)).toBeCloseTo(0, 9);
    expect(Math.abs(handKick(headTop - 0.02))).toBeGreaterThan(1);
  });

  it('el centro de percusion queda en la parte alta de la cabeza: el "sweet spot mas alto" de la lagrima', () => {
    const mid = (AXS_MODEL.throat + headTop) / 2;
    expect(COP_HAND).toBeGreaterThan(mid);
    expect(COP_HAND).toBeLessThan(headTop - 0.05);
    expect(COP_HAND).toBeCloseTo(0.418, 2);
  });

  it('la muneca manda el punto de mas salida hacia la punta; el brazo entero, hacia el centro', () => {
    const wrist = powerPoint(PIVOTS.wrist);
    const arm = powerPoint(PIVOTS.arm);
    expect(wrist).toBeGreaterThan(arm);
    expect(wrist).toBeLessThan(headTop);
    expect(arm).toBeGreaterThan(AXS_MODEL.throat);
    // Y es de verdad un maximo.
    expect(exitPerOmega(wrist, PIVOTS.wrist)).toBeGreaterThan(exitPerOmega(wrist - 0.05, PIVOTS.wrist));
    expect(exitPerOmega(wrist, PIVOTS.wrist)).toBeGreaterThan(exitPerOmega(wrist + 0.05, PIVOTS.wrist));
  });

  it('un saque de 150 mph pide la raqueta a ~48 m/s en el centro de percusion (INVESTIGACION 10: ~50)', () => {
    const v = requiredHeadSpeed(150 * 0.44704, COP_HAND);
    expect(v).toBeGreaterThan(45);
    expect(v).toBeLessThan(52);
    // En la punta hace falta ir mas rapido: hay menos masa detras.
    expect(requiredHeadSpeed(67, headTop - 0.02)).toBeGreaterThan(v + 5);
  });

  it('el centro de percusion depende de donde gira el golpe', () => {
    expect(centerOfPercussion(PIVOTS.arm)).toBeLessThan(centerOfPercussion(PIVOTS.wrist));
  });
});

describe('el corte (slice) le da efecto a la pelota', () => {
  const toFront = { x: 0, y: 0, z: -1 };

  it('plano, sin efecto', () => {
    expect(sliceSpin(45, 0, toFront).rpm).toBe(0);
  });

  it('cortado a 20 grados a 45 m/s: ~2600 rpm de efecto hacia atras', () => {
    const r = sliceSpin(45, 20, toFront);
    expect(r.rpm).toBeGreaterThan(2300);
    expect(r.rpm).toBeLessThan(2900);
    expect(r.slipped).toBe(false);
    // Hacia la frontal (-z), el corte es w_x > 0: la parte de abajo de la
    // pelota va hacia delante (el mismo signo que ayuda al nick).
    expect(r.spin.x).toBeGreaterThan(0);
    expect(r.spin.y).toBeCloseTo(0, 12);
    expect(r.spin.z).toBeCloseTo(0, 12);
  });

  it('liftado, al reves', () => {
    expect(sliceSpin(45, -20, toFront).spin.x).toBeLessThan(0);
  });

  it('mas corte, mas efecto, hasta que la pelota resbala por las cuerdas', () => {
    expect(sliceSpin(45, 30, toFront).rpm).toBeGreaterThan(sliceSpin(45, 10, toFront).rpm);
    expect(sliceSpin(45, 80, toFront).slipped).toBe(true);
  });
});
