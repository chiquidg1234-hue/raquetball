import { describe, expect, it } from 'vitest';

import {
  BALL_TEST_AIR,
  ISA,
  airDensity,
  airViscosity,
  corFromDropTest,
  dragConstant,
  reboundFromCor,
  reynolds,
  standardPressure,
} from '../src/core/atmosphere.js';
import { BALLS, BALL_IDS, corAtTemperature, corForRebound } from '../src/core/balls.js';
import { BALL, BALL_TEST, COURT, IN } from '../src/core/constants.js';
import { simulateBallistic } from '../src/core/engine-ballistic.js';
import { v3 } from '../src/core/vec3.js';

describe('atmosfera estandar', () => {
  it('reproduce la tabla de la U.S. Standard Atmosphere', () => {
    expect(standardPressure(0)).toBe(ISA.p0);
    // Base de la capa 1 (11 km): 22 632.1 Pa en la tabla de la fuente.
    expect(standardPressure(11_000)).toBeCloseTo(22_632, -1);
  });

  it('da la densidad de la tabla "Density of air" a 1 atm', () => {
    // Tabla de https://en.wikipedia.org/wiki/Density_of_air
    const at = (temperatureC: number) =>
      airDensity({ altitude: 0, temperatureC });
    expect(at(20)).toBeCloseTo(1.2041, 3);
    expect(at(30)).toBeCloseTo(1.1644, 3);
    expect(at(0)).toBeCloseTo(1.2922, 3);
  });

  it('el aire pesa menos cuanto mas alto y cuanto mas caliente', () => {
    const rho = (altitude: number, temperatureC = 20) =>
      airDensity({ altitude, temperatureC });
    expect(rho(416)).toBeGreaterThan(rho(2558));
    expect(rho(2558)).toBeGreaterThan(rho(4150));
    expect(rho(4150, 30)).toBeLessThan(rho(4150, 5));
    // El Alto frente a Santa Cruz, misma temperatura: 37 % menos de aire.
    expect(rho(4150) / rho(416)).toBeCloseTo(0.627, 2);
  });

  it('una presion medida sustituye a la estandar', () => {
    const standard = airDensity({ altitude: 3640, temperatureC: 15 });
    const measured = airDensity({ altitude: 3640, temperatureC: 15, pressureHpa: 660 });
    expect(measured).toBeGreaterThan(standard);
    expect(measured).toBeCloseTo((660 * 100) / (287.05 * 288.15), 6);
  });

  it('Reynolds: 85 m/s a nivel del mar roza la crisis de arrastre, en El Alto no', () => {
    const re = (altitude: number) => {
      const rho = airDensity({ altitude, temperatureC: 20 });
      return reynolds(85, rho, 20, BALL.diameter);
    };
    expect(airViscosity(20)).toBeCloseTo(1.81e-5, 7);
    expect(re(0)).toBeGreaterThan(3e5);
    expect(re(4150)).toBeLessThan(2e5);
  });
});

describe('COR desde la prueba de homologacion', () => {
  const kTest = dragConstant(airDensity(BALL_TEST_AIR), BALL);

  it('sin aire vuelve a la cuenta de siempre', () => {
    expect(corFromDropTest(70 * IN, 100 * IN, 0)).toBeCloseTo(Math.sqrt(0.7), 12);
  });

  it('con aire el COR legal es 0.859-0.885, no 0.825-0.849', () => {
    expect(corFromDropTest(68 * IN, 100 * IN, kTest)).toBeCloseTo(0.859, 3);
    expect(corFromDropTest(70 * IN, 100 * IN, kTest)).toBeCloseTo(0.872, 3);
    expect(corFromDropTest(72 * IN, 100 * IN, kTest)).toBeCloseTo(0.885, 3);
  });

  it('el COR de antes (0.837) no pasaba la prueba: 64.6 in', () => {
    expect(reboundFromCor(0.837, 100 * IN, kTest) / IN).toBeCloseTo(64.6, 1);
  });

  it('reboundFromCor es la inversa de corFromDropTest', () => {
    for (const r of [68, 69.5, 72]) {
      const e = corFromDropTest(r * IN, 100 * IN, kTest);
      expect(reboundFromCor(e, 100 * IN, kTest) / IN).toBeCloseTo(r, 9);
    }
  });

  it('cada pelota del catalogo, soltada en el motor, rebota a su altura', () => {
    for (const id of BALL_IDS) {
      const ball = BALLS[id];
      const e = corForRebound(ball.reboundIn);
      const traj = simulateBallistic(
        {
          origin: v3(COURT.width / 2, BALL_TEST.dropHeight + BALL.radius, 6),
          direction: v3(0, -1, 0),
          speed: 0,
        },
        { dragK: kTest, surfaceRestitution: { floor: e }, maxBounces: 2, maxTime: 4 },
      );
      const first = traj.bounces[0]!;
      const apex = Math.max(
        ...traj.samples.filter((s) => s.t > first.time).map((s) => s.p.y),
      );
      const reboundIn = (apex - BALL.radius) / IN;
      expect(Math.abs(reboundIn - ball.reboundIn)).toBeLessThan(0.3);
      expect(reboundIn).toBeGreaterThanOrEqual(68);
      expect(reboundIn).toBeLessThanOrEqual(72);
    }
  });

  it('las tres pelotas respetan el orden de sus fichas', () => {
    expect(BALLS['gearbox-black'].reboundIn).toBeLessThan(BALLS['formulaflow-blue'].reboundIn);
    expect(BALLS['formulaflow-blue'].reboundIn).toBeLessThan(BALLS['gearbox-blue'].reboundIn);
    for (const id of BALL_IDS) {
      // Ningun fabricante publica medidas: tiene que decir que es estimacion.
      expect(BALLS[id].reboundBasis).toMatch(/^estimacion/);
    }
  });

  it('la temperatura solo toca el COR si se calibra (no hay dato publicado)', () => {
    const e = corForRebound(70);
    expect(corAtTemperature(e, 5, 0)).toBe(e);
    expect(corAtTemperature(e, 5, 0.004)).toBeLessThan(e);
    expect(corAtTemperature(e, 35, 0.004)).toBeGreaterThan(e);
  });
});
