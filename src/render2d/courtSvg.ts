/**
 * FASE 3 — Pizarra 2D: una vista ortografica de la cancha en SVG.
 *
 * El viewBox esta en metros de cancha, asi que todo grosor, radio y tamano
 * de texto se escribe en metros y sale a escala sin calculos de conversion.
 */

import { BALL, COURT, SERVICE_ZONE } from '../core/constants.js';
import type { Trajectory, Vec3 } from '../core/types.js';
import type { UnfoldedCourt } from '../core/unfold.js';
import { positionAt, splitByBounce } from '../core/trajectory-utils.js';
import { length, normalize } from '../core/vec3.js';
import type { Point2, Projection } from './projections.js';
import { clear, pointsAttr, setAttrs, svgEl } from './svg.js';

/** Margen alrededor de la cancha, en metros, para etiquetas y marcadores. */
const PAD = 0.42;

export interface CourtView2DOptions {
  /** Mostrar las etiquetas de los bordes. */
  showEdgeLabels?: boolean;
}

export interface TrajectoryDrawOptions {
  /** Instante del playhead, en segundos. null = sin pelota animada. */
  playhead?: number | null;
  /** Marcador del jugador. */
  origin?: Vec3 | null;
  /** Punto de mira, si el modo de input lo define. */
  aim?: Vec3 | null;
  /** Trayectorias secundarias, mas apagadas (jugadas encadenadas). */
  ghosts?: Trajectory[];
  /** Objetivo del problema inverso (fase 10). Solo se dibuja en planta. */
  target?: { x: number; z: number; bounceIndex: 1 | 2 } | null;
}

export class CourtView2D {
  readonly svg: SVGSVGElement;
  readonly projection: Projection;

  private readonly gStatic: SVGGElement;
  private readonly gOverlay: SVGGElement;
  private readonly gGhosts: SVGGElement;
  private readonly gTrajectory: SVGGElement;
  private readonly gMarkers: SVGGElement;
  private readonly gBall: SVGGElement;
  private readonly gGuide: SVGGElement;
  private readonly gUnfold: SVGGElement;

  constructor(projection: Projection, options: CourtView2DOptions = {}) {
    this.projection = projection;

    this.svg = svgEl('svg', {
      class: `court2d court2d--${projection.id}`,
      viewBox: `${-PAD} ${-PAD} ${projection.width + PAD * 2} ${
        projection.height + PAD * 2
      }`,
      preserveAspectRatio: 'xMidYMid meet',
      'data-projection': projection.id,
    });

    this.gUnfold = svgEl('g', { class: 'layer-unfold' }, this.svg);
    this.gStatic = svgEl('g', { class: 'layer-static' }, this.svg);
    this.gGhosts = svgEl('g', { class: 'layer-ghosts' }, this.svg);
    this.gTrajectory = svgEl('g', { class: 'layer-trajectory' }, this.svg);
    this.gMarkers = svgEl('g', { class: 'layer-markers' }, this.svg);
    this.gBall = svgEl('g', { class: 'layer-ball' }, this.svg);
    this.gGuide = svgEl('g', { class: 'layer-guide' }, this.svg);
    this.gOverlay = svgEl('g', { class: 'layer-overlay' }, this.svg);

    this.drawStatic(options);
  }

  /** Capa libre para la pizarra tactica (fase 9). */
  get overlayLayer(): SVGGElement {
    return this.gOverlay;
  }

  private p(point: Vec3): Point2 {
    return this.projection.project(point);
  }

  // ---------------------------------------------------------------- estatico

  private drawStatic(options: CourtView2DOptions): void {
    const { width, height, id } = this.projection;
    const g = this.gStatic;

    svgEl(
      'rect',
      { class: 'court-surface', x: 0, y: 0, width, height },
      g,
    );

    if (id === 'plan') this.drawPlanLines(g);
    if (id === 'front') this.drawFrontLines(g);
    if (id === 'side') this.drawSideLines(g);

    // El borde va al final para que quede por encima de las lineas.
    svgEl(
      'rect',
      { class: 'court-border', x: 0, y: 0, width, height },
      g,
    );

    if (options.showEdgeLabels !== false) this.drawEdgeLabels(g);
  }

  private drawEdgeLabels(g: SVGGElement): void {
    const { width, height, edges } = this.projection;
    const size = 0.24;
    svgEl(
      'text',
      { class: 'edge-label', x: width / 2, y: -PAD * 0.45, 'font-size': size },
      g,
    ).textContent = edges.top;
    svgEl(
      'text',
      {
        class: 'edge-label',
        x: width / 2,
        y: height + PAD * 0.55,
        'font-size': size,
      },
      g,
    ).textContent = edges.bottom;
  }

  /** Planta: lineas reglamentarias vistas desde arriba. */
  private drawPlanLines(g: SVGGElement): void {
    const w = COURT.width;

    // Zona de saque sombreada.
    svgEl(
      'rect',
      {
        class: 'service-zone',
        x: 0,
        y: SERVICE_ZONE.zMin,
        width: w,
        height: SERVICE_ZONE.depth,
      },
      g,
    );

    const hline = (z: number, cls: string, label: string) => {
      svgEl('line', { class: cls, x1: 0, y1: z, x2: w, y2: z }, g);
      svgEl(
        'text',
        { class: 'line-label', x: 0.13, y: z - 0.19, 'font-size': 0.22 },
        g,
      ).textContent = label;
    };

    hline(COURT.serviceLine, 'court-line', 'service');
    hline(COURT.shortLine, 'court-line court-line--strong', 'short');
    hline(COURT.receivingLine, 'court-line court-line--dashed', 'receiving');

    // Drive serve lines: solo dentro de la zona de saque.
    for (const x of [
      COURT.driveServeLineOffset,
      COURT.width - COURT.driveServeLineOffset,
    ]) {
      svgEl(
        'line',
        {
          class: 'court-line court-line--thin',
          x1: x,
          y1: SERVICE_ZONE.zMin,
          x2: x,
          y2: SERVICE_ZONE.zMax,
        },
        g,
      );
    }

    // Cajas de dobles, pegadas a cada pared lateral.
    for (const x of [0, COURT.width - COURT.doublesBoxWidth]) {
      svgEl(
        'rect',
        {
          class: 'doubles-box',
          x,
          y: SERVICE_ZONE.zMin,
          width: COURT.doublesBoxWidth,
          height: SERVICE_ZONE.depth,
        },
        g,
      );
    }
  }

  /** Alzado frontal: rejilla de altura, que es lo que se lee aqui. */
  private drawFrontLines(g: SVGGElement): void {
    const { width, height } = this.projection;
    for (let m = 1; m < COURT.height; m++) {
      const v = height - m;
      svgEl(
        'line',
        { class: 'grid-line', x1: 0, y1: v, x2: width, y2: v },
        g,
      );
      svgEl(
        'text',
        { class: 'grid-label', x: 0.12, y: v + 0.19, 'font-size': 0.21 },
        g,
      ).textContent = `${m} m`;
    }
    // Referencia de kill shot: los primeros 30 cm de pared.
    svgEl(
      'rect',
      {
        class: 'kill-zone',
        x: 0,
        y: height - 0.3,
        width,
        height: 0.3,
      },
      g,
    );
  }

  /** Alzado lateral: aqui se ve la pared trasera de 12 ft y el aire de arriba. */
  private drawSideLines(g: SVGGElement): void {
    const { width, height } = this.projection;

    for (const [z, label, cls] of [
      [COURT.serviceLine, 'service', 'court-line'],
      [COURT.shortLine, 'short', 'court-line court-line--strong'],
      [COURT.receivingLine, 'receiving', 'court-line court-line--dashed'],
    ] as const) {
      svgEl('line', { class: cls, x1: z, y1: 0, x2: z, y2: height }, g);
      svgEl(
        'text',
        { class: 'line-label', x: z + 0.11, y: height - 0.2, 'font-size': 0.22 },
        g,
      ).textContent = label;
    }

    for (let m = 1; m < COURT.height; m++) {
      const v = height - m;
      svgEl(
        'line',
        { class: 'grid-line', x1: 0, y1: v, x2: width, y2: v },
        g,
      );
    }

    // La pared trasera solo sube 12 ft. Por encima hay aire: si la pelota
    // cruza ahi, se va fuera. Es la lectura clave de esta vista.
    const yWallTop = height - COURT.backWallHeight;
    svgEl(
      'line',
      {
        class: 'back-wall-solid',
        x1: width,
        y1: yWallTop,
        x2: width,
        y2: height,
      },
      g,
    );
    svgEl(
      'line',
      { class: 'back-wall-open', x1: width, y1: 0, x2: width, y2: yWallTop },
      g,
    );
    svgEl(
      'line',
      {
        class: 'back-wall-top',
        x1: width - 1.1,
        y1: yWallTop,
        x2: width,
        y2: yWallTop,
      },
      g,
    );
    svgEl(
      'text',
      {
        class: 'grid-label grid-label--warn',
        x: width - 1.15,
        y: yWallTop - 0.14,
        'font-size': 0.24,
        'text-anchor': 'end',
      },
      g,
    ).textContent = '12 ft — arriba sale';
  }

  // ---------------------------------------------------------------- dinamico

  draw(trajectory: Trajectory | null, opts: TrajectoryDrawOptions = {}): void {
    clear(this.gTrajectory);
    clear(this.gMarkers);
    clear(this.gGhosts);
    clear(this.gBall);

    for (const ghost of opts.ghosts ?? []) {
      this.drawPath(ghost, this.gGhosts, true);
    }

    if (trajectory) {
      this.drawPath(trajectory, this.gTrajectory, false);
      this.drawBounceMarkers(trajectory);
      this.drawExitTail(trajectory);
    }

    if (opts.target && this.projection.id === 'plan') {
      this.drawTarget(opts.target);
    }
    if (opts.origin) this.drawOrigin(opts.origin);
    if (opts.aim) this.drawAim(opts.aim);
    if (trajectory && opts.playhead != null) {
      this.drawBall(trajectory, opts.playhead);
    }
  }

  /**
   * La trayectoria, partida por rebotes: el tramo 1 opaco, los siguientes
   * cada vez mas desvaidos. Asi se lee el orden de los rebotes sin animar.
   */
  private drawPath(
    trajectory: Trajectory,
    parent: SVGGElement,
    ghost: boolean,
  ): void {
    const segments = splitByBounce(trajectory);
    segments.forEach((seg, i) => {
      if (seg.length < 2) return;
      const opacity = ghost
        ? 0.18
        : Math.max(0.2, 1 - i * 0.18);
      svgEl(
        'polyline',
        {
          class: ghost ? 'traj-line traj-line--ghost' : 'traj-line',
          points: pointsAttr(seg.map((s) => this.p(s.p))),
          opacity,
          'data-segment': i,
        },
        parent,
      );
    });
  }

  private drawBounceMarkers(trajectory: Trajectory): void {
    trajectory.bounces.forEach((b) => {
      const pt = this.p(b.point);
      const g = svgEl(
        'g',
        { class: `bounce bounce--${b.surface}`, 'data-bounce': b.index },
        this.gMarkers,
      );
      svgEl('circle', { class: 'bounce-dot', cx: pt.u, cy: pt.v, r: 0.2 }, g);
      svgEl(
        'text',
        {
          class: 'bounce-num',
          x: pt.u,
          y: pt.v,
          'font-size': 0.26,
        },
        g,
      ).textContent = String(b.index);
    });
  }

  /**
   * Si la pelota salio de la cancha, prolongar un trazo punteado en la
   * direccion de salida. Sin esto, un lob que se pasa parece que se para
   * en la pared en vez de irse fuera.
   */
  private drawExitTail(trajectory: Trajectory): void {
    if (trajectory.terminated !== 'exitedCourt') return;
    const last = trajectory.samples[trajectory.samples.length - 1];
    if (!last || length(last.v) < 1e-6) return;

    const dir = normalize(last.v);
    const tip: Vec3 = {
      x: last.p.x + dir.x * 1.3,
      y: last.p.y + dir.y * 1.3,
      z: last.p.z + dir.z * 1.3,
    };
    const a = this.p(last.p);
    const b = this.p(tip);
    svgEl(
      'line',
      { class: 'exit-tail', x1: a.u, y1: a.v, x2: b.u, y2: b.v },
      this.gMarkers,
    );
    const away = Math.hypot(b.u - a.u, b.v - a.v) || 1;
    svgEl(
      'text',
      {
        class: 'exit-label',
        x: b.u + ((b.u - a.u) / away) * 0.3,
        y: b.v + ((b.v - a.v) / away) * 0.3,
        'font-size': 0.26,
      },
      this.gMarkers,
    ).textContent = 'fuera';
  }

  private drawTarget(t: { x: number; z: number; bounceIndex: 1 | 2 }): void {
    const pt = this.p({ x: t.x, y: 0, z: t.z });
    const g = svgEl('g', { class: 'target-marker' }, this.gMarkers);
    svgEl('circle', { class: 'target-ring', cx: pt.u, cy: pt.v, r: 0.42 }, g);
    svgEl('circle', { class: 'target-ring', cx: pt.u, cy: pt.v, r: 0.2 }, g);
    svgEl('circle', { class: 'target-dot', cx: pt.u, cy: pt.v, r: 0.07 }, g);
    svgEl(
      'text',
      {
        class: 'target-label',
        x: pt.u,
        y: pt.v - 0.62,
        'font-size': 0.26,
      },
      g,
    ).textContent =
      t.bounceIndex === 1 ? '1er bote en el piso' : '2o bote en el piso';
  }

  private drawOrigin(origin: Vec3): void {
    const pt = this.p(origin);
    const g = svgEl('g', { class: 'origin-marker' }, this.gMarkers);
    svgEl('circle', { class: 'origin-ring', cx: pt.u, cy: pt.v, r: 0.32 }, g);
    svgEl('circle', { class: 'origin-dot', cx: pt.u, cy: pt.v, r: 0.11 }, g);
  }

  private drawAim(aim: Vec3): void {
    const pt = this.p(aim);
    const g = svgEl('g', { class: 'aim-marker' }, this.gMarkers);
    svgEl('circle', { class: 'aim-ring', cx: pt.u, cy: pt.v, r: 0.24 }, g);
    svgEl(
      'line',
      {
        class: 'aim-cross',
        x1: pt.u - 0.34,
        y1: pt.v,
        x2: pt.u + 0.34,
        y2: pt.v,
      },
      g,
    );
    svgEl(
      'line',
      {
        class: 'aim-cross',
        x1: pt.u,
        y1: pt.v - 0.34,
        x2: pt.u,
        y2: pt.v + 0.34,
      },
      g,
    );
  }

  private drawBall(trajectory: Trajectory, t: number): void {
    const p = positionAt(trajectory, t);
    if (!p) return;
    const pt = this.p(p);
    svgEl(
      'circle',
      {
        class: 'ball-dot',
        cx: pt.u,
        cy: pt.v,
        r: Math.max(BALL.radius * 2.6, 0.12),
      },
      this.gBall,
    );
  }

  /**
   * FASE 6 — Dibuja la cancha desplegada y la recta hacia el punto
   * espejado. Solo tiene sentido en planta: es la vista donde el rebote
   * en una lateral se lee como un doblez.
   */
  setUnfold(u: UnfoldedCourt | null): void {
    clear(this.gUnfold);
    if (!u || this.projection.id !== 'plan') {
      this.resetViewBox();
      return;
    }

    const g = this.gUnfold;

    svgEl(
      'rect',
      {
        class: 'unfold-court',
        x: u.rect.x0,
        y: u.rect.z0,
        width: u.rect.x1 - u.rect.x0,
        height: u.rect.z1 - u.rect.z0,
      },
      g,
    );

    if (u.mirroredSamples.length > 1) {
      svgEl(
        'polyline',
        {
          class: 'unfold-path',
          points: pointsAttr(u.mirroredSamples.map((s) => this.p(s.p))),
        },
        g,
      );
    }

    const a = this.p(u.straight[0]);
    const b = this.p(u.straight[1]);
    svgEl(
      'line',
      { class: 'unfold-straight', x1: a.u, y1: a.v, x2: b.u, y2: b.v },
      g,
    );

    svgEl(
      'circle',
      { class: 'unfold-target', cx: b.u, cy: b.v, r: 0.24 },
      g,
    );
    svgEl(
      'text',
      {
        class: 'unfold-label',
        x: b.u,
        y: b.v + 0.55,
        'font-size': 0.26,
      },
      g,
    ).textContent = u.exact ? 'punto espejado' : 'punto espejado (aprox.)';

    // Encuadrar cancha real y espejo a la vez.
    const minU = Math.min(0, u.rect.x0) - PAD;
    const maxU = Math.max(this.projection.width, u.rect.x1) + PAD;
    this.setViewBox(minU, -PAD, maxU - minU, this.projection.height + PAD * 2);
  }

  /**
   * Guia de apuntado mientras se arrastra: linea desde el origen hasta el
   * puntero y el numero de velocidad en vivo. Sin el numero, el arrastre
   * es un gesto a ciegas.
   */
  showAimGuide(from: Vec3, to: Vec3, label: string): void {
    clear(this.gGuide);
    const a = this.p(from);
    const b = this.p(to);

    svgEl(
      'line',
      { class: 'aim-guide', x1: a.u, y1: a.v, x2: b.u, y2: b.v },
      this.gGuide,
    );

    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const len = Math.hypot(dx, dy) || 1;
    const headLen = 0.3;
    const nx = dx / len;
    const ny = dy / len;
    for (const side of [1, -1]) {
      const px = -ny * side * headLen * 0.5;
      const py = nx * side * headLen * 0.5;
      svgEl(
        'line',
        {
          class: 'aim-guide',
          x1: b.u,
          y1: b.v,
          x2: b.u - nx * headLen + px,
          y2: b.v - ny * headLen + py,
        },
        this.gGuide,
      );
    }

    const mid = { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 };
    svgEl(
      'rect',
      {
        class: 'aim-guide-chip',
        x: mid.u - 0.62,
        y: mid.v - 0.24,
        width: 1.24,
        height: 0.48,
        rx: 0.12,
      },
      this.gGuide,
    );
    svgEl(
      'text',
      { class: 'aim-guide-label', x: mid.u, y: mid.v, 'font-size': 0.3 },
      this.gGuide,
    ).textContent = label;
  }

  hideAimGuide(): void {
    clear(this.gGuide);
  }

  /** Reescala el viewBox. Lo usa el zoom de la pizarra. */
  setViewBox(minU: number, minV: number, w: number, h: number): void {
    setAttrs(this.svg, { viewBox: `${minU} ${minV} ${w} ${h}` });
  }

  resetViewBox(): void {
    this.setViewBox(
      -PAD,
      -PAD,
      this.projection.width + PAD * 2,
      this.projection.height + PAD * 2,
    );
  }
}
