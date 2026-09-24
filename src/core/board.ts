/**
 * FASE 9 — Datos de la pizarra tactica.
 *
 * Todo en coordenadas de cancha (metros), nunca en pixeles: asi la
 * pizarra sobrevive a cualquier tamano de pantalla, se exporta a PNG a
 * cualquier resolucion y se puede compartir por URL sin traducir nada.
 *
 * Conceptualmente es facil y tiene mucha superficie de UI. Es la fase que
 * mas horas consume por unidad de dificultad, asi que el modelo de datos
 * se mantiene deliberadamente plano y tonto.
 */

import type { ShotDoc } from '../persist/schema.js';

export type TokenKind = 'me' | 'rival' | 'ball' | 'cone';

export interface Point2D {
  x: number;
  z: number;
}

export interface Token extends Point2D {
  id: string;
  kind: TokenKind;
  label: string;
}

export interface Arrow {
  id: string;
  from: Point2D;
  to: Point2D;
}

export interface Note extends Point2D {
  id: string;
  text: string;
}

export interface Stroke {
  id: string;
  points: Point2D[];
}

export interface Board {
  tokens: Token[];
  arrows: Arrow[];
  notes: Note[];
  strokes: Stroke[];
}

export interface PlayStep {
  shot: ShotDoc;
  note: string;
}

export interface Play {
  id: string;
  name: string;
  createdAt: number;
  steps: PlayStep[];
  board: Board;
}

export const emptyBoard = (): Board => ({
  tokens: [],
  arrows: [],
  notes: [],
  strokes: [],
});

export const newId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const TOKEN_STYLE: Record<
  TokenKind,
  { label: string; color: string; short: string }
> = {
  me: { label: 'Yo', color: '#58a6ff', short: 'Y' },
  rival: { label: 'Rival', color: '#ef5f5f', short: 'R' },
  ball: { label: 'Pelota', color: '#4dd4ac', short: '•' },
  cone: { label: 'Marca', color: '#f2a33c', short: '×' },
};

export const cloneBoard = (b: Board): Board => ({
  tokens: b.tokens.map((t) => ({ ...t })),
  arrows: b.arrows.map((a) => ({ ...a, from: { ...a.from }, to: { ...a.to } })),
  notes: b.notes.map((n) => ({ ...n })),
  strokes: b.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
});

export const isBoardEmpty = (b: Board): boolean =>
  b.tokens.length === 0 &&
  b.arrows.length === 0 &&
  b.notes.length === 0 &&
  b.strokes.length === 0;

/** Simplificacion por distancia: un trazo a mano no necesita 400 puntos. */
export const simplifyStroke = (points: Point2D[], minStep = 0.06): Point2D[] => {
  const out: Point2D[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= minStep) out.push(p);
  }
  if (out.length === 1 && points.length > 1) out.push(points[points.length - 1]!);
  return out;
};

export const duplicatePlay = (play: Play): Play => ({
  ...play,
  id: newId(),
  name: `${play.name} (copia)`,
  createdAt: Date.now(),
  steps: play.steps.map((s) => ({ ...s, shot: { ...s.shot } })),
  board: cloneBoard(play.board),
});
