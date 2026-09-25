import { describe, expect, it } from 'vitest';

import { BALL, COURT } from '../src/core/constants.js';
import { CENTER_BOX } from '../src/core/court.js';
import { simulateBallistic } from '../src/core/engine-ballistic.js';
import {
  SPIN,
  angularMomentumAbout,
  contactPointVelocity,
  defaultContact,
  defaultNick,
  kineticEnergy,
  nickCheck,
  settleRolling,
  spinBounce,
} from '../src/core/spin.js';
import type { Vec3 } from '../src/core/types.js';
import { addScaled, length, normalize, v3 } from '../src/core/vec3.js';

const R = BALL.radius;
const a = SPIN.inertiaFactor;
const ex = SPIN.tangentialCor;
const e = BALL.restitution;
/** Lo que se queda la velocidad paralela al agarrar, sin giro previo. */
const KEEP = 1 - (a * (1 + ex)) / (1 + a);

// Generador reproducible, para barrer casos sin depender de la suerte.
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('el rebote con friccion (Cross 2002)', () => {
  const floor = v3(0, 1, 0);
  const contact = defaultContact(e);

  it('agarre sin giro previo: la paralela queda en 1 - alpha(1+ex)/(1+alpha) = 61.5 %', () => {
    // alpha = 0.58, e_x = 0.05: 1 - 0.609/1.58 = 0.6146.
    expect(KEEP).toBeCloseTo(0.6146, 4);
    const v = v3(0, -10, 10); // llega a 45 grados
    const b = spinBounce(v, v3(), floor, contact);
    expect(b.slipped).toBe(false);
    expect(b.v.z / v.z).toBeCloseTo(KEEP, 12);
    expect(b.v.y).toBeCloseTo(10 * e, 12);
    // Y el punto de contacto sale a -e_x veces lo que deslizaba.
    const u = contactPointVelocity(b.v, b.w, floor, R);
    expect(u.z).toBeCloseTo(-ex * 10, 12);
  });

  it('el giro que toma cuadra con la medida de Illouz 2014 (81 +- 10) sin(th) rad/s', () => {
    // Soltada desde 70.3 cm: llega a 3.71 m/s. El modelo da
    // w = (1+e_x) v sin(th)/((1+alpha) R) = 86.3 sin(th): dentro del error.
    const speed = 3.71;
    for (const deg of [10, 25, 40]) {
      const th = (deg * Math.PI) / 180;
      const v = v3(0, -speed * Math.cos(th), speed * Math.sin(th));
      const w = length(spinBounce(v, v3(), floor, contact).w);
      const perSin = w / Math.sin(th);
      expect(perSin).toBeCloseTo(((1 + ex) * speed) / ((1 + a) * R), 9);
      expect(perSin).toBeGreaterThan(81 - 10);
      expect(perSin).toBeLessThan(81 + 10);
    }
  });

  it('agarra hasta 77 grados y desliza por encima (tan th = mu(1+e)(1+alpha)/(alpha(1+ex)))', () => {
    const limit = Math.atan((SPIN.friction * (1 + e) * (1 + a)) / (a * (1 + ex)));
    expect((limit * 180) / Math.PI).toBeCloseTo(77.1, 1);
    const at = (deg: number) => {
      const th = (deg * Math.PI) / 180;
      return spinBounce(v3(0, -Math.cos(th) * 20, Math.sin(th) * 20), v3(), floor, contact);
    };
    expect(at(76).slipped).toBe(false);
    expect(at(78).slipped).toBe(true);
  });

  it('conserva el momento angular respecto al punto de contacto, con agarre o deslizando', () => {
    const next = rng(7);
    const walls: Vec3[] = [v3(1, 0, 0), v3(-1, 0, 0), v3(0, 1, 0), v3(0, -1, 0), v3(0, 0, 1), v3(0, 0, -1)];
    for (let i = 0; i < 400; i++) {
      const n = walls[i % walls.length]!;
      const v0 = v3((next() - 0.5) * 60, (next() - 0.5) * 60, (next() - 0.5) * 60);
      // Que llegue contra la superficie.
      const vn = v0.x * n.x + v0.y * n.y + v0.z * n.z;
      const v = vn < 0 ? v0 : addScaled(v0, n, -2 * vn);
      const w = v3((next() - 0.5) * 900, (next() - 0.5) * 900, (next() - 0.5) * 900);
      const center = v3(1, 1, 1);
      const q = addScaled(center, n, -R);
      const b = spinBounce(v, w, n, contact);
      const before = angularMomentumAbout(center, v, w, q, a, R);
      const after = angularMomentumAbout(center, b.v, b.w, q, a, R);
      expect(length(addScaled(after, before, -1))).toBeLessThan(1e-9 * (1 + length(before)));
    }
  });

  it('nunca crea energia (traslacion + rotacion)', () => {
    const next = rng(11);
    for (let i = 0; i < 400; i++) {
      const v = v3((next() - 0.5) * 80, -next() * 60 - 0.1, (next() - 0.5) * 80);
      const w = v3((next() - 0.5) * 1500, (next() - 0.5) * 1500, (next() - 0.5) * 1500);
      const b = spinBounce(v, w, floor, contact);
      expect(kineticEnergy(b.v, b.w, a, R)).toBeLessThanOrEqual(kineticEnergy(v, w, a, R) * (1 + 1e-12));
    }
  });
});

describe('el efecto del Z (INVESTIGACION 7): sale casi paralelo a la trasera', () => {
  /**
   * Caso limpio, sin aire ni gravedad: la pelota va a la lateral izquierda
   * a 45 grados, cruza la cancha y llega a la derecha.
   *
   *   izquierda: la paralela queda en K = 0.6146 y sale girando, con el
   *              punto de contacto a -(K + e_x) v_t = -0.6646 v_t.
   *   derecha:   el punto de contacto esta al otro lado de la pelota, asi
   *              que el giro SE SUMA: u_t = (0.6146 + 0.6646) v_t = 1.2791 v_t.
   *              La paralela queda en 0.6146 - 0.3854 * 1.2791 = 0.1215 v_t
   *              y la normal en e^2 v_t = 0.7607 v_t.
   *   => sale a atan(0.1215/0.7607) = 9.1 grados de la normal.
   * Sin efecto (0.65 fijo) saldria a 29 grados; con reflexion ideal, a 45.
   */
  const crossCourt = (disableSpin: boolean) =>
    simulateBallistic(
      {
        origin: v3(COURT.width / 2, 3, 3),
        direction: normalize(v3(-1, 0, 1)),
        speed: 20,
      },
      // COR constante: aqui se comprueba solo la mecanica del giro.
      { disableGravity: true, disableDrag: true, disableSpin, maxBounces: 2, corSpeedLoss: 0 },
    );

  const exitDeg = (traj: ReturnType<typeof crossCourt>) => {
    const b = traj.bounces[1]!;
    const s = traj.samples.find((q) => Math.abs(q.t - b.time) < 1e-12)!;
    return (Math.atan2(Math.abs(s.v.z), Math.abs(s.v.x)) * 180) / Math.PI;
  };

  it('con efecto sale a 9.1 grados de la normal de la segunda lateral', () => {
    const traj = crossCourt(false);
    expect(traj.bounces.map((b) => b.surface)).toEqual(['left', 'right']);
    const kept = 1 - (a * (1 + ex)) / (1 + a);
    const spinSlip = kept + ex;
    const along = kept - (1 - kept) * (kept + spinSlip);
    const expected = (Math.atan2(along, e * e) * 180) / Math.PI;
    expect(expected).toBeCloseTo(9.1, 1);
    expect(exitDeg(traj)).toBeCloseTo(expected, 6);
  });

  it('sin efecto saldria a 29 grados: el giro es lo que la endereza', () => {
    const exit = exitDeg(crossCourt(true));
    expect(exit).toBeCloseTo((Math.atan2(0.65 * 0.65, e * e) * 180) / Math.PI, 6);
    expect(exit).toBeGreaterThan(28);
  });

  it('el giro alrededor del eje vertical pasa por el piso sin cambiar', () => {
    // En el piso el punto de contacto esta sobre el eje vertical: w_y no lo
    // mueve, asi que la friccion del piso no lo frena.
    const w = v3(0, 700, 0);
    const b = spinBounce(v3(4, -6, 9), w, v3(0, 1, 0), defaultContact(e));
    expect(b.w.y).toBeCloseTo(700, 9);
  });
});

describe('la frontal y los kills', () => {
  it('un tiro que baja contra la frontal sale con efecto hacia delante y corre mas en el piso', () => {
    // Llega bajando: la frontal frena la caida del punto de contacto y la
    // pelota sale rodando "pared abajo", que al volver es efecto liftado
    // (w_x > 0 con la pelota yendo hacia +z). En el piso ese giro reduce
    // el deslizamiento y la pelota conserva mas velocidad que sin giro.
    const traj = simulateBallistic(
      { origin: v3(3, 2.5, 6), direction: normalize(v3(0, -0.25, -1)), speed: 30 },
      { maxBounces: 2 },
    );
    const [front, floorHit] = traj.bounces;
    expect(front!.surface).toBe('front');
    expect(front!.spinOut!.x).toBeGreaterThan(0);
    expect(floorHit!.surface).toBe('floor');
    const at = (t: number) => traj.samples.find((s) => Math.abs(s.t - t) < 1e-12)!;
    const before = traj.samples.filter((s) => s.t < floorHit!.time).at(-1)!;
    const kept = at(floorHit!.time).v.z / before.v.z;
    expect(kept).toBeGreaterThan(KEEP + 0.05);
  });
});

describe('el rollout al crack (nick, PNAS 2025)', () => {
  const D = BALL.diameter;
  const nick = defaultNick();
  const wall = v3(0, 0, 1);
  const arriving = (speed: number, deg: number): Vec3 => {
    const th = (deg * Math.PI) / 180;
    return v3(0, -speed * Math.sin(th), -speed * Math.cos(th));
  };

  it('la cuenta dimensional da la misma tau que la formula adimensional del paper', () => {
    // tau = beta H* Ca^(2/5) cos(th)^(1/5)/sin(th),  Ca = E/(rho U^2),
    // beta = (1+alpha)/(3.29 (pi/6)^(2/5)) = 0.622 (0.623 en el paper, con
    // kappa = 0.1455), rho = 6m/(pi D^3) = 406 kg/m3.
    const rho = (6 * BALL.mass) / (Math.PI * D ** 3);
    expect(rho).toBeCloseTo(406, 0);
    const beta = (1 + a) / (3.29 * Math.pow(Math.PI / 6, 2 / 5));
    expect(beta).toBeCloseTo(0.622, 3);
    for (const [speed, deg, hStar] of [
      [40, 10, 0.65],
      [25, 14, 0.7],
      [55, 6, 0.62],
    ] as const) {
      const th = (deg * Math.PI) / 180;
      const Ca = SPIN.stiffness / (rho * speed * speed);
      const tau = (beta * hStar * Math.pow(Ca, 2 / 5) * Math.pow(Math.cos(th), 1 / 5)) / Math.sin(th);
      const c = nickCheck(arriving(speed, deg), v3(), wall, hStar * D, nick);
      expect(c.tau).toBeCloseTo(tau, 9);
    }
  });

  it('a 40 m/s, con el centro a 0.65 D, hace nick si baja a 10 grados y no a 3', () => {
    const steep = nickCheck(arriving(40, 10), v3(), wall, 0.65 * D, nick);
    expect(steep.tau).toBeCloseTo(0.8, 1);
    expect(steep.rollout).toBe(true);
    const flat = nickCheck(arriving(40, 3), v3(), wall, 0.65 * D, nick);
    expect(flat.tau).toBeGreaterThan(2.4);
    expect(flat.rollout).toBe(false);
  });

  it('fuera de la banda 0.6-0.75 D no hay nick, baje como baje', () => {
    for (const h of [0.55, 0.8, 1.2]) {
      expect(nickCheck(arriving(40, 25), v3(), wall, h * D, nick).rollout).toBe(false);
    }
    expect(nickCheck(arriving(40, 25), v3(), wall, 0.61 * D, nick).rollout).toBe(true);
    expect(nickCheck(arriving(40, 25), v3(), wall, 0.74 * D, nick).rollout).toBe(true);
  });

  it('subiendo no hay nick', () => {
    const up = arriving(40, -10);
    expect(nickCheck(up, v3(), wall, 0.65 * D, nick).rollout).toBe(false);
  });

  it('el corte (backspin) ayuda: el mismo tiro pasa a hacer nick', () => {
    // A 40 m/s y 7 grados, sin giro, tau > 1. Con un corte que sube el
    // punto de contacto con la pared 5 m/s, la pelota llega "ya rodando".
    const v = arriving(40, 7);
    const plain = nickCheck(v, v3(), wall, 0.65 * D, nick);
    expect(plain.tau).toBeGreaterThan(1);
    // Yendo hacia la frontal (-z), el corte es w_x > 0: la parte de abajo
    // de la pelota va hacia delante y la de delante SUBE. (w x r).y = R w_x
    // con r = -R z.
    const cut = v3(5 / R, 0, 0);
    const withCut = nickCheck(v, cut, wall, 0.65 * D, nick);
    expect(withCut.tau).toBeLessThan(1);
    expect(withCut.rollout).toBe(true);
  });

  /** Tiro que baja a 12 grados contra la frontal desde 1.5 m. */
  const nickShot = (y0: number, deg = 12) => {
    const th = (deg * Math.PI) / 180;
    return simulateBallistic(
      { origin: v3(3, y0, 1.5), direction: v3(0, -Math.sin(th), -Math.cos(th)), speed: 40 },
      { maxBounces: 6 },
    );
  };
  /** Altura de salida para que el centro llegue a `h` de la frontal. */
  const aimAt = (h: number, deg = 12): number => {
    const first = h + (1.5 - BALL.radius) * Math.tan((deg * Math.PI) / 180);
    // Una correccion por la gravedad y el aire: la relacion es casi lineal.
    return first + (h - nickShot(first, deg).bounces[0]!.point.y);
  };

  it('en el motor: el nick sale rodando, sin bote, y ese contacto es su bote 1', () => {
    // Al centro de la banda: 0.675 D = 38.6 mm.
    const traj = nickShot(aimAt(0.675 * D));
    const [front, floorHit] = traj.bounces;
    expect(front!.surface).toBe('front');
    expect(front!.rollout).toBe(true);
    expect(front!.nickTau!).toBeLessThan(1);
    expect(front!.point.y / BALL.diameter).toBeGreaterThan(0.6);
    expect(front!.point.y / BALL.diameter).toBeLessThan(0.75);
    expect(floorHit!.surface).toBe('floor');
    expect(floorHit!.rolling).toBe(true);
    expect(floorHit!.time).toBe(front!.time);
    // Y desde ahi va pegada al piso.
    const after = traj.samples.filter((s) => s.t > front!.time + 1e-9);
    expect(after.length).toBeGreaterThan(10);
    for (const s of after.slice(0, 50)) {
      expect(s.p.y).toBeCloseTo(BALL.radius, 9);
      expect(s.v.y).toBe(0);
    }
  });
});

describe('rodar por el piso', () => {
  it('sin giro, al pasar a rodar se queda con v/(1+alpha) = 63 %', () => {
    const r = settleRolling(v3(0, 0, 10), v3(), R, a);
    expect(r.v.z).toBeCloseTo(10 / (1 + a), 12);
    // Y rueda de verdad: el punto de apoyo queda quieto.
    const u = contactPointVelocity(r.v, r.w, v3(0, 1, 0), R);
    expect(length(u)).toBeLessThan(1e-12);
  });

  it('conserva el momento angular respecto al punto de apoyo', () => {
    const v = v3(3, 0, -7);
    const w = v3(120, 400, -60);
    const center = v3(2, R, 5);
    const q = v3(2, 0, 5);
    const r = settleRolling(v, w, R, a);
    const before = angularMomentumAbout(center, v, w, q, a, R);
    const after = angularMomentumAbout(center, r.v, r.w, q, a, R);
    // La parte horizontal (el piso no hace par sobre el eje vertical).
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.z).toBeCloseTo(before.z, 12);
    expect(r.w.y).toBe(400);
  });

  it('una pelota que casi no bota pero corre, rueda hasta pararse', () => {
    // A 2.5 m/s rodando frena despacio (0.12 m/s2 de rodadura mas el aire):
    // llega a la trasera, da un saltito, vuelve y a los ~9 s se para. Por
    // eso aqui el limite de tiempo es mas largo que los 8 s de la vista.
    const traj = simulateBallistic(
      { origin: v3(3, BALL.radius + 0.004, 3), direction: normalize(v3(0, -0.02, 1)), speed: 4 },
      { maxBounces: 30, maxTime: 30 },
    );
    const floorHit = traj.bounces.find((b) => b.rolling);
    expect(floorHit).toBeDefined();
    expect(traj.terminated).toBe('restingOnFloor');
    const last = traj.samples.at(-1)!;
    expect(Math.hypot(last.v.x, last.v.z)).toBeLessThan(SPIN.rollingStopSpeed + 1e-9);
    expect(last.p.z).toBeGreaterThan(3.5);
    for (const s of traj.samples) expect(s.p.z).toBeLessThanOrEqual(CENTER_BOX.zMax + 1e-9);
  });

  it('rodando, el aire y la rodadura frenan; nunca acelera', () => {
    const traj = simulateBallistic(
      { origin: v3(3, BALL.radius + 0.004, 3), direction: normalize(v3(0, -0.02, 1)), speed: 4 },
      { maxBounces: 30 },
    );
    const start = traj.bounces.find((b) => b.rolling)!.time;
    const rollingPart = traj.samples.filter((s) => s.t >= start);
    // Solo los tramos pegados al piso: tras chocar con la trasera da un
    // saltito, y cayendo si acelera, como debe.
    const onFloor = (s: (typeof rollingPart)[number]) => s.p.y === BALL.radius && s.v.y === 0;
    let checked = 0;
    for (let i = 1; i < rollingPart.length; i++) {
      const prev = rollingPart[i - 1]!;
      const cur = rollingPart[i]!;
      if (!onFloor(prev) || !onFloor(cur)) continue;
      if (traj.bounces.some((b) => b.time > prev.t && b.time <= cur.t)) continue;
      expect(length(cur.v)).toBeLessThanOrEqual(length(prev.v) + 1e-12);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    // Y el giro acompana: rueda sin deslizar.
    const mid = rollingPart[Math.floor(rollingPart.length / 3)]!;
    const u = contactPointVelocity(mid.v, mid.w!, v3(0, 1, 0), R);
    expect(Math.hypot(u.x, u.z)).toBeLessThan(1e-9);
  });
});

describe('el giro viaja con la pelota', () => {
  it('el tiro sale con el giro que le da la raqueta', () => {
    const spin = v3(0, 0, 250);
    const traj = simulateBallistic(
      { origin: v3(3, 1, 6), direction: v3(0, 0, -1), speed: 20, spin },
      { maxBounces: 1 },
    );
    expect(traj.samples[0]!.w).toEqual(spin);
    // En vuelo no cambia (sin Magnus: INVESTIGACION 7).
    const beforeWall = traj.samples.filter((s) => s.t < traj.bounces[0]!.time).at(-1)!;
    expect(beforeWall.w).toEqual(spin);
  });

  it('el motor sin efecto no lleva giro en las muestras', () => {
    const traj = simulateBallistic(
      { origin: v3(3, 1, 6), direction: v3(0, 0, -1), speed: 20 },
      { disableSpin: true, maxBounces: 1 },
    );
    expect(traj.samples[0]!.w).toBeUndefined();
    expect(traj.bounces[0]!.spinOut).toBeUndefined();
  });
});
