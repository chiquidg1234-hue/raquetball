import { describe, expect, it } from 'vitest';

import {
  cloneBoard,
  duplicatePlay,
  emptyBoard,
  isBoardEmpty,
  newId,
  simplifyStroke,
  TOKEN_STYLE,
  type Play,
} from '../src/core/board.js';

describe('modelo de la pizarra', () => {
  it('un tablero recien creado esta vacio', () => {
    expect(isBoardEmpty(emptyBoard())).toBe(true);
  });

  it('clonar no comparte referencias con el original', () => {
    const board = emptyBoard();
    board.tokens.push({ id: 'a', kind: 'me', label: 'Y', x: 1, z: 2 });
    board.strokes.push({ id: 'b', points: [{ x: 0, z: 0 }, { x: 1, z: 1 }] });

    const copy = cloneBoard(board);
    copy.tokens[0]!.x = 99;
    copy.strokes[0]!.points[0]!.x = 99;

    expect(board.tokens[0]!.x).toBe(1);
    expect(board.strokes[0]!.points[0]!.x).toBe(0);
  });

  it('los identificadores no se repiten', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });

  it('cada tipo de ficha tiene color y etiqueta', () => {
    for (const kind of ['me', 'rival', 'ball', 'cone'] as const) {
      expect(TOKEN_STYLE[kind].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(TOKEN_STYLE[kind].label.length).toBeGreaterThan(0);
    }
  });
});

describe('simplificacion de trazos', () => {
  it('tira los puntos que no aportan', () => {
    const dense = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.001, z: 0 }));
    const simple = simplifyStroke(dense, 0.06);
    expect(simple.length).toBeLessThan(10);
    expect(simple.length).toBeGreaterThan(1);
  });

  it('conserva la forma de un trazo con curvas', () => {
    const curve = Array.from({ length: 50 }, (_, i) => ({
      x: i * 0.1,
      z: Math.sin(i * 0.3),
    }));
    const simple = simplifyStroke(curve, 0.06);
    expect(simple[0]).toEqual(curve[0]);
    expect(simple.length).toBeGreaterThan(20);
  });

  it('un trazo de dos puntos sobrevive aunque sean muy cercanos', () => {
    const tiny = [{ x: 0, z: 0 }, { x: 0.001, z: 0 }];
    expect(simplifyStroke(tiny).length).toBe(2);
  });
});

describe('duplicar jugadas', () => {
  const play = (): Play => ({
    id: 'p1',
    name: 'Jugada 1',
    createdAt: 1,
    steps: [{ shot: { o: [1, 2, 3], a: 0, e: 0, s: 45, m: 'g' }, note: '' }],
    board: emptyBoard(),
  });

  it('la copia es independiente y tiene otro id', () => {
    const original = play();
    const copy = duplicatePlay(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toContain('copia');

    copy.steps[0]!.shot.s = 99;
    expect(original.steps[0]!.shot.s).toBe(45);
  });
});
