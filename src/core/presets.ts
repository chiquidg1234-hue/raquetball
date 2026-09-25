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
 *
 * CON EL MOTOR BALISTICO el preset no apunta en linea recta: la gravedad y
 * el aire bajarian la pelota por debajo del punto. Se resuelve (aimWall.ts)
 * para que el primer contacto caiga DE VERDAD en el punto de mira, con el
 * aire y la cancha del sitio de juego. Los tiros al crack van mas lejos:
 * apuntan a la franja de 8.6 mm donde la pelota sale rodando.
 */

import {
  crackPoint,
  solveWallAim,
  surfaceAt,
  type WallAim,
} from './aimWall.js';
import { COURT, DEFAULT_CONTACT_HEIGHT, SERVICE_ZONE } from './constants.js';
import { CENTER_BOX } from './court.js';
import type { PhysicsModel, SurfaceId, Vec3, VenuePhysics } from './types.js';

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
  /**
   * Con el motor balistico, a que superficie y punto tiene que llegar, y
   * por donde. Sin esto, el primer contacto al punto de mira (`target`).
   */
  wallAim?: (origin: Vec3) => WallAim;
  /** Tiro al crack: si entra en la franja, sale rodando. */
  rollout?: boolean;
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

/**
 * Donde se para el que saca un Z: a ~1.3 m (4 ft) de la lateral contraria a
 * la esquina a la que tira. Desde el centro no sale: la frontal y la
 * primera lateral devuelven la pelota paralela a como vino (efecto
 * esquina), y desde el centro esa paralela acaba en la pared del fondo
 * antes de cruzar. Los saques Z no tienen la restriccion de zona del drive.
 */
const zServeSpot = (side: Side): Vec3 => ({
  x: side === 'left' ? CENTER_BOX.xMin + 1.3 : CENTER_BOX.xMax - 1.3,
  y: 0.85,
  z: (SERVICE_ZONE.zMin + SERVICE_ZONE.zMax) / 2,
});

/**
 * Punto de la frontal al que apuntar en linea recta para llegar a `point`
 * despues de rebotar en la frontal: el truco del espejo.
 */
const frontAimFor = (origin: Vec3, point: Vec3): Vec3 => {
  const mirrored = { ...point, z: 2 * CENTER_BOX.zMin - point.z };
  const t = (CENTER_BOX.zMin - origin.z) / (mirrored.z - origin.z);
  return {
    x: origin.x + (mirrored.x - origin.x) * t,
    y: origin.y + (mirrored.y - origin.y) * t,
    z: CENTER_BOX.zMin,
  };
};

const clampRange = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
      when: 'El saque de trabajo: rápido y bajo al rincón del fondo. Bota pasada la línea corta y el rival la tiene que jugar antes de la pared del fondo.',
      // Era 62 m/s. Con el COR que baja con la velocidad, a 55 m/s y con
      // la frontal a 0.7 m DE VERDAD (motor balistico) bota a ~9 m, pasada
      // la linea corta, pegado a la lateral. En el geometrico no hay
      // gravedad que la baje: ahi se apunta a 0.52 m, como antes.
      speed: 55,
      origin: () => serviceSpot(opposite(side)),
      // Apuntar para que el rebote acabe en el rincon trasero de ese lado.
      target: (o) => aimForRearTarget(o, rearCornerX(side), 11.2, 0.52),
      wallAim: (o) => ({
        surface: 'front',
        point: aimForRearTarget(o, rearCornerX(side), 11.2, 0.7),
      }),
      expect: ['front', 'floor'],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `z-serve-${side}`,
      prefersBallistic: true,
      label: `Z serve ${sideLabel(side)}`,
      group: 'saque',
      when: 'Frontal cerca de la esquina, lateral, bota al fondo pegado a la otra lateral y sale casi paralelo a la pared del fondo: el efecto lo endereza.',
      // Desde 1.3 m de la lateral contraria, frontal a 0.45 m de la esquina
      // y a 1.5 m de alto: bota a ~9.7 m pegado a la otra lateral, la toca
      // y sale a ~8 grados de su normal (INVESTIGACION 7, test en presets).
      speed: 35,
      origin: () => zServeSpot(opposite(side)),
      target: (_o) => ({ x: nearWallX(side, 0.45), y: 1.5, z: CENTER_BOX.zMin }),
      expect: ['front', side, 'floor', opposite(side)],
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

  ...bySide(
    (side): Preset => ({
      id: `crack-serve-${side}`,
      label: `Saque al crack ${sideLabel(side)}`,
      group: 'saque',
      when: 'Frontal y a la unión de la lateral con el piso, pasada la línea corta. Si entra en la franja de 34-43 mm sale rodando: ace.',
      // INVESTIGACION 8: la pelota llega a la lateral con poca velocidad
      // hacia ella (contacto largo) y bajando: a 30 m/s tau = 0.85. Mas
      // fuerte, o mas corto, llega demasiado plana y rebota normal.
      speed: 30,
      prefersBallistic: true,
      rollout: true,
      origin: () => serviceSpot(opposite(side)),
      target: (o) => frontAimFor(o, crackPoint(side, 8.5)),
      wallAim: () => ({ surface: side, point: crackPoint(side, 8.5), via: ['front'] }),
      expect: ['front', side, 'floor'],
    }),
  ),

  // ------------------------------------------------------------- ataque
  {
    id: 'kill',
    label: 'Kill shot',
    group: 'ataque',
    when: 'Frontal lo más bajo posible. Si entra no hay devolución; si sube dos dedos, es un regalo.',
    speed: 60,
    // A 15 cm de verdad (en el balistico se resuelve con la gravedad): por
    // encima de la franja del crack, un kill normal que bota y corre bajo.
    target: (o) => ({ x: clampX(o.x), y: 0.15, z: CENTER_BOX.zMin }),
    expect: ['front', 'floor'],
  },
  {
    id: 'kill-crack',
    label: 'Kill al crack (rollout)',
    group: 'ataque',
    when: 'Desde la cintura, bajando fuerte a la unión de frontal y piso. Si toca en la franja de 34-43 mm sale rodando: no bota, imposible de devolver.',
    // INVESTIGACION 8: con la pelota a 45 m/s desde 1.1 m de alto baja a
    // ~11 grados y tau = 0.85 < 1. Desde la rodilla baja demasiado plano
    // (tau ~ 1.8) y no sale nunca.
    speed: 45,
    prefersBallistic: true,
    rollout: true,
    origin: (current) => ({
      x: clampX(current.x),
      y: Math.max(current.y, 1.1),
      z: clampRange(current.z, 5.5, 8),
    }),
    target: (o) => crackPoint('front', clampX(o.x)),
    wallAim: (o) => ({ surface: 'front', point: crackPoint('front', clampX(o.x)) }),
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
      when: 'Pasa al rival por el lado contrario al que está. Tiene que dar el segundo bote antes de la pared del fondo, no rebotar en ella.',
      // A 52 m/s llegaba a la pared del fondo y volvia hasta la frontal.
      // Con el COR que baja con la velocidad, a 28 m/s y con la frontal a
      // 0.8 m de verdad (balistico): primer bote a ~5 m y el segundo a
      // 11.5, pegado al rincon, antes de la trasera. En el geometrico, sin
      // gravedad, se apunta a 0.45 m como antes.
      speed: 28,
      target: (o) => aimForRearTarget(o, rearCornerX(side), 11.0, 0.45),
      wallAim: (o) => ({
        surface: 'front',
        point: aimForRearTarget(o, rearCornerX(side), 11.0, 0.8),
      }),
      expect: ['front', 'floor'],
    }),
  ),
  ...bySide(
    (side): Preset => ({
      id: `down-the-line-${side}`,
      label: `Down-the-line ${sideLabel(side)}`,
      group: 'pase',
      when: 'Paralelo a la pared, por tu propio lado, y que muera en el rincón. El pase más seguro cuando el rival está en el centro.',
      speed: 28,
      origin: (current) => ({
        x: nearWallX(side, 1.15),
        y: current.y,
        z: Math.min(Math.max(current.z, 6.5), 9.5),
      }),
      target: (o) => aimForRearTarget(o, rearCornerX(side), 11.0, 0.5),
      wallAim: (o) => ({
        surface: 'front',
        point: aimForRearTarget(o, rearCornerX(side), 11.0, 0.8),
      }),
      expect: ['front', 'floor'],
    }),
  ),

  // ------------------------------------------------------------- defensa
  {
    id: 'ceiling',
    label: 'Ceiling ball',
    group: 'defensa',
    when: 'Techo a dos pies de la frontal, frontal, y la pelota sube alto y se va al fondo. El tiro que te saca de un apuro.',
    // El techo a 60 cm de la frontal ("1-3 ft" de las guias). El giro que
    // toma en el techo la hace rodar pared abajo sin frenarse: bota fuerte
    // y sube. A 26 m/s y a 2.1 m (antes) se iba por encima de la pared del
    // fondo; a 19 m/s llega a ella alta y cae al fondo.
    speed: 19,
    prefersBallistic: true,
    origin: (current) => ({ ...current, z: Math.max(current.z, 9) }),
    target: (o) => ({ x: clampX(o.x), y: CENTER_BOX.yMax, z: 0.6 }),
    expect: ['ceiling', 'front', 'floor'],
  },
  ...bySide(
    (side): Preset => ({
      id: `z-ball-${side}`,
      prefersBallistic: true,
      label: `Z-ball ${sideLabel(side)}`,
      group: 'defensa',
      when: 'Frontal alta junto a la esquina, lateral, cruza la cancha por el aire y sale de la otra lateral casi paralelo a la pared del fondo.',
      // Solo sale desde el lado contrario y no muy atras: frontal y lateral
      // devuelven la pelota paralela a como vino. Desde el centro del fondo
      // acaba en la pared del fondo antes de cruzar (INVESTIGACION 7).
      speed: 40,
      origin: (current) => ({
        x: nearWallX(opposite(side), 1.0),
        y: current.y,
        z: clampRange(current.z, 5.8, 7),
      }),
      target: (_o) => ({ x: nearWallX(side, 0.3), y: 3.5, z: CENTER_BOX.zMin }),
      expect: ['front', side, opposite(side)],
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
  /**
   * true si se resolvio con la fisica (motor balistico) y el primer
   * contacto cae de verdad en el punto de mira.
   */
  solved: boolean;
}

export interface PresetContext {
  model: PhysicsModel;
  /** El aire y la cancha del sitio de juego (venueSimOptions). */
  physics?: VenuePhysics;
  /** En modo saque la altura de golpe la pone el bote con la mano. */
  strikeHeight?: number;
}

export const resolvePreset = (
  preset: Preset,
  current: Vec3 = { x: W / 2, y: DEFAULT_CONTACT_HEIGHT, z: L * 0.68 },
  ctx?: PresetContext,
): ResolvedPreset => {
  const base = preset.origin ? preset.origin(current) : current;
  const origin = ctx?.strikeHeight != null ? { ...base, y: ctx.strikeHeight } : base;
  const target = preset.target(origin);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const horizontal = Math.hypot(dx, dz) || 1e-9;
  const straight: ResolvedPreset = {
    origin,
    target,
    speed: preset.speed,
    azimuthDeg: (Math.atan2(dx, -dz) * 180) / Math.PI,
    elevationDeg: (Math.atan2(dy, horizontal) * 180) / Math.PI,
    solved: false,
  };
  if (ctx?.model !== 'ballistic') return straight;

  const surface = surfaceAt(target);
  const aim = preset.wallAim?.(origin) ?? (surface ? { surface, point: target } : null);
  if (!aim) return straight;
  const r = solveWallAim(origin, preset.speed, ctx.physics ?? {}, aim);
  return r.ok
    ? { ...straight, azimuthDeg: r.azimuthDeg, elevationDeg: r.elevationDeg, solved: true }
    : straight;
};

export const COURT_EXTENT = { W, L, H } as const;
