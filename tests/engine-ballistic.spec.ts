import { describe, expect, it } from 'vitest';

import {
  BALL,
  COR_SPEED,
  COURT,
  DRAG_K,
  GRAVITY,
  IN,
  SIM,
  corAtSpeed,
} from '../src/core/constants.js';
import { BALL_TEST_AIR, airDensity, dragConstant } from '../src/core/atmosphere.js';
import { CENTER_BOX, penetrationDepth } from '../src/core/court.js';
import { simulateBallistic } from '../src/core/engine-ballistic.js';
import { SPIN } from '../src/core/spin.js';
import { PRESETS, resolvePreset } from '../src/core/presets.js';
import type { Shot } from '../src/core/types.js';
import { fromAzimuthElevation, length, v3 } from '../src/core/vec3.js';

const shot = (partial: Partial<Shot> = {}): Shot => ({
  origin: v3(COURT.width / 2, 0.9, 8),
  direction: v3(0, 0, -1),
  speed: 45,
  ...partial,
});

/**
 * Energia especifica: v^2/2 + g*y + la de rotacion, alpha R^2 w^2/2. Sin
 * masa, que se cancela. Desde que la pelota gira hay que contarla: un
 * rebote puede pasar giro a velocidad (el efecto liftado "patea" hacia
 * delante) y sin ella parecia que la pelota ganaba energia.
 */
const energy = (
  p: { y: number },
  v: { x: number; y: number; z: number },
  w?: { x: number; y: number; z: number },
) =>
  (v.x * v.x + v.y * v.y + v.z * v.z) / 2 +
  GRAVITY * p.y +
  (w ? (SPIN.inertiaFactor * BALL.radius ** 2 * (w.x * w.x + w.y * w.y + w.z * w.z)) / 2 : 0);

// ---------------------------------------------------------------- arrastre

describe('el arrastre domina sobre la gravedad', () => {
  it('k vale 0.0194 1/m a nivel del mar y 20 C', () => {
    // Antes era una constante con rho = 1.20 y daba 0.01939. Ahora sale de
    // la atmosfera estandar: a nivel del mar y 20 C rho = 1.2041 kg/m3 y
    // k = 0.01945. Sigue siendo "0.0194" del spec; lo que cambio es que ya
    // no vale en todas partes: en El Alto es 0.0116 (tests/venue.spec.ts).
    expect(DRAG_K).toBeCloseTo(0.01945, 5);
    expect(DRAG_K).toBeCloseTo(0.0194, 3);
    expect(
      dragConstant(airDensity({ altitude: 0, temperatureC: 20 }), BALL),
    ).toBe(DRAG_K);
  });

  it('reproduce la tabla de aceleraciones del spec', () => {
    // velocidad -> arrastre en múltiplos de g
    const expected: [number, number][] = [
      [30, 1.8],
      [45, 4.0],
      [60, 7.1],
      [85, 14.3],
    ];
    for (const [speed, gs] of expected) {
      expect((DRAG_K * speed * speed) / GRAVITY).toBeCloseTo(gs, 1);
    }
  });

  it('una pelota rapida pierde velocidad de forma visible', () => {
    const traj = simulateBallistic(shot({ speed: 80 }), { maxBounces: 1 });
    const final = length(traj.samples.at(-1)!.v);
    expect(final).toBeLessThan(80 * 0.9);
  });
});

// ------------------------------------------- criterios de aceptacion §6.3

describe('criterios de aceptacion del motor balistico', () => {
  it('1. soltada desde 100 in en el aire de la prueba rebota a 70 in ± 2 cm', () => {
    // La prueba de homologacion es CON aire. Antes el test quitaba el
    // arrastre porque el COR se habia sacado con sqrt(70/100), que ignora
    // el aire; con ese COR y el aire puesto, la pelota rebotaba a 64.6 in y
    // no pasaba su propia norma. Ahora el COR sale de la prueba con
    // arrastre (0.872) y el test hace la prueba tal cual es.
    const dropHeight = 100 * IN; // 2.54 m, medidos desde el piso a la pelota
    const traj = simulateBallistic(
      {
        origin: v3(COURT.width / 2, dropHeight + BALL.radius, COURT.length / 2),
        direction: v3(0, -1, 0),
        speed: 0,
      },
      {
        dragK: dragConstant(airDensity(BALL_TEST_AIR), BALL),
        maxBounces: 2,
        maxTime: 4,
      },
    );

    const first = traj.bounces[0]!;
    expect(first.surface).toBe('floor');

    const apex = Math.max(
      ...traj.samples.filter((s) => s.t > first.time).map((s) => s.p.y),
    );
    const rebound = apex - BALL.radius;
    expect(Math.abs(rebound - 70 * IN)).toBeLessThan(0.02);
    expect(rebound).toBeGreaterThan(68 * IN);
    expect(rebound).toBeLessThan(72 * IN);
  });

  it('1b. sin arrastre, el rebote es exactamente COR^2 de la caida', () => {
    const drop = 2.5;
    const traj = simulateBallistic(
      { origin: v3(3, drop + BALL.radius, 6), direction: v3(0, -1, 0), speed: 0 },
      { disableDrag: true, maxBounces: 2, maxTime: 4 },
    );
    const first = traj.bounces[0]!;
    const apex = Math.max(
      ...traj.samples.filter((s) => s.t > first.time).map((s) => s.p.y),
    );
    // Sin aire llega a 7.0 m/s, un pelo mas que en la prueba: el COR es el
    // de esa velocidad (0.8712), no exactamente 0.8722.
    const e = corAtSpeed(BALL.restitution, Math.sqrt(2 * GRAVITY * drop));
    expect(apex - BALL.radius).toBeCloseTo(e ** 2 * drop, 3);
  });

  it('2. la energia total nunca aumenta entre dos muestras consecutivas', () => {
    for (const az of [-35, -10, 0, 18, 44]) {
      const traj = simulateBallistic(
        shot({ direction: fromAzimuthElevation(az, 12), speed: 62 }),
      );
      for (let i = 1; i < traj.samples.length; i++) {
        const prev = traj.samples[i - 1]!;
        const cur = traj.samples[i]!;
        const before = energy(prev.p, prev.v, prev.w);
        const after = energy(cur.p, cur.v, cur.w);
        // Tolerancia solo para el ruido de coma flotante del integrador.
        expect(after, `az=${az} muestra ${i}`).toBeLessThanOrEqual(
          before + 1e-6 * Math.max(1, before),
        );
      }
    }
  });

  it('3. ningun punto de samples queda fuera de la cancha por mas de 1 mm', () => {
    for (const speed of [20, 45, 70, 90]) {
      for (const az of [-60, -22, 0, 31, 70]) {
        const traj = simulateBallistic(
          shot({ direction: fromAzimuthElevation(az, 8), speed }),
        );
        for (const s of traj.samples) {
          expect(penetrationDepth(s.p), `${speed} m/s az=${az}`).toBeLessThan(
            0.001,
          );
        }
      }
    }
  });

  it('4. anti-tunneling: 85 m/s a la frontal da exactamente un rebote front', () => {
    const traj = simulateBallistic(
      shot({ origin: v3(COURT.width / 2, 1.2, 8), speed: 85 }),
      { maxBounces: 1 },
    );
    expect(traj.bounces).toHaveLength(1);
    expect(traj.bounces[0]!.surface).toBe('front');
    for (const s of traj.samples) {
      expect(s.p.z).toBeGreaterThan(CENTER_BOX.zMin - 0.001);
    }
  });

  it('4b. el anti-tunneling lo hace la prueba de segmento, no el paso', () => {
    // A 1/30 s y 90 m/s la pelota "avanza" 3 m por paso, media cancha.
    // Un integrador de mover-y-comprobar se saltaria paredes enteras.
    // Como se prueba el SEGMENTO, aqui no se cuela ni con ese paso.
    const traj = simulateBallistic(
      shot({ direction: fromAzimuthElevation(28, 6), speed: 90 }),
      { physicsDt: 1 / 30 },
    );
    expect(traj.bounces.length).toBeGreaterThan(2);
    for (const s of traj.samples) {
      expect(penetrationDepth(s.p)).toBeLessThan(0.001);
    }
  });

  it('5. todo tiro termina en menos de 8 s simulados y 20 ms de reloj', () => {
    const angles: [number, number][] = [];
    for (const az of [-80, -40, 0, 40, 80]) {
      for (const el of [-20, 0, 25, 55]) angles.push([az, el]);
    }

    // Calentamiento: la primera simulacion paga la compilacion JIT y no
    // representa el coste en regimen.
    for (const [az, el] of angles) {
      simulateBallistic(shot({ direction: fromAzimuthElevation(az, el), speed: 75 }));
    }

    const times: number[] = [];
    for (const [az, el] of angles) {
      const t0 = performance.now();
      const traj = simulateBallistic(
        shot({ direction: fromAzimuthElevation(az, el), speed: 75 }),
      );
      times.push(performance.now() - t0);
      expect(traj.totalTime, `az=${az} el=${el}`).toBeLessThanOrEqual(
        SIM.maxTime + 1e-9,
      );
    }

    // Se mide la MEDIANA, no cada muestra suelta. El criterio del spec es
    // que simular sea barato, y una sola muestra en una maquina compartida
    // mide el ruido del vecino tanto como el motor: este test fallaba de
    // forma intermitente por eso, no por una regresion.
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median, `mediana de ${times.length} tiros`).toBeLessThan(20);

    // Techo de cordura: aunque la maquina este cargada, ninguna simulacion
    // deberia acercarse a hacerse notar en una interaccion.
    expect(Math.max(...times)).toBeLessThan(250);
  });
});

// ---------------------------------------------------------------- rebotes

describe('modelo de rebote', () => {
  it('el COR normal se aplica a la componente normal', () => {
    const traj = simulateBallistic(
      shot({ origin: v3(3, 2.5, 6), direction: v3(0, -1, 0), speed: 10 }),
      { disableDrag: true, maxBounces: 1 },
    );
    const b = traj.bounces[0]!;
    expect(b.surface).toBe('floor');
    // Llega a 12.2 m/s, mas rapido que en la prueba de homologacion: el COR
    // ya no es el 0.872 de la prueba sino el que toca a esa velocidad.
    expect(b.outgoingSpeed / b.incomingSpeed).toBeCloseTo(
      corAtSpeed(BALL.restitution, b.incomingSpeed),
      3,
    );
    expect(b.outgoingSpeed / b.incomingSpeed).toBeLessThan(BALL.restitution);
  });

  it('el COR baja con la velocidad del impacto y se congela a 40 m/s', () => {
    // A la velocidad de la prueba (6.9 m/s con aire) es el de la prueba.
    expect(COR_SPEED.reference).toBeCloseTo(6.89, 2);
    expect(corAtSpeed(0.872, COR_SPEED.reference)).toBeCloseTo(0.872, 12);
    expect(corAtSpeed(0.872, 3)).toBe(0.872);
    // Cada m/s por encima quita un 0.92 %: a 30 m/s, 0.872 (1 - 0.0092 * 23.1).
    expect(corAtSpeed(0.872, 30)).toBeCloseTo(0.872 * (1 - 0.0092 * (30 - COR_SPEED.reference)), 12);
    expect(corAtSpeed(0.872, 30)).toBeCloseTo(0.687, 3);
    // Por encima de 40 m/s no hay medidas analogas: no se extrapola.
    expect(corAtSpeed(0.872, 85)).toBe(corAtSpeed(0.872, 40));
    expect(corAtSpeed(0.872, 40)).toBeCloseTo(0.606, 3);
    // Y con la perdida a 0 es el COR constante de antes.
    expect(corAtSpeed(0.872, 60, 0)).toBe(0.872);
  });

  // Antes habia un solo test: "la restitucion tangencial frena la
  // componente paralela" al 65 %. Ese 0.65 no salia de ninguna medida y la
  // pelota no giraba. Ahora el rebote es con friccion y giro (spin.ts): el
  // motor de antes queda para comparar, y el nuevo se comprueba con su cuenta.
  const floor45 = (disableSpin: boolean) => {
    const traj = simulateBallistic(
      shot({
        origin: v3(3, 2.0, 8),
        direction: fromAzimuthElevation(0, -45),
        speed: 20,
      }),
      { disableDrag: true, maxBounces: 1, disableSpin },
    );
    const contact = traj.bounces[0]!.time;
    // La muestra del contacto guarda la velocidad SALIENTE.
    const after = traj.samples.find((s) => Math.abs(s.t - contact) < 1e-12)!;
    const before = traj.samples.filter((s) => s.t < contact).at(-1)!;
    return { after, before };
  };

  it('sin efecto (el motor de antes): la paralela se queda al 65 %', () => {
    const { after, before } = floor45(true);
    expect(Math.abs(after.v.z / before.v.z)).toBeCloseTo(BALL.tangentialRestitution, 2);
  });

  it('con efecto: una pelota sin giro agarra y la paralela queda en 1 - alpha(1+ex)/(1+alpha)', () => {
    // 1 - 0.58 * 1.05/1.58 = 0.6146, y sale girando hacia delante.
    const { after, before } = floor45(false);
    const keep = 1 - (SPIN.inertiaFactor * (1 + SPIN.tangentialCor)) / (1 + SPIN.inertiaFactor);
    expect(Math.abs(after.v.z / before.v.z)).toBeCloseTo(keep, 2);
    // Gira en el sentido de rodar hacia donde va: (y x v) . w > 0. Aqui va
    // hacia la frontal (-z), asi que es w_x < 0.
    const rollSense = after.v.z * after.w!.x - after.v.x * after.w!.z;
    expect(rollSense).toBeGreaterThan(0);
  });

  it('admite un COR distinto por superficie', () => {
    const soft = simulateBallistic(
      shot({ origin: v3(3, 2.5, 6), direction: v3(0, -1, 0), speed: 0 }),
      { disableDrag: true, maxBounces: 1, surfaceRestitution: { floor: 0.2 } },
    );
    expect(soft.bounces[0]!.outgoingSpeed / soft.bounces[0]!.incomingSpeed)
      .toBeCloseTo(0.2, 3);
  });

  it('se detiene por reposo en vez de micro-rebotar sin fin', () => {
    const traj = simulateBallistic(
      { origin: v3(3, 0.35, 6), direction: v3(0, -1, 0), speed: 0 },
      { maxBounces: 200, maxTime: 30 },
    );
    expect(traj.terminated).toBe('restingOnFloor');
    expect(traj.totalTime).toBeLessThan(30);
    const last = traj.samples.at(-1)!;
    expect(last.p.y).toBeLessThan(BALL.radius + 0.05);
  });

  it('la pared trasera de 12 ft sigue dejando salir la pelota', () => {
    // Una pelota que ya viene alta y va hacia el fondo: cruza Z = 12.192
    // por encima de 3.6576 m, donde no hay pared.
    const traj = simulateBallistic(
      { origin: v3(3, 4.5, 9), direction: v3(0, 0.1, 1), speed: 25 },
      { maxTime: 12, maxBounces: 30 },
    );
    expect(traj.terminated).toBe('exitedCourt');
    expect(traj.samples.at(-1)!.p.y).toBeGreaterThan(COURT.backWallHeight);
  });
});

// ---------------------------------------------------------------- presets

describe('los presets no rompen el motor balistico', () => {
  it('ninguno se sale de la cancha ni tarda de mas', () => {
    for (const preset of PRESETS) {
      const r = resolvePreset(preset, v3(COURT.width / 2, 0.9, 8.29));
      const traj = simulateBallistic({
        origin: r.origin,
        direction: fromAzimuthElevation(r.azimuthDeg, r.elevationDeg),
        speed: r.speed,
      });
      for (const s of traj.samples) {
        expect(penetrationDepth(s.p), preset.id).toBeLessThan(0.001);
      }
      expect(traj.totalTime, preset.id).toBeLessThanOrEqual(SIM.maxTime + 1e-9);
    }
  });
});
