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
import { CLASS_LABEL, classify } from '../core/rules.js';
import type { SurfaceId, Vec3 } from '../core/types.js';
import { CourtView2D } from '../render2d/courtSvg.js';
import { pointerToViewBox } from '../render2d/svg.js';
import { pickCourt, pickFloorBounce, pickFloorPlane } from '../render3d/pickers.js';
import type { Scene3D } from '../render3d/scene.js';
import { refineAim, solveAim, type BounceIndex } from '../core/solve.js';
import { venueSimOptions } from '../core/venue.js';
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
  keep: { x: number; z: number }[] = state.trajectory.bounces
    .filter((b) => b.surface === 'floor')
    .slice(0, k - 1)
    .map((b) => ({ x: b.point.x, z: b.point.z })),
  firstSurface: SurfaceId | undefined = state.trajectory.bounces[0]?.surface,
): void => {
  const switchModel = k >= 2 && state.model === 'geometric';
  const model = switchModel ? 'ballistic' : state.model;
  const speedBefore = state.speed;

  const r = solveAim(
    {
      origin: state.shot.origin,
      speed: state.speed,
      model,
      physics: venueSimOptions(state.venue),
      searchSpeed: state.solveSearchSpeed,
      // Partir del tiro actual, y de todas las soluciones quedarse con la
      // que menos mueve los botes anteriores: se mueve lo que se agarra.
      seed: [state.azimuthDeg, state.elevationDeg],
      keepBounces: keep,
      firstSurface,
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

/**
 * Arrastrar un bote de piso EN VIVO: mientras se mueve, el tiro se
 * recalcula en cada fotograma con `refineAim` (Newton desde el tiro que ya
 * se tenia: milisegundos) y la trayectoria sigue al dedo. Al soltar:
 *   - si el ultimo calculo en vivo cayo donde se pedia, se queda ESE tiro
 *     (lo que se ve es lo que queda) y en segundo plano se buscan las
 *     otras formas de dejar el bote ahi, para el panel Apuntar;
 *   - si no, se resuelve entero (barrido y ranking), como antes.
 * Lo usan la planta y la vista 3D.
 */
interface BounceDrag {
  k: BounceIndex;
  /** Botes anteriores al empezar: los que el calculo final intenta conservar. */
  keep: { x: number; z: number }[];
  firstSurface: SurfaceId | undefined;
  moved: boolean;
  pending: { x: number; z: number } | null;
  /** Ultimo punto pedido, resuelto o no. */
  last: { x: number; z: number } | null;
  frame: number | null;
  lastOk: boolean;
  /** Busqueda global en curso (cuando el Newton en vivo no alcanza). */
  global: number | null;
}

const startBounceDrag = (k: BounceIndex, x: number, z: number): BounceDrag => {
  update({ solveTarget: { x, z, bounceIndex: k } });
  return {
    k,
    keep: state.trajectory.bounces
      .filter((b) => b.surface === 'floor')
      .slice(0, k - 1)
      .map((b) => ({ x: b.point.x, z: b.point.z })),
    firstSurface: state.trajectory.bounces[0]?.surface,
    moved: false,
    pending: null,
    last: null,
    frame: null,
    lastOk: true,
    global: null,
  };
};

/** Un paso en vivo. Devuelve si el bote quedo donde se pedia. */
const liveStep = (k: BounceIndex, x: number, z: number): boolean => {
  const model = k >= 2 && state.model === 'geometric' ? 'ballistic' : state.model;
  const r = refineAim(
    {
      origin: state.shot.origin,
      speed: state.speed,
      model,
      physics: venueSimOptions(state.venue),
      searchSpeed: state.solveSearchSpeed,
    },
    { x, z, bounceIndex: k },
    [state.azimuthDeg, state.elevationDeg],
  );
  if (r.ok) {
    update({
      model,
      azimuthDeg: r.azimuthDeg,
      elevationDeg: r.elevationDeg,
      speed: r.speed,
      aim: r.aimPoint,
      presetId: null,
      solveTarget: { x, z, bounceIndex: k },
      solveAlternatives: [],
    });
  } else {
    update({ solveTarget: { x, z, bounceIndex: k } });
  }
  return r.ok;
};

/**
 * Cuando el bote sale de lo que alcanza la familia de tiro actual (el 2.o
 * bote pasa de caer antes a caer despues de la pared del fondo, por
 * ejemplo), el Newton en vivo no puede seguir: el mapa de angulos a botes
 * da un salto. Entonces, con el dedo aun quieto un instante, se busca en
 * todo el abanico (`solveAim`, ~0.3 s) y el arrastre sigue en vivo desde
 * la familia que se encuentre.
 */
const scheduleGlobal = (drag: BounceDrag): void => {
  if (drag.global != null) return;
  drag.global = window.setTimeout(() => {
    drag.global = null;
    const p = drag.last;
    if (!p || drag.lastOk) return;
    const r = solveAim(
      {
        origin: state.shot.origin,
        speed: state.speed,
        model: state.model,
        physics: venueSimOptions(state.venue),
        searchSpeed: state.solveSearchSpeed,
        seed: [state.azimuthDeg, state.elevationDeg],
        keepBounces: drag.keep,
        firstSurface: drag.firstSurface,
      },
      { x: p.x, z: p.z, bounceIndex: drag.k },
    );
    if (!r.ok) return;
    update({
      azimuthDeg: r.azimuthDeg,
      elevationDeg: r.elevationDeg,
      speed: r.speed,
      aim: r.aimPoint,
      presetId: null,
    });
    drag.lastOk = true;
  }, 140);
};

const moveBounceDrag = (drag: BounceDrag, x: number, z: number): void => {
  drag.moved = true;
  drag.pending = { x, z };
  drag.last = { x, z };
  if (drag.frame != null) return;
  drag.frame = requestAnimationFrame(() => {
    drag.frame = null;
    const p = drag.pending;
    drag.pending = null;
    if (!p) return;
    drag.lastOk = liveStep(drag.k, p.x, p.z);
    if (!drag.lastOk) scheduleGlobal(drag);
  });
};

const endBounceDrag = (host: HTMLElement, drag: BounceDrag, x: number, z: number): void => {
  if (drag.frame != null) cancelAnimationFrame(drag.frame);
  drag.frame = null;
  if (drag.global != null) window.clearTimeout(drag.global);
  drag.global = null;
  if (!drag.moved) return;
  if (liveStep(drag.k, x, z)) {
    const label = CLASS_LABEL[classify(state.trajectory, state.shot.origin).classification];
    showToast(host, `${ORDINAL[drag.k - 1]} bote colocado: ${label}`, 'ok');
    // Las otras formas de dejarlo ahi, sin tocar el tiro que se ve.
    window.setTimeout(() => {
      const r = solveAim(
        {
          origin: state.shot.origin,
          speed: state.speed,
          model: state.model,
          physics: venueSimOptions(state.venue),
          seed: [state.azimuthDeg, state.elevationDeg],
          keepBounces: drag.keep,
          firstSurface: drag.firstSurface,
        },
        { x, z, bounceIndex: drag.k },
      );
      if (r.ok) update({ solveAlternatives: r.alternatives ?? [] });
    }, 60);
    return;
  }
  showToast(host, `Calculando dónde pegarle para el ${ORDINAL[drag.k - 1]} bote…`, 'info', 0);
  // Un fotograma para que el aviso se pinte antes de resolver.
  window.setTimeout(
    () => placeFloorBounce(host, drag.k, x, z, drag.keep, drag.firstSurface),
    30,
  );
};

export const attachPlanInput = (view: CourtView2D): void => {
  const svg = view.svg;
  svg.classList.add('court2d--interactive');
  const reference = Math.min(view.projection.width, view.projection.height) * 0.75;
  let session: DragSession | null = null;
  /** Arrastre de un bote de piso: 1, 2 o 3. */
  let bounceDrag: (BounceDrag & { pointerId: number }) | null = null;
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
      bounceDrag = { ...startBounceDrag(k as BounceIndex, point.x, point.z), pointerId: e.pointerId };
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
      // El tiro sigue al dedo: se recalcula en vivo en cada fotograma.
      const point = toCourt(e);
      moveBounceDrag(bounceDrag, point.x, point.z);
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
      const drag = bounceDrag;
      bounceDrag = null;
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      const point = toCourt(e);
      endBounceDrag(host, drag, point.x, point.z);
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
 * En 3D el arrastre significa "orbitar la camara", salvo si empieza sobre
 * un bote de piso 1, 2 o 3: entonces se arrastra el bote por el piso, con
 * la camara quieta, y el tiro se recalcula en vivo como en la planta. Un
 * clic limpio (sin moverse) coloca al jugador o apunta a la frontal.
 */
export const attach3DInput = (scene: Scene3D): void => {
  const canvas = scene.renderer.domElement;
  const host = (canvas.parentElement ?? document.body) as HTMLElement;
  let downAt: { x: number; y: number; id: number } | null = null;
  let bounceDrag: (BounceDrag & { pointerId: number }) | null = null;

  // En fase de captura: tiene que ir ANTES que el pointerdown de
  // OrbitControls, que se registro primero en el mismo canvas, para poder
  // quedarse con el gesto sin que la camara empiece a orbitar.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const k = pickFloorBounce(scene, e);
    if (k != null && k >= 1 && k <= 3) {
      const at = pickFloorPlane(scene, e);
      if (at) {
        scene.controls.enabled = false;
        bounceDrag = { ...startBounceDrag(k as BounceIndex, at.x, at.z), pointerId: e.pointerId };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    downAt = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (!bounceDrag || e.pointerId !== bounceDrag.pointerId) return;
    const at = pickFloorPlane(scene, e);
    if (at) moveBounceDrag(bounceDrag, at.x, at.z);
  });

  const endDrag = (e: PointerEvent): boolean => {
    if (!bounceDrag || e.pointerId !== bounceDrag.pointerId) return false;
    const drag = bounceDrag;
    bounceDrag = null;
    scene.controls.enabled = true;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const at = pickFloorPlane(scene, e);
    if (at) endBounceDrag(host, drag, at.x, at.z);
    return true;
  };
  canvas.addEventListener('pointercancel', (e) => {
    endDrag(e);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (endDrag(e)) return;
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
