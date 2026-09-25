/**
 * Botes de piso y rebotes de pared: dos cosas distintas.
 *
 * En racquetball un BOTE es tocar el PISO. Tocar una pared sin tocar el
 * piso es un REBOTE DE PARED. Lo que decide el punto son los botes de
 * piso: cuantos da la pelota y donde. Por eso el piso se numera aparte
 * (1, 2, 3...) y las paredes se marcan con su inicial, sin numero de
 * bote. Un Z serve se lee "F -> D -> 1", no "1 -> 2 -> 3".
 *
 * El techo va con las paredes: tampoco es un bote.
 *
 * Todo se deriva de `Bounce.surface`, que el motor ya guarda. El contrato
 * `Trajectory` no se toca.
 */

import type { Bounce, SurfaceId, Trajectory } from './types.js';

export type ContactKind = 'floor' | 'wall';

/** Inicial de cada superficie que no es el piso. */
export type WallCode = 'F' | 'I' | 'D' | 'T' | 'C';

export const WALL_CODE: Record<Exclude<SurfaceId, 'floor'>, WallCode> = {
  front: 'F',
  left: 'I',
  right: 'D',
  back: 'T',
  ceiling: 'C',
};

export const WALL_NAME: Record<WallCode, string> = {
  F: 'frontal',
  I: 'lateral izquierda',
  D: 'lateral derecha',
  T: 'trasera',
  C: 'techo',
};

/** Los botes de piso que importan de verdad. Del 4.º en adelante, se atenuan. */
export const PRIMARY_FLOOR_BOUNCES = 3;

export interface Contact {
  bounce: Bounce;
  kind: ContactKind;
  /** Solo en el piso: 1, 2, 3... contando UNICAMENTE los botes de piso. */
  floorIndex: number | null;
  /** Solo en paredes y techo: su inicial. */
  wallCode: WallCode | null;
  /** Texto del marcador: "1", "2"... en el piso; "F", "D"... en paredes. */
  label: string;
  /** Uno de los tres primeros botes de piso. */
  primary: boolean;
  /**
   * El PRIMER contacto del tiro es el piso: la pelota no llego a la
   * frontal. Es un skip y el punto se pierde.
   */
  skip: boolean;
  /** Piso: desde aqui la pelota rueda, ya no bota. */
  rolling: boolean;
  /** Pared: toco el crack en la franja y salio rodando (nick). */
  nick: boolean;
}

export const floorBounces = (t: Trajectory): Bounce[] =>
  t.bounces.filter((b) => b.surface === 'floor');

/** El k-esimo bote de PISO (1 = el primero), o null si no lo hay. */
export const floorBounce = (t: Trajectory, k: number): Bounce | null =>
  floorBounces(t)[k - 1] ?? null;

/** El tiro toca el piso antes que ninguna otra cosa. */
export const isSkip = (t: Trajectory): boolean =>
  t.bounces[0]?.surface === 'floor';

export const labelContacts = (t: Trajectory): Contact[] => {
  let floorCount = 0;
  return t.bounces.map((bounce, i) => {
    if (bounce.surface === 'floor') {
      floorCount++;
      return {
        bounce,
        kind: 'floor',
        floorIndex: floorCount,
        wallCode: null,
        label: String(floorCount),
        primary: floorCount <= PRIMARY_FLOOR_BOUNCES,
        skip: i === 0,
        rolling: !!bounce.rolling,
        nick: false,
      };
    }
    const wallCode = WALL_CODE[bounce.surface];
    return {
      bounce,
      kind: 'wall',
      floorIndex: null,
      wallCode,
      label: wallCode,
      primary: false,
      skip: false,
      rolling: false,
      nick: !!bounce.rollout,
    };
  });
};

/**
 * "F → D → bote 1 → T → bote 2": como lo cantaria un jugador. Un skip se
 * canta como lo que es, PISO, no como un bote mas. Un nick, como lo que
 * es: "D (nick) → bote 1 rodando".
 */
export const readableSequence = (t: Trajectory, limit = 12): string =>
  labelContacts(t)
    .slice(0, limit)
    .map((c) =>
      c.skip
        ? 'PISO'
        : c.kind === 'floor'
          ? `bote ${c.label}${c.rolling ? ' rodando' : ''}`
          : `${c.label}${c.nick ? ' (nick)' : ''}`,
    )
    .join(' → ');

/**
 * Cuantos botes de piso lleva la pelota al empezar cada tramo de
 * `splitByBounce` (el tramo i empieza justo despues del contacto i).
 * Es lo que decide cuanto se atenua cada tramo al dibujarlo: la
 * trayectoria se lee por botes de piso, no por contactos.
 */
export const floorCountPerSegment = (t: Trajectory): number[] => {
  const counts = [0];
  let floors = 0;
  for (const b of t.bounces) {
    if (b.surface === 'floor') floors++;
    counts.push(floors);
  }
  return counts;
};

/**
 * Opacidad de un tramo segun los botes de piso que lleva la pelota. Tras
 * un skip, todo lo que sigue ya no cuenta y se apaga casi del todo.
 */
export const segmentOpacity = (floorsSoFar: number, afterSkip: boolean): number => {
  if (afterSkip) return 0.16;
  if (floorsSoFar === 0) return 1;
  if (floorsSoFar === 1) return 0.82;
  if (floorsSoFar === 2) return 0.64;
  if (floorsSoFar === 3) return 0.46;
  return 0.26;
};
