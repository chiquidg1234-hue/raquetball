/**
 * FASE 10 — El problema inverso: "quiero que la pelota muera ahi, ¿donde
 * le pego?".
 *
 * Es la funcion que convierte la app de bonita a "la uso antes de
 * entrenar", porque invierte la pregunta: ya no es "que hace este tiro"
 * sino "que tiro hace esto".
 *
 * DOS CAMINOS, COMO PIDE EL SPEC:
 *
 * - Con el motor GEOMETRICO hay solucion analitica por el metodo del
 *   espejo. Se refleja el objetivo al otro lado de la pared frontal y la
 *   trayectoria de dos tramos se vuelve una recta: apuntar es mirar el
 *   punto espejado. Sale exacta y en microsegundos.
 *
 * - Con el motor BALISTICO no hay forma cerrada, porque el arrastre no es
 *   integrable en cerrado. Se resuelve por metodo de disparo: Newton de
 *   dos variables (azimut, elevacion) con jacobiano numerico, y
 *   Nelder-Mead de respaldo si Newton se pone inestable.
 *
 * El truco que hace que converja rapido: la solucion geometrica se usa
 * como SEMILLA del metodo numerico. Empezar desde la respuesta ideal en
 * vez de desde un angulo cualquiera baja las iteraciones de decenas a
 * unas pocas.
 */

import { CENTER_BOX } from './court.js';
import { simulate } from './engine.js';
import type { PhysicsModel, Shot, Trajectory, Vec3 } from './types.js';
import { fromAzimuthElevation, normalize, sub } from './vec3.js';

export interface AimTarget {
  /** Donde debe caer la pelota, en el piso. */
  x: number;
  z: number;
  /** Que bote en el piso debe caer ahi. 1 = el primero. */
  bounceIndex: 1 | 2;
}

export interface SolveOptions {
  origin: Vec3;
  speed: number;
  model: PhysicsModel;
  /** Tambien buscar la velocidad, no solo los angulos. */
  searchSpeed?: boolean;
  maxIterations?: number;
  /** Error aceptable, en metros. */
  tolerance?: number;
}

export type SolveMethod = 'espejo' | 'newton' | 'nelder-mead' | 'ninguno';

export interface SolveResult {
  ok: boolean;
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
  /** Distancia entre donde cae y donde se pedia, en metros. */
  error: number;
  iterations: number;
  method: SolveMethod;
  /** Punto equivalente de la pared frontal al que hay que apuntar. */
  aimPoint: Vec3 | null;
  trajectory: Trajectory | null;
  note: string;
}

const DEG = 180 / Math.PI;

const anglesTo = (from: Vec3, to: Vec3): { azimuthDeg: number; elevationDeg: number } => {
  const d = normalize(sub(to, from));
  return {
    azimuthDeg: Math.atan2(d.x, -d.z) * DEG,
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, d.y))) * DEG,
  };
};

// ---------------------------------------------------------- metodo espejo

/**
 * Solucion analitica para el motor geometrico y el primer bote.
 *
 * Se refleja el objetivo al otro lado de la pared frontal (sobre el plano
 * del centro de la pelota, z = r) y se apunta en linea recta al reflejo.
 * En el espacio desplegado la trayectoria de dos tramos ES una recta, asi
 * que la solucion es exacta, no iterativa.
 */
export const mirrorSolution = (
  origin: Vec3,
  target: { x: number; z: number },
): { azimuthDeg: number; elevationDeg: number; mirrored: Vec3 } => {
  const zf = CENTER_BOX.zMin;
  const mirrored: Vec3 = {
    x: target.x,
    y: CENTER_BOX.yMin,
    z: 2 * zf - target.z,
  };
  return { ...anglesTo(origin, mirrored), mirrored };
};

/** Donde cruza la pared frontal la recta origen -> objetivo espejado. */
export const frontWallAimPoint = (origin: Vec3, mirrored: Vec3): Vec3 | null => {
  const dz = mirrored.z - origin.z;
  if (Math.abs(dz) < 1e-9) return null;
  const t = (CENTER_BOX.zMin - origin.z) / dz;
  if (t < 0 || t > 1) return null;
  return {
    x: origin.x + (mirrored.x - origin.x) * t,
    y: origin.y + (mirrored.y - origin.y) * t,
    z: CENTER_BOX.zMin,
  };
};

// ------------------------------------------------------------ evaluacion

const runShot = (
  origin: Vec3,
  azimuthDeg: number,
  elevationDeg: number,
  speed: number,
  model: PhysicsModel,
): Trajectory => {
  const shot: Shot = {
    origin,
    direction: fromAzimuthElevation(azimuthDeg, elevationDeg),
    speed,
  };
  return simulate(shot, { model, maxBounces: 8 });
};

interface Evaluation {
  trajectory: Trajectory;
  /** Residuo [dx, dz] si existe el bote pedido. */
  residual: [number, number] | null;
  /** Coste escalar, siempre definido, para Nelder-Mead. */
  cost: number;
}

const evaluate = (
  opts: SolveOptions,
  target: AimTarget,
  azimuthDeg: number,
  elevationDeg: number,
  speed: number,
): Evaluation => {
  const trajectory = runShot(
    opts.origin,
    azimuthDeg,
    elevationDeg,
    speed,
    opts.model,
  );
  const floors = trajectory.bounces.filter((b) => b.surface === 'floor');
  const wanted = floors[target.bounceIndex - 1];

  if (wanted) {
    const dx = wanted.point.x - target.x;
    const dz = wanted.point.z - target.z;
    return {
      trajectory,
      residual: [dx, dz],
      cost: Math.hypot(dx, dz),
    };
  }

  // No hay bote donde se pedia. El coste tiene que seguir guiando la
  // busqueda, asi que se mide lo mas cerca que pasa la trayectoria del
  // objetivo, con una penalizacion que la mantenga siempre peor que
  // cualquier solucion valida.
  let closest = Infinity;
  for (const s of trajectory.samples) {
    const d = Math.hypot(s.p.x - target.x, s.p.z - target.z);
    if (d < closest) closest = d;
  }
  return {
    trajectory,
    residual: null,
    cost: 50 + (Number.isFinite(closest) ? closest : 50),
  };
};

// ------------------------------------------------------------ Nelder-Mead

const nelderMead = (
  cost: (a: number, e: number) => number,
  seed: [number, number],
  maxIterations: number,
  tolerance: number,
): { point: [number, number]; value: number; iterations: number } => {
  const step = 3; // grados
  let simplex: { p: [number, number]; v: number }[] = [
    { p: seed, v: cost(seed[0], seed[1]) },
    { p: [seed[0] + step, seed[1]], v: cost(seed[0] + step, seed[1]) },
    { p: [seed[0], seed[1] + step], v: cost(seed[0], seed[1] + step) },
  ];

  const centroidOf = (pts: [number, number][]): [number, number] => [
    (pts[0]![0] + pts[1]![0]) / 2,
    (pts[0]![1] + pts[1]![1]) / 2,
  ];

  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    simplex.sort((a, b) => a.v - b.v);
    const best = simplex[0]!;
    const worst = simplex[2]!;
    if (best.v < tolerance) break;

    const c = centroidOf([simplex[0]!.p, simplex[1]!.p]);
    const reflectP: [number, number] = [
      c[0] + (c[0] - worst.p[0]),
      c[1] + (c[1] - worst.p[1]),
    ];
    const reflectV = cost(reflectP[0], reflectP[1]);

    if (reflectV < best.v) {
      const expandP: [number, number] = [
        c[0] + 2 * (c[0] - worst.p[0]),
        c[1] + 2 * (c[1] - worst.p[1]),
      ];
      const expandV = cost(expandP[0], expandP[1]);
      simplex[2] = expandV < reflectV
        ? { p: expandP, v: expandV }
        : { p: reflectP, v: reflectV };
    } else if (reflectV < simplex[1]!.v) {
      simplex[2] = { p: reflectP, v: reflectV };
    } else {
      const contractP: [number, number] = [
        c[0] + 0.5 * (worst.p[0] - c[0]),
        c[1] + 0.5 * (worst.p[1] - c[1]),
      ];
      const contractV = cost(contractP[0], contractP[1]);
      if (contractV < worst.v) {
        simplex[2] = { p: contractP, v: contractV };
      } else {
        // Encoger todo el simplex hacia el mejor.
        simplex = simplex.map((s, i) =>
          i === 0
            ? s
            : {
                p: [
                  best.p[0] + 0.5 * (s.p[0] - best.p[0]),
                  best.p[1] + 0.5 * (s.p[1] - best.p[1]),
                ] as [number, number],
                v: cost(
                  best.p[0] + 0.5 * (s.p[0] - best.p[0]),
                  best.p[1] + 0.5 * (s.p[1] - best.p[1]),
                ),
              },
        );
      }
    }
  }

  simplex.sort((a, b) => a.v - b.v);
  return { point: simplex[0]!.p, value: simplex[0]!.v, iterations };
};

// ------------------------------------------------------------------ Newton

const newton = (
  opts: SolveOptions,
  target: AimTarget,
  seed: [number, number],
  speed: number,
  maxIterations: number,
  tolerance: number,
): { point: [number, number]; value: number; iterations: number } => {
  const h = 0.2; // grados, para el jacobiano numerico
  let [az, el] = seed;
  let best: [number, number] = [az, el];
  let bestCost = evaluate(opts, target, az, el, speed).cost;
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const base = evaluate(opts, target, az, el, speed);
    if (!base.residual) break; // sin residuo no hay Newton posible
    if (base.cost < tolerance) {
      return { point: [az, el], value: base.cost, iterations };
    }

    const dAz = evaluate(opts, target, az + h, el, speed).residual;
    const dEl = evaluate(opts, target, az, el + h, speed).residual;
    if (!dAz || !dEl) break;

    // Jacobiano por diferencias finitas.
    const j11 = (dAz[0] - base.residual[0]) / h;
    const j21 = (dAz[1] - base.residual[1]) / h;
    const j12 = (dEl[0] - base.residual[0]) / h;
    const j22 = (dEl[1] - base.residual[1]) / h;

    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-9) break; // jacobiano singular: a Nelder-Mead

    const stepAz = (-base.residual[0] * j22 + base.residual[1] * j12) / det;
    const stepEl = (-base.residual[1] * j11 + base.residual[0] * j21) / det;

    // Busqueda de linea: si el paso completo empeora, se acorta. Sin esto
    // Newton se dispara en cuanto el objetivo esta cerca de una esquina.
    let damping = 1;
    let improved = false;
    for (let k = 0; k < 6; k++) {
      const tryAz = az + stepAz * damping;
      const tryEl = el + stepEl * damping;
      const tryCost = evaluate(opts, target, tryAz, tryEl, speed).cost;
      if (tryCost < base.cost) {
        az = tryAz;
        el = tryEl;
        if (tryCost < bestCost) {
          bestCost = tryCost;
          best = [az, el];
        }
        improved = true;
        break;
      }
      damping *= 0.5;
    }
    if (!improved) break;
  }

  return { point: best, value: bestCost, iterations };
};

// -------------------------------------------------------------- resolver

export const solveAim = (
  opts: SolveOptions,
  target: AimTarget,
): SolveResult => {
  const tolerance = opts.tolerance ?? 0.05;
  const maxIterations = opts.maxIterations ?? 40;

  const seed = mirrorSolution(opts.origin, target);
  const seedAngles: [number, number] = [seed.azimuthDeg, seed.elevationDeg];

  const finish = (
    az: number,
    el: number,
    speed: number,
    method: SolveMethod,
    iterations: number,
    note: string,
  ): SolveResult => {
    const ev = evaluate(opts, target, az, el, speed);
    const mirrored = mirrorSolution(opts.origin, target).mirrored;
    return {
      ok: ev.cost <= tolerance,
      azimuthDeg: az,
      elevationDeg: el,
      speed,
      error: ev.cost,
      iterations,
      method,
      aimPoint: frontWallAimPoint(opts.origin, mirrored),
      trajectory: ev.trajectory,
      note,
    };
  };

  // --- motor geometrico y primer bote: solucion exacta, sin iterar ---
  if (opts.model === 'geometric' && target.bounceIndex === 1) {
    const direct = finish(
      seed.azimuthDeg,
      seed.elevationDeg,
      opts.speed,
      'espejo',
      0,
      'Solucion exacta por el metodo del espejo: apunta al reflejo del objetivo al otro lado de la pared frontal.',
    );
    if (direct.ok) return direct;
    // Si el camino recto choca antes con una lateral, hay que iterar.
  }

  const speeds = opts.searchSpeed
    ? [opts.speed, opts.speed * 0.75, opts.speed * 1.25, 30, 45, 60, 75]
    : [opts.speed];

  let bestResult: SolveResult | null = null;

  for (const speed of speeds) {
    const n = newton(opts, target, seedAngles, speed, maxIterations, tolerance);
    let candidate = finish(
      n.point[0],
      n.point[1],
      speed,
      'newton',
      n.iterations,
      'Metodo de disparo: Newton de dos variables partiendo de la solucion geometrica.',
    );

    if (!candidate.ok) {
      const nm = nelderMead(
        (a, e) => evaluate(opts, target, a, e, speed).cost,
        n.value < 50 ? n.point : seedAngles,
        maxIterations * 4,
        tolerance,
      );
      const fallback = finish(
        nm.point[0],
        nm.point[1],
        speed,
        'nelder-mead',
        n.iterations + nm.iterations,
        'Newton no converge aqui, asi que remata Nelder-Mead.',
      );
      if (fallback.error < candidate.error) candidate = fallback;
    }

    if (!bestResult || candidate.error < bestResult.error) {
      bestResult = candidate;
    }
    if (bestResult.ok) break;
  }

  if (!bestResult) {
    return finish(
      seed.azimuthDeg,
      seed.elevationDeg,
      opts.speed,
      'ninguno',
      0,
      'No se ha podido resolver.',
    );
  }

  if (!bestResult.ok) {
    bestResult.note = `No hay tiro que caiga exactamente ahi con estos datos. Lo mas cerca que se llega es ${bestResult.error.toFixed(2)} m.`;
  }
  return bestResult;
};

/** Objetivos con nombre, los que un entrenador pide de verdad. */
export const NAMED_TARGETS: {
  id: string;
  label: string;
  x: number;
  z: number;
  bounceIndex: 1 | 2;
}[] = [
  { id: 'rear-left', label: 'Rincon trasero izquierdo', x: 0.6, z: 11.3, bounceIndex: 1 },
  { id: 'rear-right', label: 'Rincon trasero derecho', x: 5.5, z: 11.3, bounceIndex: 1 },
  { id: 'deep-center', label: 'Fondo, al centro', x: 3.05, z: 10.8, bounceIndex: 1 },
  { id: 'front-left', label: 'Esquina delantera izquierda', x: 0.7, z: 1.2, bounceIndex: 1 },
  { id: 'front-right', label: 'Esquina delantera derecha', x: 5.4, z: 1.2, bounceIndex: 1 },
  { id: 'short-left', label: 'Justo pasada la short line, izquierda', x: 1.6, z: 6.6, bounceIndex: 1 },
  { id: 'short-right', label: 'Justo pasada la short line, derecha', x: 4.5, z: 6.6, bounceIndex: 1 },
];
