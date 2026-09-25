/**
 * El estado de la app: un solo objeto y un emit(). No hay framework.
 *
 * Los parametros del tiro son la fuente de verdad; `shot` y `trajectory`
 * son derivados y se recalculan aqui, en un unico sitio, cada vez que
 * cambia algo que los afecta. Los tres modos de input editan estos mismos
 * campos, asi que cambiar de modo nunca pierde el tiro actual.
 */

import { DEFAULT_CONTACT_HEIGHT, COURT, SPEED } from '../core/constants.js';
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
import { TOSS_DEFAULTS, simulateToss, type Toss, type TossParams } from '../core/serveToss.js';
import type { Handedness, Stroke } from '../core/stroke.js';
import { fromAzimuthElevation, normalize, sub, v3 } from '../core/vec3.js';

export type LayoutId = 'split' | '3d' | 'plan' | 'front' | 'side';
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
];

/** Lo que decide el bote con la mano. */
const TOSS_KEYS: readonly (keyof AppState)[] = ['serveMode', 'serveToss', 'origin', 'venue'];

/**
 * Donde se le pega de verdad a la pelota: en modo saque la altura la pone
 * el bote con la mano; si no, el slider.
 */
export const effectiveOrigin = (s: { origin: Vec3; toss: Toss | null }): Vec3 =>
  s.toss ? { ...s.origin, y: s.toss.strike.point.y } : s.origin;

export const deriveShot = (s: {
  origin: Vec3;
  toss?: Toss | null;
  azimuthDeg: number;
  elevationDeg: number;
  speed: number;
}): Shot => ({
  origin: clampToCourt(effectiveOrigin({ origin: s.origin, toss: s.toss ?? null })),
  direction: fromAzimuthElevation(s.azimuthDeg, s.elevationDeg),
  speed: s.speed,
});

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
 * Tiro con el que abre la app: un pase por la izquierda que bota a 9 m,
 * sale de la trasera y vuelve a botar dos veces. Se eligio con el propio
 * solver. Abria con un tiro geometrico recto, y sin gravedad la pelota no
 * da ni un bote de piso: las tarjetas de botes, que son lo que mas importa
 * leer, salian vacias al entrar.
 */
const INITIAL = { azimuthDeg: -6.5, elevationDeg: 0.5 } as const;
const initialOrigin = v3(COURT.width / 2, DEFAULT_CONTACT_HEIGHT, 8.2);
const initialShot = deriveShot({
  origin: initialOrigin,
  azimuthDeg: INITIAL.azimuthDeg,
  elevationDeg: INITIAL.elevationDeg,
  speed: SPEED.default,
});

export const state: AppState = {
  origin: initialOrigin,
  azimuthDeg: INITIAL.azimuthDeg,
  elevationDeg: INITIAL.elevationDeg,
  speed: SPEED.default,
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

/** Primer instante de la linea de tiempo: la mano suelta la pelota. */
export const timelineStart = (): number => (state.toss ? -state.toss.duration : 0);

/**
 * El documento del estado actual. El origen es el EFECTIVO (con la altura
 * que da el bote con la mano), y el saque viaja con sus parametros: quien
 * abra el enlace tiene que ver exactamente este tiro.
 */
export const currentDoc = (): Doc => {
  const doc = toDoc({ ...state, origin: state.shot.origin });
  if (state.serveMode) {
    doc.serve = {
      r: Math.round(state.serveToss.releaseHeight * 1000) / 1000,
      p: Math.round(state.serveToss.strikePhase * 1000) / 1000,
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
    patch.serveToss = {
      releaseHeight: typeof doc.serve.r === 'number' ? doc.serve.r : TOSS_DEFAULTS.releaseHeight,
      strikePhase: typeof doc.serve.p === 'number' ? doc.serve.p : TOSS_DEFAULTS.strikePhase,
    };
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
 * Carga un preset desde donde este parado el jugador. El preset decide el
 * punto de mira; el azimut y la elevacion salen de ahi. A partir de ese
 * momento los sliders mandan: cualquier cambio suelta el preset.
 */
export const loadPreset = (id: string): void => {
  const preset = presetById(id);
  if (!preset) return;
  const resolved = resolvePreset(preset, state.origin);
  update({
    origin: resolved.origin,
    azimuthDeg: resolved.azimuthDeg,
    elevationDeg: resolved.elevationDeg,
    speed: resolved.speed,
    aim: resolved.target,
    presetId: id,
    ...(preset.prefersBallistic ? { model: 'ballistic' as const } : {}),
  });
  // En modo saque la altura de contacto la pone el bote con la mano, no
  // el preset: se vuelve a apuntar al mismo sitio desde donde de verdad
  // se le pega.
  if (state.toss) {
    const dir = normalize(sub(resolved.target, state.shot.origin));
    update({
      azimuthDeg: (Math.atan2(dir.x, -dir.z) * 180) / Math.PI,
      elevationDeg: (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI,
    });
  }
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
