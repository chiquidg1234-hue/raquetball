/**
 * FASE 5 — Modo de input A: clic y arrastre.
 *
 * Es el modelo mental del billar, y es el que se usa el 90 % del tiempo.
 * El gesto cambia de significado segun la vista, porque en cada vista
 * significa una cosa distinta:
 *
 *   Planta          presionar = donde estoy parado
 *                   arrastrar = hacia donde apunto y con cuanta fuerza
 *   Alzado frontal  presionar = punto de mira en la pared frontal
 *                   arrastrar = fuerza
 *   3D              clic en el piso  = donde estoy parado
 *                   clic en la frontal = punto de mira
 *                   (arrastrar en 3D es orbitar la camara, no tirar)
 *
 * En todos los casos la direccion sale de normalize(aim - origin), y la
 * velocidad del largo del arrastre.
 */

import { SPEED } from '../core/constants.js';
import { CENTER_BOX, clampToCourt } from '../core/court.js';
import type { Vec3 } from '../core/types.js';
import { CourtView2D } from '../render2d/courtSvg.js';
import { pointerToViewBox } from '../render2d/svg.js';
import { pickCourt } from '../render3d/pickers.js';
import type { Scene3D } from '../render3d/scene.js';
import { solveAim, type BounceIndex } from '../core/solve.js';
import { aimAt, state, update } from './state.js';
import { showToast } from './toast.js';

/** Un arrastre mas corto que esto se considera un clic. */
const CLICK_SLOP_M = 0.18;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/**
 * Largo de arrastre -> velocidad. La escala es relativa al tamano de la
 * vista, para que el mismo gesto de la mano de la misma potencia en la
 * planta (12 m de largo) y en el alzado frontal (6 m).
 */
const speedFromDrag = (distance: number, reference: number): number => {
  const k = clamp(distance / reference, 0, 1);
  return Math.round(SPEED.min + k * (SPEED.max - SPEED.min));
};

interface DragSession {
  pointerId: number;
  origin: Vec3;
  /** El puntero empezo sobre el jugador: no lo recolocamos. */
  movedPlayer: boolean;
  dragged: boolean;
}

const ORDINAL = ['1.er', '2.º', '3.er'];

/**
 * Recalcula el tiro para que el bote de PISO k caiga en (x, z). Mantiene
 * al jugador donde esta. Con el motor geometrico no hay 2.º bote real (sin
 * gravedad, lo que sube del piso no vuelve a bajar salvo por el techo),
 * asi que para los botes 2 y 3 se pasa al balistico y se avisa.
 */
const placeFloorBounce = (
  host: HTMLElement,
  k: BounceIndex,
  x: number,
  z: number,
): void => {
  const switchModel = k >= 2 && state.model === 'geometric';
  const model = switchModel ? 'ballistic' : state.model;
  const speedBefore = state.speed;

  const r = solveAim(
    {
      origin: state.origin,
      speed: state.speed,
      model,
      searchSpeed: state.solveSearchSpeed,
      // Partir del tiro actual, y de todas las soluciones quedarse con la
      // que menos mueve los botes anteriores: se mueve lo que se agarra.
      seed: [state.azimuthDeg, state.elevationDeg],
      keepBounces: state.trajectory.bounces
        .filter((b) => b.surface === 'floor')
        .slice(0, k - 1)
        .map((b) => ({ x: b.point.x, z: b.point.z })),
      firstSurface: state.trajectory.bounces[0]?.surface,
    },
    { x, z, bounceIndex: k },
  );

  if (!r.ok) {
    update({ solveTarget: { x, z, bounceIndex: k } });
    showToast(
      host,
      `No hay tiro legal que deje el ${ORDINAL[k - 1]} bote ahí desde esta posición. Lo más cerca: ${r.error.toFixed(2)} m.`,
      'warn',
      5200,
    );
    return;
  }

  update({
    model,
    azimuthDeg: r.azimuthDeg,
    elevationDeg: r.elevationDeg,
    speed: r.speed,
    aim: r.aimPoint,
    presetId: null,
    solveTarget: { x, z, bounceIndex: k },
    solveAlternatives: r.alternatives ?? [],
  });

  const cm = Math.max(0, Math.round(r.error * 100));
  const parts = [`${ORDINAL[k - 1]} bote colocado con un ${r.kindLabel ?? 'tiro'} (error ${cm} cm)`];
  if (Math.abs(r.speed - speedBefore) > 0.05) {
    // Solo pasa si con la fuerza que habia no existia ningun tiro legal.
    parts.push(`con ${speedBefore.toFixed(0)} m/s no llegaba: ahora ${r.speed.toFixed(0)} m/s`);
  }
  if (switchModel) parts.push('paso a balístico: sin gravedad no hay 2.º bote');
  showToast(host, parts.join(' · '), 'ok');
};

export const attachPlanInput = (view: CourtView2D): void => {
  const svg = view.svg;
  svg.classList.add('court2d--interactive');
  const reference = Math.min(view.projection.width, view.projection.height) * 0.75;
  let session: DragSession | null = null;
  /** Arrastre de un bote de piso: 1, 2 o 3. */
  let bounceDrag: { k: BounceIndex; pointerId: number; moved: boolean } | null = null;
  const host = (svg.parentElement ?? document.body) as HTMLElement;

  const toCourt = (e: PointerEvent): Vec3 => {
    const { u, v } = pointerToViewBox(svg, e);
    return clampToCourt(view.projection.unproject({ u, v }, state.origin.y));
  };

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const point = toCourt(e);

    // FASE 10: mientras se esta eligiendo objetivo, el clic no mueve al
    // jugador, marca donde tiene que caer la pelota.
    if (state.targetPickMode) {
      update({
        solveTarget: {
          x: point.x,
          z: point.z,
          bounceIndex: state.solveTarget?.bounceIndex ?? 1,
        },
      });
      e.preventDefault();
      return;
    }

    // Agarrar un bote de piso (1, 2 o 3) para moverlo. Va antes que
    // colocar al jugador: el marcador esta encima del suelo.
    const grabbed = (e.target as Element | null)?.closest?.('[data-floor-bounce]');
    const k = Number(grabbed?.getAttribute('data-floor-bounce'));
    if (grabbed && k >= 1 && k <= 3) {
      bounceDrag = { k: k as BounceIndex, pointerId: e.pointerId, moved: false };
      update({ solveTarget: { x: point.x, z: point.z, bounceIndex: k as BounceIndex } });
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const nearPlayer =
      Math.hypot(point.x - state.origin.x, point.z - state.origin.z) < 0.55;

    const origin = nearPlayer ? state.origin : { ...point, y: state.origin.y };
    if (!nearPlayer) {
      update({ origin, presetId: null, aim: null });
    }
    session = {
      pointerId: e.pointerId,
      origin,
      movedPlayer: !nearPlayer,
      dragged: false,
    };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (bounceDrag && e.pointerId === bounceDrag.pointerId) {
      // Mientras se arrastra solo se mueve el objetivo; el tiro se
      // recalcula al soltar, que resolver en cada movimiento seria lento.
      const point = toCourt(e);
      bounceDrag.moved = true;
      update({ solveTarget: { x: point.x, z: point.z, bounceIndex: bounceDrag.k } });
      return;
    }
    if (!session || e.pointerId !== session.pointerId) return;
    const point = toCourt(e);
    const dx = point.x - session.origin.x;
    const dz = point.z - session.origin.z;
    const distance = Math.hypot(dx, dz);
    if (distance < CLICK_SLOP_M) return;

    session.dragged = true;
    const speed = speedFromDrag(distance, reference);
    // En planta solo se decide el azimut; la elevacion la manda el slider.
    const azimuthDeg = (Math.atan2(dx, -dz) * 180) / Math.PI;
    update({ azimuthDeg, speed, presetId: null, aim: null });
    view.showAimGuide(session.origin, point, `${speed} m/s`);
  });

  const end = (e: PointerEvent): void => {
    if (bounceDrag && e.pointerId === bounceDrag.pointerId) {
      const { k, moved } = bounceDrag;
      bounceDrag = null;
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      if (!moved) return;
      const point = toCourt(e);
      showToast(host, `Calculando dónde pegarle para el ${ORDINAL[k - 1]} bote…`, 'info', 0);
      // Un fotograma para que el aviso se pinte antes de resolver.
      window.setTimeout(() => placeFloorBounce(host, k, point.x, point.z), 30);
      return;
    }
    if (!session || e.pointerId !== session.pointerId) return;
    view.hideAimGuide();
    session = null;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
};

export const attachFrontInput = (view: CourtView2D): void => {
  const svg = view.svg;
  svg.classList.add('court2d--interactive');
  const reference = Math.min(view.projection.width, view.projection.height) * 0.75;
  let pointerId: number | null = null;
  let aim: Vec3 | null = null;

  const toWall = (e: PointerEvent): Vec3 => {
    const { u, v } = pointerToViewBox(svg, e);
    const p = view.projection.unproject({ u, v }, CENTER_BOX.zMin);
    return {
      x: clamp(p.x, CENTER_BOX.xMin, CENTER_BOX.xMax),
      y: clamp(p.y, CENTER_BOX.yMin, CENTER_BOX.yMax),
      z: CENTER_BOX.zMin,
    };
  };

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    aim = toWall(e);
    aimAt(aim);
    pointerId = e.pointerId;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId || !aim) return;
    const point = toWall(e);
    const distance = Math.hypot(point.x - aim.x, point.y - aim.y);
    if (distance < CLICK_SLOP_M) return;
    const speed = speedFromDrag(distance, reference);
    update({ speed, presetId: null });
    view.showAimGuide(aim, point, `${speed} m/s`);
  });

  const end = (e: PointerEvent): void => {
    if (pointerId !== e.pointerId) return;
    view.hideAimGuide();
    pointerId = null;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
};

/**
 * En 3D el arrastre ya significa "orbitar la camara", asi que aqui solo
 * se interpreta el clic limpio: si el puntero se movio, era una orbita.
 */
export const attach3DInput = (scene: Scene3D): void => {
  const canvas = scene.renderer.domElement;
  let downAt: { x: number; y: number; id: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || downAt.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 5) return; // era una orbita

    const pick = pickCourt(scene, e);
    if (!pick) return;

    if (pick.surface === 'floor') {
      update({
        origin: { x: pick.point.x, y: state.origin.y, z: pick.point.z },
        presetId: null,
        aim: null,
      });
    } else {
      aimAt({ x: pick.point.x, y: pick.point.y, z: CENTER_BOX.zMin });
    }
  });
};
