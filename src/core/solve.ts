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

import { readableSequence } from './contacts.js';
import { CENTER_BOX } from './court.js';
import { CLASS_LABEL, classify } from './rules.js';
import { simulate } from './engine.js';
import type { PhysicsModel, Shot, Trajectory, Vec3, VenuePhysics } from './types.js';
import { fromAzimuthElevation, normalize, sub } from './vec3.js';

/** Que bote de PISO se quiere colocar. Solo los tres primeros importan. */
export type BounceIndex = 1 | 2 | 3;

export interface AimTarget {
  /** Donde debe caer la pelota, en el piso. */
  x: number;
  z: number;
  /** Que bote de PISO debe caer ahi (no que contacto). 1 = el primero. */
  bounceIndex: BounceIndex;
}

export interface SolveOptions {
  /**
   * Angulos desde los que empezar a buscar, antes que la semilla del
   * espejo. Al arrastrar un bote se pasa el tiro ACTUAL: casi siempre hay
   * varios tiros que dejan el bote en el mismo sitio, y el natural es el
   * mas parecido al que ya se tenia. Sin esto, arrastrar el 2.º bote de un
   * pase podia devolver un kill que llega rebotando de la trasera: legal,
   * pero de otra familia de tiros.
   */
  seed?: [number, number];
  /**
   * Donde caian los botes de piso ANTERIORES al que se arrastra (el 1.º si
   * se arrastra el 2.º; el 1.º y el 2.º si se arrastra el 3.º). De todas
   * las soluciones posibles gana la que menos los mueve: se mueve lo que
   * se agarra y nada mas. Comparar angulos no basta: para dejar el 2.º
   * bote en el rincon derecho hay un kill y un pase cruzado con angulos
   * parecidos, pero el kill arrastra el 1.er bote ocho metros hacia la
   * frontal y el pase lo deja cerca de donde estaba.
   */
  keepBounces?: { x: number; z: number }[];
  /** Primera superficie que tocaba el tiro de partida: se intenta conservar. */
  firstSurface?: import('./types.js').SurfaceId;
  origin: Vec3;
  speed: number;
  model: PhysicsModel;
  /**
   * El aire, la pelota y las superficies del sitio de juego
   * (`venueSimOptions`). Sin esto el solver apuntaria con el aire de nivel
   * del mar aunque se juegue en El Alto, y el bote caeria en otro sitio.
   */
  physics?: VenuePhysics;
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
  /**
   * Otras FORMAS de dejar el bote en el mismo sitio, una por familia de
   * tiro (secuencia de contactos distinta). Casi siempre hay varias: un
   * kill, un pase cruzado, un ceiling... Es lo que diria un entrenador, y
   * se ensena en vez de esconderlo.
   */
  alternatives?: Alternative[];
  /** Secuencia de contactos hasta el bote pedido, "F → D → bote 1 → bote 2". */
  family?: string;
  /** Tipo de tiro: "passing shot", "kill shot"... */
  kindLabel?: string;
}

export interface Alternative {
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
  error: number;
  family: string;
  kindLabel: string;
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

/**
 * Simulacion para el solver. Para en cuanto la pelota da el bote de piso
 * pedido: lo que pase despues no cambia la respuesta y costaria el doble.
 * Paso de fisica identico al de la vista, asi que el bote cae exactamente
 * en el mismo sitio que despues se dibuja.
 */
const runShot = (
  origin: Vec3,
  azimuthDeg: number,
  elevationDeg: number,
  speed: number,
  model: PhysicsModel,
  bounceIndex: BounceIndex,
  physics: SolveOptions['physics'],
): Trajectory => {
  const shot: Shot = {
    origin,
    direction: fromAzimuthElevation(azimuthDeg, elevationDeg),
    speed,
  };
  return simulate(shot, {
    ...physics,
    model,
    maxBounces: 12,
    stopAfterFloorBounces: bounceIndex,
    sampleDt: 1 / 60,
  });
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
    target.bounceIndex,
    opts.physics,
  );
  const floors = trajectory.bounces.filter((b) => b.surface === 'floor');
  const wanted = floors[target.bounceIndex - 1];

  // Solo valen tiros LEGALES: la pelota tiene que tocar la frontal antes
  // que el piso. Sin esta condicion el solver "resolvia" objetivos
  // imposibles tirando al suelo: un skip bota donde uno quiera, pero el
  // punto ya esta perdido y su 2.º bote no significa nada.
  const frontAt = trajectory.bounces.findIndex((b) => b.surface === 'front');
  const floorAt = trajectory.bounces.findIndex((b) => b.surface === 'floor');
  const legal = frontAt !== -1 && (floorAt === -1 || frontAt < floorAt);

  if (wanted && legal) {
    const dx = wanted.point.x - target.x;
    const dz = wanted.point.z - target.z;
    return {
      trajectory,
      residual: [dx, dz],
      cost: Math.hypot(dx, dz),
    };
  }

  // No hay bote legal donde se pedia. El coste tiene que seguir guiando la
  // busqueda, asi que se mide lo mas cerca que pasa la trayectoria del
  // objetivo, con una penalizacion que la mantenga siempre peor que
  // cualquier solucion valida. Un skip se penaliza aun mas: esta
  // "cerca" en el espacio de angulos pero es la peor respuesta posible.
  let closest = Infinity;
  for (const s of trajectory.samples) {
    const d = Math.hypot(s.p.x - target.x, s.p.z - target.z);
    if (d < closest) closest = d;
  }
  return {
    trajectory,
    residual: null,
    cost: (legal ? 50 : 80) + (Number.isFinite(closest) ? closest : 50),
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

// ------------------------------------------------------ barrido de semillas

/**
 * Semillas por barrido grueso de todo el abanico frontal.
 *
 * La semilla del espejo es excelente para el PRIMER bote, pero para el
 * segundo o el tercero apunta al sitio equivocado: coloca el primer bote
 * en el objetivo, con lo que los siguientes caen mas atras. Y los tiros
 * que pasan por una lateral (Z, around-the-world) viven en otra region
 * del espacio de angulos. Un barrido grueso de 10° encuentra la cuenca
 * correcta; Newton y Nelder-Mead afinan desde ahi.
 */
const scanSeeds = (
  cost: (az: number, el: number) => number,
  count: number,
): [number, number][] => {
  const cells: { p: [number, number]; v: number }[] = [];
  for (let az = -80; az <= 80; az += 10) {
    for (let el = -20; el <= 60; el += 10) {
      cells.push({ p: [az, el], v: cost(az, el) });
    }
  }
  cells.sort((a, b) => a.v - b.v);

  const picked: [number, number][] = [];
  for (const c of cells) {
    if (picked.length >= count) break;
    const far = picked.every(
      (q) => Math.abs(q[0] - c.p[0]) >= 15 || Math.abs(q[1] - c.p[1]) >= 15,
    );
    if (far) picked.push(c.p);
  }
  return picked;
};

/** Velocidades a probar si se deja buscar la fuerza: la actual primero. */
const speedCandidates = (current: number, search: boolean): number[] => {
  if (!search) return [current];
  const raw = [current, current * 0.8, current * 1.25, current * 0.6, current * 1.55, 30, 50, 70];
  const out: number[] = [];
  for (const v of raw) {
    const clamped = Math.min(Math.max(v, 10), 90);
    if (out.every((u) => Math.abs(u - clamped) > 3)) out.push(clamped);
  }
  return out;
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
    // El punto de mira que se ensena es donde la pelota de verdad pega en
    // la frontal. La recta del espejo solo coincide con eso en el motor
    // geometrico: con gravedad el tiro se curva y pega mas abajo.
    const front = ev.trajectory.bounces.find((b) => b.surface === 'front');
    return {
      ok: ev.cost <= tolerance,
      azimuthDeg: az,
      elevationDeg: el,
      speed,
      error: ev.cost,
      iterations,
      method,
      aimPoint: front
        ? front.point
        : frontWallAimPoint(opts.origin, seed.mirrored),
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

  let best: SolveResult | null = null;
  const consider = (r: SolveResult): boolean => {
    if (!best || r.error < best.error) best = r;
    return r.ok;
  };

  /**
   * Cuanto se aleja una solucion de lo que se tenia. Tres terminos:
   *   - cuanto se mueven los botes de piso ANTERIORES al que se arrastra
   *     (se mueve lo que se agarra y nada mas);
   *   - cambiar la primera superficie que toca la pelota cuesta como si un
   *     bote se moviera 6 m: si el tiro abria por la frontal, que siga
   *     abriendo por la frontal y no se convierta en uno que abre por la
   *     lateral;
   *   - un pequeno termino de angulos para desempatar, con la elevacion
   *     pesando el triple: es la que decide si es un kill, un pase o un globo.
   * Heuristico a proposito, y por eso las demas soluciones se ofrecen como
   * alternativas en vez de descartarse.
   */
  const keep = opts.keepBounces ?? [];
  const reference = opts.seed ?? seedAngles;
  const firstSurface = opts.firstSurface;
  const distance = (r: SolveResult): number => {
    const angles = Math.hypot(r.azimuthDeg - reference[0], 3 * (r.elevationDeg - reference[1]));
    if (!r.trajectory) return angles;
    const floors = r.trajectory.bounces.filter((b) => b.surface === 'floor');
    const moved = keep.reduce((sum, k, i) => {
      const b = floors[i];
      return sum + (b ? Math.hypot(b.point.x - k.x, b.point.z - k.z) : 30);
    }, 0);
    const first = r.trajectory.bounces[0]?.surface;
    const changedFamily = firstSurface && first && first !== firstSurface ? 6 : 0;
    return moved + changedFamily + 0.02 * angles;
  };
  const wantsRanking = !!opts.seed || keep.length > 0;

  for (const speed of speedCandidates(opts.speed, !!opts.searchSpeed)) {
    const cost = (a: number, e: number) => evaluate(opts, target, a, e, speed).cost;
    const solutions: SolveResult[] = [];
    let iterations = 0;
    let bestLocal: { point: [number, number]; value: number } | null = null;

    const tryFrom = (from: [number, number], note: string): SolveResult => {
      const n = newton(opts, target, from, speed, maxIterations, tolerance);
      iterations += n.iterations;
      if (!bestLocal || n.value < bestLocal.value) bestLocal = { point: n.point, value: n.value };
      const r = finish(n.point[0], n.point[1], speed, 'newton', iterations, note);
      consider(r);
      if (r.ok) solutions.push(r);
      return r;
    };

    // 0. Desde el tiro que ya se tenia: para un arrastre corto suele ser
    //    ya la mejor respuesta, y compite con las demas en igualdad.
    if (opts.seed) {
      tryFrom(opts.seed, 'Metodo de disparo: Newton partiendo del tiro que ya tenias.');
    }

    // 1. Desde la semilla del espejo. Sin nada que conservar, si converge
    //    es la respuesta: para el 1.er bote es el camino directo.
    const fast = tryFrom(seedAngles,
      'Metodo de disparo: Newton de dos variables partiendo de la solucion geometrica.');
    if (fast.ok && !wantsRanking) break;

    // 2. Barrido: reunir TODAS las soluciones que salgan y quedarse con la
    //    mas parecida. Casi siempre hay varias familias (kill, pase,
    //    ceiling, tiros que abren por la lateral) y parar en la primera
    //    daba respuestas de otra familia de tiros.
    for (const seedCell of scanSeeds(cost, 8)) {
      tryFrom(seedCell, 'Metodo de disparo: barrido de semillas y Newton; de todas las soluciones, la que menos cambia tu tiro.');
    }
    if (solutions.length > 0) {
      solutions.sort((a, b) => distance(a) - distance(b));
      best = solutions[0]!;
      best.alternatives = distinctFamilies(opts, target, solutions);
      break;
    }

    // 3. Remate con Nelder-Mead desde lo mejor que se tenga.
    const from = (bestLocal as { point: [number, number] } | null)?.point ?? seedAngles;
    const nm = nelderMead(cost, from, maxIterations * 4, tolerance);
    if (
      consider(
        finish(nm.point[0], nm.point[1], speed, 'nelder-mead', iterations + nm.iterations,
          'Newton no converge aqui, asi que remata Nelder-Mead.'),
      )
    ) break;
  }

  const result: SolveResult =
    best ??
    finish(seed.azimuthDeg, seed.elevationDeg, opts.speed, 'ninguno', 0, 'No se ha podido resolver.');

  if (!result.ok) {
    result.note = `No hay tiro que caiga exactamente ahi con estos datos. Lo mas cerca que se llega es ${result.error.toFixed(2)} m.`;
  } else {
    const described = describe(opts, target, result.azimuthDeg, result.elevationDeg, result.speed);
    result.family = described.family;
    result.kindLabel = described.kindLabel;
  }
  return result;
};

/**
 * Arrastre EN VIVO de un bote: Newton desde el tiro actual, sin barrido
 * de semillas ni alternativas. Cada movimiento del puntero mueve el
 * objetivo unos centimetros, asi que el tiro que ya se tenia esta en la
 * cuenca buena: converge en 1-3 iteraciones (unas 10 simulaciones cortas,
 * milisegundos). Si no converge, `ok` es false y la vista se queda con el
 * ultimo tiro bueno; al soltar se resuelve entero con `solveAim`.
 *
 * Mantiene la familia de tiro (el pase sigue siendo pase mientras se
 * arrastra) porque parte del tiro de antes: es lo que se espera al mover
 * un bote con el dedo.
 */
export const refineAim = (
  opts: SolveOptions,
  target: AimTarget,
  from: [number, number],
  maxIterations = 6,
): SolveResult => {
  const tolerance = opts.tolerance ?? 0.05;
  // Se afina a 1 cm aunque baste con 5: si cada paso se quedara justo en
  // el borde de la tolerancia, el siguiente empezaria ya fuera y al rato
  // el arrastre "se soltaria" sin haber cambiado de familia de tiro.
  const inner = Math.min(tolerance, 0.01);
  const n = newton(opts, target, from, opts.speed, maxIterations, inner);
  let az = n.point[0];
  let el = n.point[1];
  let speed = opts.speed;
  let ev = evaluate(opts, target, az, el, speed);
  let iterations = n.iterations;

  // Con esa fuerza no llega: si se deja buscar la velocidad, se mueve
  // tambien la fuerza, lo minimo, para que el bote siga al dedo.
  if (ev.cost > tolerance && opts.searchSpeed) {
    const g = gaussNewton3(opts, target, [az, el, speed], maxIterations, inner);
    iterations += g.iterations;
    const evG = evaluate(opts, target, g.point[0], g.point[1], g.point[2]);
    if (evG.cost < ev.cost) {
      [az, el, speed] = g.point;
      ev = evG;
    }
  }

  const front = ev.trajectory.bounces.find((b) => b.surface === 'front');
  return {
    ok: ev.cost <= tolerance,
    azimuthDeg: az,
    elevationDeg: el,
    speed,
    error: ev.cost,
    iterations,
    method: 'newton',
    aimPoint: front ? front.point : null,
    trajectory: ev.trajectory,
    note:
      speed !== opts.speed
        ? 'Arrastre en vivo: con la fuerza que habia no llegaba, asi que tambien se ajusta la velocidad.'
        : 'Arrastre en vivo: Newton desde el tiro que ya tenias.',
  };
};

/**
 * Gauss-Newton de TRES variables (azimut, elevacion, velocidad) para dos
 * residuos (x, z del bote): hay una variable de sobra, asi que cada paso
 * es el de norma minima, delta = -J^T (J J^T)^-1 r, que cambia lo menos
 * posible el tiro. 1 m/s pesa como 1 grado.
 */
const gaussNewton3 = (
  opts: SolveOptions,
  target: AimTarget,
  seed: [number, number, number],
  maxIterations: number,
  tolerance: number,
): { point: [number, number, number]; iterations: number } => {
  const h: [number, number, number] = [0.2, 0.2, 0.3];
  const vMin = 10;
  const vMax = 90;
  let p: [number, number, number] = [...seed];
  let base = evaluate(opts, target, p[0], p[1], p[2]);
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    if (!base.residual || base.cost < tolerance) break;
    const r = base.residual;
    const cols: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const q: [number, number, number] = [...p];
      q[i] = q[i]! + h[i]!;
      const d = evaluate(opts, target, q[0], q[1], q[2]).residual;
      if (!d) return { point: p, iterations };
      cols.push([(d[0] - r[0]) / h[i]!, (d[1] - r[1]) / h[i]!]);
    }
    // J J^T (2x2) y su inversa.
    let a = 0;
    let b = 0;
    let d = 0;
    for (const [c0, c1] of cols) {
      a += c0 * c0;
      b += c0 * c1;
      d += c1 * c1;
    }
    const det = a * d - b * b;
    if (Math.abs(det) < 1e-12) break;
    const y0 = (d * r[0] - b * r[1]) / det;
    const y1 = (-b * r[0] + a * r[1]) / det;
    const step = cols.map(([c0, c1]) => -(c0 * y0 + c1 * y1)) as [number, number, number];

    let damping = 1;
    let improved = false;
    for (let k = 0; k < 6; k++) {
      const q: [number, number, number] = [
        p[0] + step[0] * damping,
        p[1] + step[1] * damping,
        Math.min(vMax, Math.max(vMin, p[2] + step[2] * damping)),
      ];
      const ev = evaluate(opts, target, q[0], q[1], q[2]);
      if (ev.cost < base.cost) {
        p = q;
        base = ev;
        improved = true;
        break;
      }
      damping *= 0.5;
    }
    if (!improved) break;
  }
  return { point: p, iterations };
};

/** Familia (secuencia de contactos) y tipo de tiro de una solucion. */
const describe = (
  opts: SolveOptions,
  target: AimTarget,
  azimuthDeg: number,
  elevationDeg: number,
  speed: number,
): { family: string; kindLabel: string } => {
  const shot: Shot = {
    origin: opts.origin,
    direction: fromAzimuthElevation(azimuthDeg, elevationDeg),
    speed,
  };
  // Para clasificar hace falta el tiro entero, no el recortado del solver.
  const full = simulate(shot, { ...opts.physics, model: opts.model });
  const upToTarget = simulate(shot, {
    ...opts.physics,
    model: opts.model,
    maxBounces: 12,
    stopAfterFloorBounces: target.bounceIndex,
    sampleDt: 1 / 30,
  });
  return {
    family: readableSequence(upToTarget, 12),
    kindLabel: CLASS_LABEL[classify(full, opts.origin).classification],
  };
};

/**
 * Una solucion por TIPO de tiro (pase, kill, pinch, ceiling...), la mejor
 * de cada tipo, y como mucho cuatro. Por secuencia de contactos salian
 * nueve opciones con tipos repetidos, y una lista asi no se lee.
 */
const MAX_ALTERNATIVES = 4;
const distinctFamilies = (
  opts: SolveOptions,
  target: AimTarget,
  solutions: SolveResult[],
): Alternative[] => {
  const byFamily = new Map<string, Alternative>();
  for (const r of solutions) {
    if (byFamily.size >= MAX_ALTERNATIVES) break;
    const d = describe(opts, target, r.azimuthDeg, r.elevationDeg, r.speed);
    if (byFamily.has(d.kindLabel)) continue;
    byFamily.set(d.kindLabel, {
      azimuthDeg: r.azimuthDeg,
      elevationDeg: r.elevationDeg,
      speed: r.speed,
      error: r.error,
      family: d.family,
      kindLabel: d.kindLabel,
    });
  }
  return [...byFamily.values()];
};

/** Objetivos con nombre, los que un entrenador pide de verdad. */
export const NAMED_TARGETS: {
  id: string;
  label: string;
  x: number;
  z: number;
  bounceIndex: BounceIndex;
}[] = [
  { id: 'rear-left', label: 'Rincon trasero izquierdo', x: 0.6, z: 11.3, bounceIndex: 1 },
  { id: 'rear-right', label: 'Rincon trasero derecho', x: 5.5, z: 11.3, bounceIndex: 1 },
  { id: 'deep-center', label: 'Fondo, al centro', x: 3.05, z: 10.8, bounceIndex: 1 },
  { id: 'front-left', label: 'Esquina delantera izquierda', x: 0.7, z: 1.2, bounceIndex: 1 },
  { id: 'front-right', label: 'Esquina delantera derecha', x: 5.4, z: 1.2, bounceIndex: 1 },
  { id: 'short-left', label: 'Justo pasada la short line, izquierda', x: 1.6, z: 6.6, bounceIndex: 1 },
  { id: 'short-right', label: 'Justo pasada la short line, derecha', x: 4.5, z: 6.6, bounceIndex: 1 },
];
