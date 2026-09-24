/**
 * FASE 9 — La capa de pizarra sobre la vista de planta.
 *
 * Dibuja fichas, flechas, texto y trazos a mano, y gestiona el arrastre.
 * Las flechas de movimiento van PUNTEADAS a proposito: tienen que
 * distinguirse de un vistazo de las trayectorias de pelota, que van
 * solidas. Si se parecen, la pizarra deja de leerse.
 */

import type { Board, Point2D, TokenKind } from '../core/board.js';
import { TOKEN_STYLE, newId, simplifyStroke } from '../core/board.js';
import type { Projection } from './projections.js';
import { clear, pointsAttr, svgEl } from './svg.js';
import { pointerToViewBox } from './svg.js';

export type BoardTool =
  | 'select'
  | 'token-me'
  | 'token-rival'
  | 'token-ball'
  | 'token-cone'
  | 'arrow'
  | 'text'
  | 'draw'
  | 'erase';

export interface BoardHandlers {
  getBoard(): Board;
  getTool(): BoardTool;
  setBoard(next: Board): void;
  askText(): string | null;
}

const TOKEN_R = 0.34;

export class BoardOverlay {
  private readonly layer: SVGGElement;
  private readonly svg: SVGSVGElement;
  private readonly projection: Projection;
  private readonly handlers: BoardHandlers;

  /** Arrastre en curso. */
  private drag:
    | { kind: 'token'; id: string; pointerId: number }
    | { kind: 'arrow'; from: Point2D; pointerId: number }
    | { kind: 'draw'; points: Point2D[]; pointerId: number }
    | null = null;

  constructor(
    layer: SVGGElement,
    svg: SVGSVGElement,
    projection: Projection,
    handlers: BoardHandlers,
  ) {
    this.layer = layer;
    this.svg = svg;
    this.projection = projection;
    this.handlers = handlers;
    this.attach();
  }

  private toCourt(e: { clientX: number; clientY: number }): Point2D {
    const { u, v } = pointerToViewBox(this.svg, e);
    const p = this.projection.unproject({ u, v }, 0);
    return { x: p.x, z: p.z };
  }

  private project(p: Point2D): { u: number; v: number } {
    return this.projection.project({ x: p.x, y: 0, z: p.z });
  }

  // ------------------------------------------------------------- dibujo

  render(preview?: { arrowTo?: Point2D; stroke?: Point2D[] }): void {
    clear(this.layer);
    const board = this.handlers.getBoard();

    for (const stroke of board.strokes) {
      if (stroke.points.length < 2) continue;
      svgEl(
        'polyline',
        {
          class: 'board-stroke',
          points: pointsAttr(stroke.points.map((p) => this.project(p))),
          'data-board-id': stroke.id,
        },
        this.layer,
      );
    }

    if (preview?.stroke && preview.stroke.length > 1) {
      svgEl(
        'polyline',
        {
          class: 'board-stroke',
          points: pointsAttr(preview.stroke.map((p) => this.project(p))),
        },
        this.layer,
      );
    }

    for (const arrow of board.arrows) {
      this.drawArrow(arrow.from, arrow.to, arrow.id);
    }
    if (this.drag?.kind === 'arrow' && preview?.arrowTo) {
      this.drawArrow(this.drag.from, preview.arrowTo);
    }

    for (const note of board.notes) {
      const pt = this.project(note);
      svgEl(
        'text',
        {
          class: 'board-note',
          x: pt.u,
          y: pt.v,
          'font-size': 0.32,
          'data-board-id': note.id,
        },
        this.layer,
      ).textContent = note.text;
    }

    for (const token of board.tokens) {
      const pt = this.project(token);
      const style = TOKEN_STYLE[token.kind];
      const g = svgEl(
        'g',
        { class: 'board-token', 'data-board-id': token.id },
        this.layer,
      );
      svgEl(
        'circle',
        {
          class: 'board-token-bg',
          cx: pt.u,
          cy: pt.v,
          r: TOKEN_R,
          fill: style.color,
        },
        g,
      );
      svgEl(
        'text',
        { class: 'board-token-text', x: pt.u, y: pt.v, 'font-size': 0.3 },
        g,
      ).textContent = token.label || style.short;
    }
  }

  private drawArrow(from: Point2D, to: Point2D, id?: string): void {
    const a = this.project(from);
    const b = this.project(to);
    const g = svgEl(
      'g',
      { class: 'board-arrow', 'data-board-id': id },
      this.layer,
    );
    svgEl(
      'line',
      { class: 'board-arrow-line', x1: a.u, y1: a.v, x2: b.u, y2: b.v },
      g,
    );

    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const head = 0.34;
    for (const side of [1, -1]) {
      svgEl(
        'line',
        {
          class: 'board-arrow-line',
          x1: b.u,
          y1: b.v,
          x2: b.u - nx * head - ny * side * head * 0.45,
          y2: b.v - ny * head + nx * side * head * 0.45,
        },
        g,
      );
    }
  }

  // ---------------------------------------------------------- interaccion

  private attach(): void {
    // En captura y con stopPropagation: mientras haya una herramienta de
    // pizarra activa, el gesto es de la pizarra y no del modo de tiro.
    this.svg.addEventListener(
      'pointerdown',
      (e) => this.onDown(e),
      { capture: true },
    );
    this.svg.addEventListener('pointermove', (e) => this.onMove(e), {
      capture: true,
    });
    this.svg.addEventListener('pointerup', (e) => this.onUp(e), {
      capture: true,
    });
    this.svg.addEventListener('pointercancel', (e) => this.onUp(e), {
      capture: true,
    });
  }

  private idAt(target: EventTarget | null): string | null {
    let node = target as Element | null;
    while (node && node !== this.svg) {
      const id = node.getAttribute?.('data-board-id');
      if (id) return id;
      node = node.parentElement;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    const tool = this.handlers.getTool();
    const board = this.handlers.getBoard();
    const hitId = this.idAt(e.target);

    // En modo seleccion solo se interviene si se agarra una ficha; asi
    // clicar el suelo sigue colocando al jugador.
    if (tool === 'select') {
      if (!hitId) return;
      const token = board.tokens.find((t) => t.id === hitId);
      if (!token) return;
      e.stopPropagation();
      e.preventDefault();
      this.drag = { kind: 'token', id: token.id, pointerId: e.pointerId };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    const point = this.toCourt(e);

    if (tool === 'erase') {
      if (hitId) this.handlers.setBoard(removeById(board, hitId));
      this.render();
      return;
    }

    if (tool.startsWith('token-')) {
      const kind = tool.slice('token-'.length) as TokenKind;
      this.handlers.setBoard({
        ...board,
        tokens: [
          ...board.tokens,
          {
            id: newId(),
            kind,
            label: TOKEN_STYLE[kind].short,
            x: point.x,
            z: point.z,
          },
        ],
      });
      this.render();
      return;
    }

    if (tool === 'text') {
      const text = this.handlers.askText();
      if (text) {
        this.handlers.setBoard({
          ...board,
          notes: [...board.notes, { id: newId(), text, x: point.x, z: point.z }],
        });
      }
      this.render();
      return;
    }

    if (tool === 'arrow') {
      this.drag = { kind: 'arrow', from: point, pointerId: e.pointerId };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === 'draw') {
      this.drag = { kind: 'draw', points: [point], pointerId: e.pointerId };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const point = this.toCourt(e);

    if (this.drag.kind === 'token') {
      const board = this.handlers.getBoard();
      const id = this.drag.id;
      this.handlers.setBoard({
        ...board,
        tokens: board.tokens.map((t) =>
          t.id === id ? { ...t, x: point.x, z: point.z } : t,
        ),
      });
      this.render();
      return;
    }

    if (this.drag.kind === 'arrow') {
      this.render({ arrowTo: point });
      return;
    }

    if (this.drag.kind === 'draw') {
      this.drag.points.push(point);
      this.render({ stroke: this.drag.points });
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const point = this.toCourt(e);
    const board = this.handlers.getBoard();
    const drag = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) {
      this.svg.releasePointerCapture(e.pointerId);
    }

    if (drag.kind === 'arrow') {
      const distance = Math.hypot(point.x - drag.from.x, point.z - drag.from.z);
      if (distance > 0.3) {
        this.handlers.setBoard({
          ...board,
          arrows: [...board.arrows, { id: newId(), from: drag.from, to: point }],
        });
      }
    }

    if (drag.kind === 'draw') {
      const points = simplifyStroke([...drag.points, point]);
      if (points.length > 1) {
        this.handlers.setBoard({
          ...board,
          strokes: [...board.strokes, { id: newId(), points }],
        });
      }
    }

    this.render();
  }
}

const removeById = (board: Board, id: string): Board => ({
  tokens: board.tokens.filter((t) => t.id !== id),
  arrows: board.arrows.filter((a) => a.id !== id),
  notes: board.notes.filter((n) => n.id !== id),
  strokes: board.strokes.filter((s) => s.id !== id),
});
