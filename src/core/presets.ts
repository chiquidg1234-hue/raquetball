/**
 * FASE 6 — Modo de input C: presets con nombre.
 *
 * Es el modo didactico. Cada preset trae un texto de una linea de CUANDO
 * USARLO; para alguien que esta aprendiendo, ese texto es la mitad del
 * producto.
 *
 * DECISION: un preset guarda un PUNTO AL QUE SE APUNTA, no un azimut fijo.
 *
 * El spec dice "azimut/elevacion/velocidad relativos a la posicion del
 * jugador". Guardar el angulo crudo no cumple esa promesa: un pinch tirado
 * desde el centro y el mismo pinch tirado desde la esquina necesitan
 * angulos distintos para morir en el mismo sitio. Guardar el punto de mira
 * y DERIVAR el angulo desde donde este el jugador si la cumple, y ademas
 * es como lo ensena un entrenador: "pegale a la pared ahi".
 *
 * Los angulos siguen siendo el estado: el preset solo los calcula al
 * cargarse, y a partir de ahi los sliders mandan.
 */

import { COURT, DEFAULT_CONTACT_HEIGHT, SERVICE_ZONE } from './constants.js';
import { CENTER_BOX } from './court.js';
import type { SurfaceId, Vec3 } from './types.js';

const W = COURT.width;
const L = COURT.length;
const H = COURT.height;

export type PresetGroup = 'saque' | 'ataque' | 'pase' | 'defensa';
export type Side = 'left' | 'right';

export interface Preset {
  id: string;
  label: string;
  group: PresetGroup;
  /** Cuando usarlo. Una linea. Es la mitad del valor para quien aprende. */
  when: string;
  speed: number;
  /** Punto de mira, en funcion de donde este parado el jugador. */
  target: (origin: Vec3) => Vec3;
  /** Si el tiro exige una posicion concreta, la impone. */
  origin?: (current: Vec3) => Vec3;
  /**
   * Tiros cuyo dibujo solo tiene sentido con gravedad y arrastre: lobs,
   * ceiling balls. Al cargarlos se pasa al motor balistico.
   */
  prefersBallistic?: boolean;
  /** Secuencia de superficies que este tiro DEBE producir. La verifica el test. */
  expect?: SurfaceId[];
}

const clampX = (x: number): number =>
  Math.min(Math.max(x, CENTER_BOX.xMin + 0.05), CENTER_BOX.xMax - 0.05);

/**
 * Punto de la pared frontal al que hay que apuntar para que, tras rebotar,
 * la pelota llegue a (cornerX, cornerZ). Sale de igualar la pendiente
 * antes y despues del rebote, que la reflexion en Z conserva:
 *
 *   xf = (cornerX * z0 + x0 * cornerZ) / (z0 + cornerZ)
 */
export const aimForRearTarget = (
  origin: Vec3,
  cornerX: number,
  cornerZ: number,
  wallHeight: number,
): Vec3 => ({
  x: clampX((cornerX * origin.z + origin.x * cornerZ) / (origin.z + cornerZ)),
  y: wallHeight,
  z: CENTER_BOX.zMin,
});

const serviceSpot = (side: Side): Vec3 => ({
  x: side === 'left' ? W / 2 - 0.35 : W / 2 + 0.35,
  y: 0.85,
  z: (SERVICE_ZONE.zMin + SERVICE_ZONE.zMax) / 2,
});

const sideLabel = (side: Side): string =>
  side === 'left' ? 'izquierda' : 'derecha';

const nearWallX = (side: Side, inset: number): number =>
  side === 'left' ? CENTER_BOX.xMin + inset : CENTER_BOX.xMax - inset;

const rearCornerX = (side: Side): number => (side === 'left' ? 0.55 : W - 0.55);

const opposite = (side: Side): Side => (side === 'left' ? 'right' : 'left');

// --------------------------------------------------------------- catalogo

const bySide = <T>(make: (side: Side) => T): T[] =>
  (['left', 'right'] as Side[]).map(make);

export const PRESETS: readonly Preset[] = [
  // ------------------------------------------------------------- saques
  ...bySide(
    (side): Preset => ({
      id: `drive-serve-${side}`,
      label: `Drive serve ${sideLabel(side)}`,
      group: 'saque',
      when: 'El saque de trabajo: rapido y bajo, para que muera en el rincon del fondo antes de que llegue.',
      speed: 62,
      origin: () => serviceSpot(opposite(side)),
      // Apuntar para que el rebote acabe en el rincon trasero de ese lado.
      target: (o) => aimForRearTarget(o, rearCornerX(side), 11.2, 0.52),
      expect: ['front', 'floor'],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `z-serve-${side}`,
      prefersBallistic: true,
      label: `Z serve ${sideLabel(side)}`,
      group: 'saque',
      when: 'Frontal alta cerca de la esquina, lateral, y cruza al rincon opuesto. Obliga a girar el cuerpo.',
      speed: 42,
      origin: () => serviceSpot(opposite(side)),
      target: (_o) => ({ x: nearWallX(side, 0.75), y: 1.4, z: CENTER_BOX.zMin }),
      expect: ['front', side, 'floor'],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `lob-serve-${side}`,
      label: `Lob serve ${sideLabel(side)}`,
      group: 'saque',
      when: 'Saque lento y muy alto que cae pegado a la pared del fondo. Para cambiar el ritmo.',
      speed: 15,
      prefersBallistic: true,
      origin: () => serviceSpot(opposite(side)),
      target: (_o) => ({ x: nearWallX(side, 2.4), y: 5.2, z: CENTER_BOX.zMin }),
      expect: ['front', 'floor'],
    }),
  ),

  // ------------------------------------------------------------- ataque
  {
    id: 'kill',
    label: 'Kill shot',
    group: 'ataque',
    when: 'Frontal lo mas bajo posible. Si entra no hay devolucion; si sube dos dedos, es un regalo.',
    speed: 60,
    target: (o) => ({ x: clampX(o.x), y: 0.14, z: CENTER_BOX.zMin }),
    expect: ['front', 'floor'],
  },
  ...bySide(
    (side): Preset => ({
      id: `pinch-${side}`,
      label: `Pinch ${sideLabel(side)}`,
      group: 'ataque',
      when: 'Lateral primero y frontal despues: la pelota muere en la esquina y sale sin altura. El tiro que gana puntos.',
      speed: 54,
      target: (_o) => ({
        x: side === 'left' ? CENTER_BOX.xMin : CENTER_BOX.xMax,
        y: 0.42,
        z: 1.35,
      }),
      expect: [side, 'front'],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `splat-${side}`,
      label: `Splat ${sideLabel(side)}`,
      group: 'ataque',
      when: 'Pinch a quemarropa desde muy cerca de la lateral: sale disparado y plano, casi imposible de leer.',
      speed: 56,
      origin: (current) => ({
        x: nearWallX(side, 0.7),
        y: Math.min(current.y, 0.75),
        z: Math.min(Math.max(current.z, 7), 9.5),
      }),
      target: (o) => ({
        x: side === 'left' ? CENTER_BOX.xMin : CENTER_BOX.xMax,
        y: 0.55,
        z: Math.max(CENTER_BOX.zMin, o.z - 3.4),
      }),
      expect: [side, 'front'],
    }),
  ),

  // ------------------------------------------------------------- pases
  ...bySide(
    (side): Preset => ({
      id: `cross-court-${side}`,
      label: `Cross-court pass a ${sideLabel(side)}`,
      group: 'pase',
      when: 'Pasa al rival por el lado contrario al que esta. Debe botar profundo, no a media cancha.',
      speed: 52,
      target: (o) => aimForRearTarget(o, rearCornerX(side), 11.0, 0.45),
      expect: ['front', 'floor'],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `down-the-line-${side}`,
      label: `Down-the-line ${sideLabel(side)}`,
      group: 'pase',
      when: 'Paralelo a la pared, por tu propio lado. El pase mas seguro cuando el rival esta en el centro.',
      speed: 52,
      origin: (current) => ({
        x: nearWallX(side, 1.15),
        y: current.y,
        z: Math.min(Math.max(current.z, 6.5), 9.5),
      }),
      target: (o) => aimForRearTarget(o, rearCornerX(side), 11.0, 0.46),
      expect: ['front', 'floor'],
    }),
  ),

  // ------------------------------------------------------------- defensa
  {
    id: 'ceiling',
    label: 'Ceiling ball',
    group: 'defensa',
    when: 'Techo, frontal y bote profundo. El tiro que te saca de un apuro y devuelve al rival al fondo.',
    speed: 26,
    prefersBallistic: true,
    target: (o) => ({ x: clampX(o.x), y: CENTER_BOX.yMax, z: 2.1 }),
    expect: ['ceiling', 'front'],
  },
  ...bySide(
    (side): Preset => ({
      id: `z-ball-${side}`,
      prefersBallistic: true,
      label: `Z-ball ${sideLabel(side)}`,
      group: 'defensa',
      when: 'Frontal alta, lateral, cruza la cancha y sale paralelo a la pared del fondo. Descoloca al rival entero.',
      speed: 50,
      target: (_o) => ({ x: nearWallX(side, 0.6), y: 3.1, z: CENTER_BOX.zMin }),
      expect: ['front', side],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `around-the-world-${side}`,
      prefersBallistic: true,
      label: `Around-the-world ${sideLabel(side)}`,
      group: 'defensa',
      when: 'Lateral alta, frontal, lateral opuesta: recorre la cancha entera por arriba y cae al fondo.',
      speed: 46,
      target: (_o) => ({
        x: side === 'left' ? CENTER_BOX.xMin : CENTER_BOX.xMax,
        y: 3.35,
        z: 2.6,
      }),
      expect: [side, 'front', opposite(side)],
    }),
  ),
] as const;

export const presetById = (id: string): Preset | undefined =>
  PRESETS.find((p) => p.id === id);

export const PRESET_GROUPS: { id: PresetGroup; label: string }[] = [
  { id: 'saque', label: 'Saques' },
  { id: 'ataque', label: 'Ataque' },
  { id: 'pase', label: 'Pases' },
  { id: 'defensa', label: 'Defensa' },
];

/** El tiro que produce un preset desde una posicion dada. */
export interface ResolvedPreset {
  origin: Vec3;
  target: Vec3;
  speed: number;
  azimuthDeg: number;
  elevationDeg: number;
}

export const resolvePreset = (
  preset: Preset,
  current: Vec3 = { x: W / 2, y: DEFAULT_CONTACT_HEIGHT, z: L * 0.68 },
): ResolvedPreset => {
  const origin = preset.origin ? preset.origin(current) : current;
  const target = preset.target(origin);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const horizontal = Math.hypot(dx, dz) || 1e-9;
  return {
    origin,
    target,
    speed: preset.speed,
    azimuthDeg: (Math.atan2(dx, -dz) * 180) / Math.PI,
    elevationDeg: (Math.atan2(dy, horizontal) * 180) / Math.PI,
  };
};

export const COURT_EXTENT = { W, L, H } as const;
