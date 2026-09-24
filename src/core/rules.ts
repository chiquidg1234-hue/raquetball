/**
 * FASE 8 — Reglas, faltas y clasificacion del tiro.
 *
 * Funciones puras sobre `Trajectory`. Baratas de escribir y multiplican el
 * valor didactico: convierten un dibujo bonito en un juicio que se puede
 * discutir.
 *
 * NOTA SOBRE UNA REGLA DEL SPEC QUE NO SE SIGUE AL PIE DE LA LETRA
 * -----------------------------------------------------------------
 * El spec dice: "Si pega una lateral antes del piso -> three-wall serve,
 * falta". Eso marcaria como falta el Z serve, que es un saque legal y esta
 * en la lista de presets del propio spec. La regla real del racquetball es
 * que el saque es falta si toca TRES paredes (la frontal y otras dos)
 * antes de botar. Un saque que toca frontal y UNA lateral es legal: es
 * exactamente el Z serve. Se implementa la regla real y se deja dicho
 * aqui, porque es una contradiccion del documento consigo mismo, no un
 * descuido de lectura.
 */

import { COURT } from './constants.js';
import type { Bounce, SurfaceId, Trajectory, Vec3 } from './types.js';

/** Profundidad a la que se mide la altura de paso. Ver `deepHeight`. */
export const DEEP_PROBE_Z = 11;

export type ServeFault =
  | 'no-front'
  | 'short'
  | 'long'
  | 'three-wall'
  | 'ceiling';

export interface ServeJudgement {
  legal: boolean;
  fault: ServeFault | null;
  label: string;
  detail: string;
}

export type ReturnFault = 'no-front' | 'skip';

export interface ReturnJudgement {
  legal: boolean;
  fault: ReturnFault | null;
  label: string;
  detail: string;
}

export type ShotClass =
  | 'kill'
  | 'pass'
  | 'ceiling'
  | 'pinch'
  | 'splat'
  | 'Z'
  | 'skip'
  | 'setup'
  | 'otro';

export interface ShotAnalysis {
  classification: ShotClass;
  classLabel: string;
  classDetail: string;
  ret: ReturnJudgement;
  /** Solo cuando el modo saque esta activo. */
  serve: ServeJudgement | null;
  /** Altura del impacto en la pared frontal, si lo hay. */
  frontImpactHeight: number | null;
  firstFloor: Bounce | null;
  secondFloor: Bounce | null;
  /**
   * Altura a la que la pelota cruza Z = 11 m despues de su primer bote.
   * Es la lectura de "altura del segundo bote en Z = 11 m" del spec: el
   * mejor predictor de si un passing shot es ganador o un regalo. Por
   * debajo de un metro el rival no la levanta; por encima de metro y
   * medio, se la come.
   */
  deepHeight: number | null;
}

const SIDE_WALLS: SurfaceId[] = ['left', 'right'];

const isSide = (s: SurfaceId): boolean => SIDE_WALLS.includes(s);

const floorBounces = (t: Trajectory): Bounce[] =>
  t.bounces.filter((b) => b.surface === 'floor');

/** Indice del primer rebote en la frontal, o -1. */
const frontIndex = (t: Trajectory): number =>
  t.bounces.findIndex((b) => b.surface === 'front');

// ------------------------------------------------------------- devolucion

export const judgeReturn = (t: Trajectory): ReturnJudgement => {
  const first = t.bounces[0];

  if (!first) {
    return {
      legal: false,
      fault: 'no-front',
      label: 'sin contacto',
      detail: 'La pelota no llega a tocar ninguna superficie.',
    };
  }

  if (first.surface === 'floor') {
    return {
      legal: false,
      fault: 'skip',
      label: 'skip ball',
      detail: `La pelota toca el piso a ${first.point.z.toFixed(1)} m antes de llegar a la frontal. Punto perdido.`,
    };
  }

  if (first.surface !== 'front') {
    const legal = frontIndex(t) !== -1;
    return {
      legal,
      fault: legal ? null : 'no-front',
      label: legal ? 'legal' : 'ilegal',
      detail: legal
        ? `Toca ${first.surface} antes que la frontal, pero llega a la frontal sin botar: es legal.`
        : 'La pelota nunca llega a la pared frontal. Devolucion ilegal.',
    };
  }

  return {
    legal: true,
    fault: null,
    label: 'legal',
    detail: 'Primer contacto en la pared frontal.',
  };
};

// ------------------------------------------------------------------ saque

export const judgeServe = (t: Trajectory, origin: Vec3): ServeJudgement => {
  const fault = (f: ServeFault, label: string, detail: string): ServeJudgement => ({
    legal: false,
    fault: f,
    label,
    detail,
  });

  const first = t.bounces[0];
  if (!first || first.surface !== 'front') {
    return fault(
      'no-front',
      'falta: no pega en la frontal',
      'El saque tiene que pegar primero en la pared frontal.',
    );
  }

  // Todo lo que pasa antes de que la pelota toque el piso por primera vez.
  const floorAt = t.bounces.findIndex((b) => b.surface === 'floor');
  const beforeFloor = t.bounces.slice(1, floorAt === -1 ? undefined : floorAt);

  if (beforeFloor.some((b) => b.surface === 'ceiling')) {
    return fault(
      'ceiling',
      'falta: toca el techo',
      'Un saque que toca el techo despues de la frontal es falta.',
    );
  }

  if (beforeFloor.some((b) => b.surface === 'back')) {
    return fault(
      'long',
      'falta: saque largo',
      'Llega a la pared trasera sin botar. Saque largo.',
    );
  }

  // Regla real: falta si toca TRES paredes antes de botar, es decir la
  // frontal y otras dos. Frontal + UNA lateral es legal: es el Z serve.
  const wallsAfterFront = beforeFloor.filter((b) => isSide(b.surface)).length;
  if (wallsAfterFront >= 2) {
    return fault(
      'three-wall',
      'falta: saque de tres paredes',
      'Toca la frontal y dos laterales antes de botar.',
    );
  }

  const floor = floorAt === -1 ? undefined : t.bounces[floorAt];
  if (!floor) {
    return fault(
      'long',
      'falta: saque largo',
      'El saque no llega a botar dentro de la cancha.',
    );
  }

  if (floor.point.z <= COURT.shortLine) {
    return fault(
      'short',
      'falta: saque corto',
      `Bota a ${floor.point.z.toFixed(2)} m, antes de la short line (${COURT.shortLine.toFixed(2)} m).`,
    );
  }

  const fromServiceZone =
    origin.z >= COURT.serviceLine && origin.z <= COURT.shortLine;

  return {
    legal: true,
    fault: null,
    label: fromServiceZone ? 'saque legal' : 'legal, pero fuera de la zona',
    detail: fromServiceZone
      ? `Bota a ${floor.point.z.toFixed(2)} m, pasada la short line.`
      : `El bote es bueno, pero el saque sale de z=${origin.z.toFixed(2)} m y la zona de saque va de ${COURT.serviceLine.toFixed(2)} a ${COURT.shortLine.toFixed(2)} m.`,
  };
};

// ------------------------------------------------------- altura profunda

/**
 * Altura a la que la pelota cruza Z = DEEP_PROBE_Z despues de su primer
 * bote en el piso, yendo hacia el fondo. null si nunca llega tan atras.
 */
export const deepHeight = (
  t: Trajectory,
  probeZ = DEEP_PROBE_Z,
): number | null => {
  const first = floorBounces(t)[0];
  if (!first) return null;

  const after = t.samples.filter((s) => s.t > first.time);
  for (let i = 1; i < after.length; i++) {
    const a = after[i - 1]!;
    const b = after[i]!;
    if (a.p.z < probeZ && b.p.z >= probeZ) {
      const k = (probeZ - a.p.z) / (b.p.z - a.p.z);
      return a.p.y + (b.p.y - a.p.y) * k;
    }
  }
  return null;
};

// ---------------------------------------------------------- clasificacion

const CLASS_LABEL: Record<ShotClass, string> = {
  kill: 'kill shot',
  pass: 'passing shot',
  ceiling: 'ceiling ball',
  pinch: 'pinch',
  splat: 'splat',
  Z: 'tiro en Z',
  skip: 'skip',
  setup: 'setup (regalo)',
  otro: 'sin clasificar',
};

export const classify = (
  t: Trajectory,
  origin: Vec3,
): { classification: ShotClass; detail: string } => {
  const bounces = t.bounces;
  const first = bounces[0];
  if (!first) return { classification: 'otro', detail: 'Sin contactos.' };

  if (first.surface === 'floor') {
    return {
      classification: 'skip',
      detail: 'Toca el piso antes que la frontal.',
    };
  }

  if (first.surface === 'ceiling') {
    return {
      classification: 'ceiling',
      detail: 'Techo primero: tiro defensivo para mandar al rival al fondo.',
    };
  }

  const second = bounces[1];
  const floors = floorBounces(t);
  const firstFloor = floors[0];
  const deep = deepHeight(t);

  // Lateral primero y frontal despues: pinch. Si ademas se golpeo pegado
  // a esa lateral, es un splat.
  if (isSide(first.surface) && second?.surface === 'front') {
    const wallX = first.surface === 'left' ? 0 : COURT.width;
    const closeToWall = Math.abs(origin.x - wallX) < 1.15;
    return closeToWall
      ? {
          classification: 'splat',
          detail: 'Lateral a quemarropa y frontal: sale plano y sin altura.',
        }
      : {
          classification: 'pinch',
          detail: 'Lateral y frontal: muere en la esquina.',
        };
  }

  if (first.surface === 'front') {
    const height = first.point.y;

    // Frontal alta cerca de una lateral y luego esa lateral: tiro en Z.
    if (height > 1.9 && second && isSide(second.surface)) {
      return {
        classification: 'Z',
        detail: 'Frontal alta y lateral: cruza la cancha y sale paralelo al fondo.',
      };
    }

    if (height < 0.45) {
      if (firstFloor && firstFloor.point.z < COURT.shortLine) {
        return {
          classification: 'kill',
          detail: `Frontal a ${(height * 100).toFixed(0)} cm y bote antes de la short line.`,
        };
      }
      return {
        classification: 'pass',
        detail: 'Frontal baja, pero el bote se va largo: es un pase, no un kill.',
      };
    }

    if (deep != null && deep > 1.8) {
      return {
        classification: 'setup',
        detail: `Cruza los ${DEEP_PROBE_Z} m a ${deep.toFixed(2)} m de altura: al rival le queda a la altura del hombro.`,
      };
    }

    if (firstFloor && firstFloor.point.z > COURT.shortLine) {
      return {
        classification: 'pass',
        detail: `Bota a ${firstFloor.point.z.toFixed(1)} m${
          deep != null ? ` y cruza los ${DEEP_PROBE_Z} m a ${deep.toFixed(2)} m` : ''
        }.`,
      };
    }
  }

  return { classification: 'otro', detail: 'No encaja en ningun patron conocido.' };
};

// ------------------------------------------------------------------ todo

export const analyse = (
  t: Trajectory,
  origin: Vec3,
  serveMode: boolean,
): ShotAnalysis => {
  const floors = floorBounces(t);
  const front = t.bounces.find((b) => b.surface === 'front');
  const { classification, detail } = classify(t, origin);

  return {
    classification,
    classLabel: CLASS_LABEL[classification],
    classDetail: detail,
    ret: judgeReturn(t),
    serve: serveMode ? judgeServe(t, origin) : null,
    frontImpactHeight: front ? front.point.y : null,
    firstFloor: floors[0] ?? null,
    secondFloor: floors[1] ?? null,
    deepHeight: deepHeight(t),
  };
};

export { CLASS_LABEL };
