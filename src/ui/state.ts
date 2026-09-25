/**
 * El estado de la app: un solo objeto y un emit(). No hay framework.
 *
 * Los parametros del tiro son la fuente de verdad; `shot` y `trajectory`
 * son derivados y se recalculan aqui, en un unico sitio, cada vez que
 * cambia algo que los afecta. Los tres modos de input editan estos mismos
 * campos, asi que cambiar de modo nunca pierde el tiro actual.
 */

import { DEFAULT_CONTACT_HEIGHT, COURT } from '../core/constants.js';
import { clampToCourt } from '../core/court.js';
import { simulate } from '../core/engine.js';
import type {
  PhysicsModel,
  Shot,
  SimOptions,
  Trajectory,
  Vec3,
} from '../core/types.js';
import { emptyBoard, type Board, type Play } from '../core/board.js';
import type { BoardTool } from '../render2d/overlay.js';
import { presetById, resolvePreset } from '../core/presets.js';
import type { Alternative, BounceIndex } from '../core/solve.js';
import { fromShotDoc, fromVenueDoc, toDoc, type Doc, type ShotDoc } from '../persist/schema.js';
import { DEFAULT_VENUE, venueSimOptions, type Venue } from '../core/venue.js';
import {
  TOSS_DEFAULTS,
  TOSS_DROP,
  normalizeToss,
  simulateToss,
  type Toss,
  type TossParams,
} from '../core/serveToss.js';
import { COP_HAND, PIVOTS, powerPoint, sliceSpin } from '../core/racquet.js';
import { SWING, type Handedness, type Stroke } from '../core/stroke.js';
import { fromAzimuthElevation, normalize, sub, v3 } from '../core/vec3.js';

export type LayoutId = 'split' | '3d' | 'plan' | 'front' | 'side';

/**
 * Donde se le pega en la raqueta: el centro de percusion (sin tiron en la
 * mano) o el punto de mas salida con golpe de muneca o de brazo entero.
 */
export type HitSpot = 'cop' | 'wrist' | 'arm';

export const hitSpotS = (spot: HitSpot): number =>
  spot === 'cop' ? COP_HAND : powerPoint(PIVOTS[spot]);
export type InputMode = 'drag' | 'sliders' | 'presets';

export interface AppState {
  // --- parametros del tiro (fuente de verdad) ---
  origin: Vec3;
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
  model: PhysicsModel;
  /** Preset cargado, si el tiro no se ha tocado despues. */
  presetId: string | null;
  /**
   * Donde se juega: altitud, temperatura, pelota, paredes y piso. No es el
   * tiro, pero cambia por donde va la pelota: por eso tambien obliga a
   * recalcular la trayectoria.
   */
  venue: Venue;

  // --- derivados ---
  shot: Shot;
  trajectory: Trajectory;

  // --- reproduccion ---
  playhead: number;
  playing: boolean;
  playRate: number;

  // --- vistas ---
  layout: LayoutId;
  mirror: boolean;
  serveMode: boolean;
  /** Como se bota la pelota con la mano en el saque. */
  serveToss: TossParams;
  /**
   * El bote con la mano, simulado. Solo existe en modo saque, y entonces
   * la altura de contacto del tiro sale de aqui, no del slider.
   */
  toss: Toss | null;
  /** Mano y raqueta en el 3D: que golpe se ensena. null = ocultas. */
  racquetStroke: Stroke | null;
  /** Diestro o zurdo: el espejo de todo el gesto. */
  handedness: Handedness;
  /**
   * Corte (+) o liftado (-) del golpe, en grados: cuanto va la raqueta en
   * oblicuo respecto a su cara. Le da efecto a la pelota (racquet.ts).
   */
  sliceDeg: number;
  /** En que punto de la raqueta se le pega. */
  hitSpot: HitSpot;

  // --- problema inverso (fase 10) ---
  solveTarget: { x: number; z: number; bounceIndex: BounceIndex } | null;
  /** Mientras esta activo, un clic en la planta elige el objetivo. */
  targetPickMode: boolean;
  /**
   * Dejar al solver cambiar tambien la velocidad. La prueba SIEMPRE primero
   * con la actual: solo la toca si con ella no hay tiro posible.
   */
  solveSearchSpeed: boolean;
  /**
   * Formas distintas de dejar el bote pedido en el mismo sitio (kill,
   * pase, ceiling...). Se ofrecen como botones mientras el tiro actual sea
   * una de ellas.
   */
  solveAlternatives: Alternative[];

  // --- pizarra tactica (fase 9) ---
  board: Board;
  tool: BoardTool;
  plays: Play[];
  currentPlayId: string | null;
  /** Paso activo de la jugada. -1 = ninguno. */
  playStep: number;

  // --- input ---
  inputMode: InputMode;
  /** Punto de mira en la pared frontal, si el modo clic+arrastre lo fijo. */
  aim: Vec3 | null;
}

export type Listener = (state: AppState, changed: ReadonlySet<keyof AppState>) => void;

const SHOT_KEYS: readonly (keyof AppState)[] = [
  'origin',
  'azimuthDeg',
  'elevationDeg',
  'speed',
  'model',
  'venue',
  'sliceDeg',
  'hitSpot',
];

/** Lo que decide el bote con la mano. */
const TOSS_KEYS: readonly (keyof AppState)[] = ['serveMode', 'serveToss', 'origin', 'venue'];

/**
 * Donde se le pega de verdad a la pelota: en modo saque, donde este la
 * pelota del lanzamiento al golpearla (x, y y z: lanzarla hacia delante
 * mueve el golpe hacia delante); si no, los sliders. En modo saque los
 * sliders de posicion dicen donde SUELTA la mano.
 */
export const effectiveOrigin = (s: { origin: Vec3; toss: Toss | null }): Vec3 =>
  s.toss ? { ...s.toss.strike.point } : s.origin;

export const deriveShot = (s: {
  origin: Vec3;
  toss?: Toss | null;
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
  sliceDeg?: number;
  hitSpot?: HitSpot;
}): Shot => {
  const direction = fromAzimuthElevation(s.azimuthDeg, s.elevationDeg);
  const shot: Shot = {
    origin: clampToCourt(effectiveOrigin({ origin: s.origin, toss: s.toss ?? null })),
    direction,
    speed: s.speed,
  };
  // El corte o el liftado le dan giro al salir de la raqueta; plano, nada.
  if (s.sliceDeg) {
    shot.spin = sliceSpin(s.speed, s.sliceDeg, direction, hitSpotS(s.hitSpot ?? 'cop')).spin;
  }
  return shot;
};

const tossFor = (s: {
  serveMode: boolean;
  serveToss: TossParams;
  origin: Vec3;
  venue: Venue;
}): Toss | null =>
  s.serveMode
    ? simulateToss(s.origin.x, s.origin.z, s.serveToss, venueSimOptions(s.venue))
    : null;

/**
 * Opciones del motor para el estado actual. La vista, el solver y los
 * fantasmas de la pizarra salen de aqui: todos con el MISMO aire.
 */
export const simOptionsFor = (model: PhysicsModel, venue: Venue): SimOptions => ({
  ...venueSimOptions(venue),
  model,
});

/**
 * Tiro con el que abre la app: el pase cruzado de la biblioteca (28 m/s,
 * frontal a 0.8 m), resuelto con el aire de referencia. Bota a 5.1 m y el
 * 2.o bote cae a 11.5 m en el rincon izquierdo, antes de la trasera: un
 * pase que muere donde tiene que morir. Antes abria con un pase a 45 m/s
 * que, con el efecto y el COR que baja con la velocidad, subia por la
 * pared del fondo y volvia hasta la frontal.
 */
const INITIAL = { azimuthDeg: -7.438, elevationDeg: 2.607, speed: 28 } as const;
const initialOrigin = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, 8.2);
const initialShot = deriveShot({
  origin: initialOrigin,
  azimuthDeg: INITIAL.azimuthDeg,
  elevationDeg: INITIAL.elevationDeg,
  speed: INITIAL.speed,
});

export const state: AppState = {
  origin: initialOrigin,
  azimuthDeg: INITIAL.azimuthDeg,
  elevationDeg: INITIAL.elevationDeg,
  speed: INITIAL.speed,
  model: 'ballistic',
  presetId: null,
  venue: DEFAULT_VENUE,

  shot: initialShot,
  trajectory: simulate(initialShot, simOptionsFor('ballistic', DEFAULT_VENUE)),

  playhead: 0,
  playing: false,
  playRate: 0.25,

  layout: 'split',
  mirror: false,
  serveMode: false,
  serveToss: { ...TOSS_DEFAULTS },
  toss: null,
  racquetStroke: 'forehand',
  handedness: 'right',
  sliceDeg: 0,
  hitSpot: 'cop',

  board: emptyBoard(),
  tool: 'select',
  plays: [],
  currentPlayId: null,
  playStep: -1,

  solveTarget: null,
  targetPickMode: false,
  solveSearchSpeed: true,
  solveAlternatives: [],

  inputMode: 'sliders',
  aim: null,
};

const listeners = new Set<Listener>();

export const subscribe = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const emit = (changed: Set<keyof AppState>): void => {
  for (const fn of listeners) fn(state, changed);
};

/**
 * Unica via de escritura. Recalcula los derivados cuando hace falta y
 * avisa a los suscriptores con la lista de lo que cambio, para que cada
 * vista redibuje solo lo suyo.
 */
export const update = (patch: Partial<AppState>): void => {
  const changed = new Set<keyof AppState>();

  for (const key of Object.keys(patch) as (keyof AppState)[]) {
    const next = patch[key];
    if (next === undefined) continue;
    if (Object.is(state[key], next)) continue;
    // @ts-expect-error indice generico sobre una union de tipos de campo
    state[key] = next;
    changed.add(key);
  }

  if (changed.size === 0) return;

  // Primero el bote con la mano: de el sale la altura de contacto del tiro.
  if (TOSS_KEYS.some((k) => changed.has(k))) {
    const toss = tossFor(state);
    if (toss || state.toss) {
      state.toss = toss;
      changed.add('toss');
    }
  }

  const shotChanged = SHOT_KEYS.some((k) => changed.has(k)) || changed.has('toss');
  if (shotChanged) {
    state.shot = deriveShot(state);
    state.trajectory = simulate(state.shot, simOptionsFor(state.model, state.venue));
    changed.add('shot');
    changed.add('trajectory');
    if (state.playhead > state.trajectory.totalTime) {
      state.playhead = state.trajectory.totalTime;
      changed.add('playhead');
    }
  }
  // Con el bote de saque la linea de tiempo empieza antes del golpe, en
  // negativo: es la pelota cayendo de la mano. Sin el, empieza en 0.
  if (state.playhead < timelineStart()) {
    state.playhead = timelineStart();
    changed.add('playhead');
  }

  emit(changed);
};

/**
 * Primer instante de la linea de tiempo: la mano suelta la pelota (saque)
 * o la raqueta empieza a venir de atras (el golpe animado).
 */
export const timelineStart = (): number =>
  Math.min(state.toss ? -state.toss.duration : 0, state.racquetStroke ? -SWING.backTime : 0);

/**
 * El documento del estado actual. El origen es el EFECTIVO (con la altura
 * que da el bote con la mano), y el saque viaja con sus parametros: quien
 * abra el enlace tiene que ver exactamente este tiro.
 */
export const currentDoc = (): Doc => {
  const doc = toDoc({ ...state, origin: state.shot.origin });
  if (state.serveMode) {
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    const t = state.serveToss;
    doc.serve = {
      r: r3(t.releaseHeight),
      p: r3(t.strikePhase),
      s: r3(t.throwSpeed),
      a: r3(t.throwAzimuthDeg),
      d: r3(t.throwDownDeg),
      x: r3(state.origin.x),
      z: r3(state.origin.z),
    };
  }
  return doc;
};

/** Aplica un documento entero: tiro, cancha y saque. */
export const applyDoc = (doc: Doc): boolean => {
  if (!applyShotDoc(doc.shot)) return false;
  // Un documento v1 no trae cancha: se hizo con el aire de referencia.
  const patch: Partial<AppState> = { venue: fromVenueDoc(doc.venue), serveMode: !!doc.serve };
  if (doc.serve) {
    const sv = doc.serve;
    // Sin datos del lanzamiento es un enlace de antes: la pelota se soltaba.
    const thrown = typeof sv.s === 'number';
    patch.serveToss = normalizeToss({
      releaseHeight: sv.r,
      strikePhase: sv.p,
      ...(thrown
        ? { throwSpeed: sv.s, throwAzimuthDeg: sv.a, throwDownDeg: sv.d }
        : TOSS_DROP),
    });
    if (typeof sv.x === 'number' && typeof sv.z === 'number') {
      patch.origin = { ...state.origin, x: sv.x, z: sv.z };
    }
  }
  update(patch);
  return true;
};

/** Fuerza un redibujo completo (cambio de tema, de tamano, de jugada). */
export const refresh = (): void => {
  emit(new Set(Object.keys(state) as (keyof AppState)[]));
};

/** Aplica un tiro guardado o compartido. Ignora lo que no entienda. */
export const applyShotDoc = (doc: ShotDoc | unknown): boolean => {
  const parsed = fromShotDoc(doc);
  if (!parsed) return false;
  update({ ...parsed, presetId: null, aim: null, playhead: 0, playing: false });
  return true;
};

/**
 * Entrar o salir del modo saque. Al entrar, si el jugador esta fuera de la
 * zona de saque (en pleno peloteo), se le lleva a su centro: desde ahi se
 * suelta la pelota. Si ya estaba dentro, no se le mueve.
 */
export const toggleServeMode = (): void => {
  if (state.serveMode) {
    update({ serveMode: false });
    return;
  }
  const z = state.origin.z;
  const inside = z >= COURT.serviceLine && z <= COURT.shortLine;
  update({
    serveMode: true,
    ...(inside
      ? {}
      : {
          origin: { ...state.origin, z: (COURT.serviceLine + COURT.shortLine) / 2 },
          presetId: null,
          aim: null,
        }),
  });
};

/**
 * Carga un preset desde donde este parado el jugador. El preset decide el
 * punto de mira; el azimut y la elevacion salen de ahi. A partir de ese
 * momento los sliders mandan: cualquier cambio suelta el preset.
 */
export const loadPreset = (id: string): void => {
  const preset = presetById(id);
  if (!preset) return;
  const model: PhysicsModel = preset.prefersBallistic ? 'ballistic' : state.model;
  const physics = venueSimOptions(state.venue);
  // En modo saque la altura de golpe la pone el bote con la mano, en el
  // sitio desde donde se saca: se calcula antes de apuntar.
  const spot = resolvePreset(preset, state.origin);
  const strike = state.serveMode
    ? simulateToss(spot.origin.x, spot.origin.z, state.serveToss, physics).strike.point
    : undefined;
  // Con el balistico se apunta para que el primer contacto caiga DE
  // VERDAD en el punto de mira (y al crack, en su franja), con el aire del
  // sitio de juego.
  const resolved = resolvePreset(preset, state.origin, { model, physics, strike });
  update({
    // En modo saque la posicion es donde suelta la mano; el golpe lo pone
    // el lanzamiento.
    origin: state.serveMode ? spot.origin : resolved.origin,
    azimuthDeg: resolved.azimuthDeg,
    elevationDeg: resolved.elevationDeg,
    speed: resolved.speed,
    aim: resolved.target,
    presetId: id,
    ...(preset.prefersBallistic ? { model: 'ballistic' as const } : {}),
  });
};

/**
 * Apunta a un punto concreto: recalcula azimut y elevacion desde el origen.
 * Lo usan el modo clic+arrastre y el solver inverso.
 */
export const aimAt = (target: Vec3, speed?: number): void => {
  const dir = normalize(sub(target, state.shot.origin));
  if (dir.x === 0 && dir.y === 0 && dir.z === 0) return;
  const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI;
  const azimuthDeg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
  update({
    azimuthDeg,
    elevationDeg,
    aim: target,
    presetId: null,
    ...(speed !== undefined ? { speed } : {}),
  });
};
