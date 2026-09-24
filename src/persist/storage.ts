/**
 * FASE 11 — localStorage.
 *
 * Toda lectura y escritura va envuelta: en ventana privada, con las
 * cookies bloqueadas o dentro de un iframe restringido, el acceso lanza o
 * devuelve vacio. La app tiene que seguir funcionando igual; lo unico que
 * se pierde es recordar cosas entre sesiones.
 */

import type { Board, Play } from '../core/board.js';
import type { NamedShot, ShotDoc, ViewDoc } from './schema.js';

const KEY_SHOTS = 'rtl.v1.shots';
const KEY_VIEW = 'rtl.v1.view';
const KEY_PLAYS = 'rtl.v1.plays';
const KEY_BOARD = 'rtl.v1.board';

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): boolean => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const loadSavedShots = (): NamedShot[] => {
  const list = read<NamedShot[]>(KEY_SHOTS, []);
  return Array.isArray(list) ? list.filter((s) => s && s.id && s.shot) : [];
};

export const storeSavedShots = (list: NamedShot[]): boolean =>
  write(KEY_SHOTS, list);

export const saveShot = (name: string, shot: ShotDoc): NamedShot[] => {
  const entry: NamedShot = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    n: name.trim() || 'sin nombre',
    t: Date.now(),
    shot,
  };
  const list = [entry, ...loadSavedShots()].slice(0, 200);
  storeSavedShots(list);
  return list;
};

export const deleteShot = (id: string): NamedShot[] => {
  const list = loadSavedShots().filter((s) => s.id !== id);
  storeSavedShots(list);
  return list;
};

export const loadPlays = (): Play[] => {
  const list = read<Play[]>(KEY_PLAYS, []);
  return Array.isArray(list) ? list.filter((p) => p && p.id && p.steps) : [];
};

export const storePlays = (list: Play[]): boolean => write(KEY_PLAYS, list);

export const loadBoard = (): Board | null => read<Board | null>(KEY_BOARD, null);
export const storeBoard = (board: Board): boolean => write(KEY_BOARD, board);

export const loadViewPrefs = (): ViewDoc => read<ViewDoc>(KEY_VIEW, {});
export const storeViewPrefs = (view: ViewDoc): boolean => write(KEY_VIEW, view);

/** Si localStorage no esta disponible, la UI lo dice en vez de mentir. */
export const storageAvailable = (): boolean => {
  try {
    const probe = '__rtl_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};
