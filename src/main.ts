/**
 * Punto de entrada. Monta las vistas, las conecta al estado y arranca el
 * bucle de reproduccion. Todo lo demas cuelga de `ui/state.ts`.
 */

import './style.css';

import { cloneBoard } from './core/board.js';
import { simulate } from './core/engine.js';
import { isSkip } from './core/contacts.js';
import { unfoldFirstSideBounce } from './core/unfold.js';
import { BoardOverlay } from './render2d/overlay.js';
import { canvasToPng, svgToPng } from './persist/exportPng.js';
import { toVenueDoc } from './persist/schema.js';
import { readHashDoc, syncHash } from './persist/share.js';
import {
  loadBoard,
  loadPlays,
  loadVenue,
  loadViewPrefs,
  storeBoard,
  storeVenue,
  storeViewPrefs,
} from './persist/storage.js';
import { fromShotDoc } from './persist/schema.js';
import { CourtView2D } from './render2d/courtSvg.js';
import { CAMERA_PRESETS, Scene3D } from './render3d/scene.js';
import {
  PROJECTIONS,
  type ProjectionId,
} from './render2d/projections.js';
import type { Trajectory } from './core/types.js';
import { clearNode, el, mustGet } from './ui/dom.js';
import {
  attach3DInput,
  attachFrontInput,
  attachPlanInput,
} from './ui/dragInput.js';
import { fromAzimuthElevation } from './core/vec3.js';
import { createInspectorPanel } from './ui/inspector.js';
import type { PanelView } from './ui/panels.js';
import { createLibraryPanel } from './ui/panelLibrary.js';
import { downloadBlock, openModal } from './ui/modal.js';
import { createPresetPanel } from './ui/panelPresets.js';
import { createBoardPanel } from './ui/panelBoard.js';
import { createSolvePanel } from './ui/panelSolve.js';
import { createShotPanel } from './ui/panelSliders.js';
import {
  applyDoc,
  currentDoc,
  simOptionsFor,
  timelineStart,
  state,
  hitSpotS,
  subscribe,
  toggleServeMode,
  update,
  type AppState,
  type HitSpot,
  type LayoutId,
} from './ui/state.js';
import { createVenuePanel } from './ui/panelVenue.js';
import { AXS_170T, requiredHeadSpeed, sliceSpin } from './core/racquet.js';
import { strokeAdvice, strokeGeometry, type Stroke } from './core/stroke.js';

const views = new Map<ProjectionId, CourtView2D>();
const panels: PanelView[] = [];
let scene3d: Scene3D | null = null;
let boardOverlay: BoardOverlay | null = null;
let ghostCache: { key: string; list: Trajectory[] } = { key: '', list: [] };
let activePanel = 'shot';

// ------------------------------------------------------------- vistas 2D

const sameShot = (a: { azimuthDeg: number; elevationDeg: number; speed: number }): boolean =>
  Math.abs(a.azimuthDeg - state.azimuthDeg) < 1e-3 &&
  Math.abs(a.elevationDeg - state.elevationDeg) < 1e-3 &&
  Math.abs(a.speed - state.speed) < 1e-3;

/**
 * Casi siempre hay varias formas de dejar un bote en el mismo sitio. Se
 * ofrecen mientras el tiro actual sea una de ellas; en cuanto se toca un
 * slider y el tiro deja de serlo, desaparecen solas.
 */
const syncChoices = (): void => {
  const host = document.getElementById('solve-choices');
  if (!host) return;
  const alts = state.solveAlternatives;
  const current = alts.find(sameShot);
  if (alts.length < 2 || !current) {
    host.hidden = true;
    return;
  }
  clearNode(host);
  host.append(el('div', { class: 'choices-title', text: 'Otras formas de dejarlo ahi' }));
  for (const alt of alts) {
    const b = el('button', {
      class: alt === current ? 'choice choice--active' : 'choice',
      type: 'button',
      title: alt.family,
    }, [
      el('span', { class: 'choice-kind', text: alt.kindLabel }),
      el('span', { class: 'choice-seq', text: alt.family }),
    ]);
    b.addEventListener('click', () =>
      update({
        azimuthDeg: alt.azimuthDeg,
        elevationDeg: alt.elevationDeg,
        speed: alt.speed,
        presetId: null,
        aim: null,
      }),
    );
    host.append(b);
  }
  host.hidden = false;
};

/** Leyenda de la planta: bote de piso frente a rebote de pared. */
const legend = (): HTMLElement =>
  el('div', { class: 'viewport-legend', 'aria-hidden': 'true' }, [
    el('span', { class: 'legend-item' }, [
      el('span', { class: 'legend-floor', text: '1' }),
      'bote de piso',
    ]),
    el('span', { class: 'legend-item' }, [
      el('span', { class: 'legend-wall' }, [el('span', { text: 'F' })]),
      'pared',
    ]),
  ]);

const mount2D = (): void => {
  for (const projection of PROJECTIONS) {
    const host = mustGet(`viewport-${projection.id}`);
    const view = new CourtView2D(projection);
    host.appendChild(
      el('div', { class: 'viewport-label', text: projection.label }),
    );
    host.appendChild(view.svg);
    host.appendChild(
      el('div', { class: 'viewport-hint', text: projection.hint }),
    );
    if (projection.id === 'plan') host.appendChild(legend());
    views.set(projection.id, view);
  }

  // Formas alternativas de dejar el bote arrastrado en el mismo sitio.
  mustGet('viewport-plan').appendChild(
    el('div', { class: 'choices', id: 'solve-choices', hidden: true }),
  );

  // Aviso de skip: tiene que verse encima de la cancha, no solo como una
  // etiqueta en el panel lateral.
  mustGet('viewports').appendChild(
    el('div', { class: 'skip-banner', id: 'skip-banner', hidden: true, role: 'alert' }, [
      el('strong', { text: 'SKIP' }),
      el('span', {
        text: 'La pelota toca el piso antes que la frontal. El punto se pierde.',
      }),
    ]),
  );

  // Modo de input A. La lateral se deja de solo lectura: descarta X, asi
  // que un clic ahi no puede decidir donde esta parado el jugador.
  attachPlanInput(views.get('plan')!);
  attachFrontInput(views.get('front')!);

  // FASE 9: la pizarra vive sobre la planta, que es la vista que un
  // entrenador dibuja en una servilleta.
  const plan = views.get('plan')!;
  boardOverlay = new BoardOverlay(plan.overlayLayer, plan.svg, plan.projection, {
    getBoard: () => state.board,
    getTool: () => state.tool,
    setBoard: (next) => {
      update({ board: next });
      storeBoard(next);
    },
    askText: () => window.prompt('Texto de la nota'),
  });
  boardOverlay.render();
};

/**
 * Los pasos anteriores de la jugada se dibujan en gris. Es lo que
 * convierte una secuencia de tiros sueltos en una jugada legible.
 */
const ghostsForPlay = (): Trajectory[] => {
  const play = state.plays.find((p) => p.id === state.currentPlayId);
  if (!play || state.playStep <= 0) return [];
  // El aire tambien es parte de la clave: cambiar de ciudad cambia los fantasmas.
  const key = `${play.id}:${state.playStep}:${JSON.stringify(toVenueDoc(state.venue))}`;
  if (ghostCache.key === key) return ghostCache.list;

  const list: Trajectory[] = [];
  for (let i = 0; i < state.playStep && i < play.steps.length; i++) {
    const parsed = fromShotDoc(play.steps[i]!.shot);
    if (!parsed) continue;
    list.push(
      simulate(
        {
          origin: parsed.origin,
          direction: fromAzimuthElevation(parsed.azimuthDeg, parsed.elevationDeg),
          speed: parsed.speed,
        },
        simOptionsFor(parsed.model, state.venue),
      ),
    );
  }
  ghostCache = { key, list };
  return list;
};

// ------------------------------------------------------------- vista 3D

const mount3D = (): void => {
  const canvas = mustGet<HTMLCanvasElement>('canvas3d');
  try {
    scene3d = new Scene3D(canvas);
  } catch (err) {
    // Sin WebGL la app sigue siendo util: las tres vistas 2D lo cuentan
    // todo menos la sensacion de volumen.
    console.warn('WebGL no disponible, se sigue solo con las vistas 2D', err);
    mustGet('viewport-3d').appendChild(
      el('div', {
        class: 'viewport-hint',
        style: 'opacity:1;top:50%;text-align:center',
        text: 'Este navegador no puede dibujar 3D. Las vistas 2D siguen funcionando.',
      }),
    );
    return;
  }

  attach3DInput(scene3d);
  // Solo en el servidor de desarrollo, para las pruebas de navegador del
  // arrastre en 3D. La build lo elimina (import.meta.env.DEV es false).
  if (import.meta.env.DEV) {
    (window as unknown as { __raquet: unknown }).__raquet = { scene: scene3d, state, update };
  }

  const host = mustGet('camera-presets');
  for (const preset of CAMERA_PRESETS) {
    const b = el('button', {
      class: 'btn',
      type: 'button',
      'data-camera': preset.id,
      text: preset.label,
    });
    b.addEventListener('click', () => {
      scene3d?.applyCameraPreset(preset.id);
      for (const other of host.querySelectorAll('[data-camera]')) {
        other.classList.toggle('btn--active', other === b);
      }
    });
    if (preset.id === 'behind') b.classList.add('btn--active');
    host.appendChild(b);
  }

  // Camara "Golpe": de cerca, sobre la mano y la raqueta del tiro actual.
  const close = el('button', {
    class: 'btn',
    type: 'button',
    'data-camera': 'contact',
    text: 'Golpe',
    title: 'Ver de cerca la mano, la raqueta y los pies',
  });
  close.addEventListener('click', () => {
    if (!state.racquetStroke) update({ racquetStroke: 'forehand' });
    const g = strokeGeometry(
      state.shot.origin,
      state.shot.direction,
      state.racquetStroke ?? 'forehand',
      state.handedness,
    );
    scene3d?.frameContact(state.shot.origin, state.shot.direction, g.handleDir);
    for (const other of host.querySelectorAll('[data-camera]')) {
      other.classList.toggle('btn--active', other === close);
    }
  });
  host.appendChild(close);

  mountRacquetBar();
};

// ------------------------------------------------------ mano y raqueta

/**
 * Conmutador derecha / reves / sin raqueta y diestro / zurdo, y un rotulo
 * con lo que dicen las fuentes del punto de contacto.
 */
const mountRacquetBar = (): void => {
  const host = mustGet('viewport-3d');
  const bar = el('div', { class: 'racquet-bar', id: 'racquet-bar' });
  const strokes: [Stroke | null, string][] = [
    ['forehand', 'Derecha'],
    ['backhand', 'Revés'],
    [null, 'Sin raqueta'],
  ];
  for (const [stroke, label] of strokes) {
    const b = el('button', {
      class: 'btn',
      type: 'button',
      'data-stroke': stroke ?? 'none',
      text: label,
    });
    b.addEventListener('click', () => update({ racquetStroke: stroke }));
    bar.appendChild(b);
  }
  bar.appendChild(el('span', { class: 'racquet-sep' }));
  for (const [hand, label] of [
    ['right', 'Diestro'],
    ['left', 'Zurdo'],
  ] as const) {
    const b = el('button', { class: 'btn', type: 'button', 'data-hand': hand, text: label });
    b.addEventListener('click', () => update({ handedness: hand }));
    bar.appendChild(b);
  }
  bar.appendChild(el('span', { class: 'racquet-sep' }));
  const spot = document.createElement('select');
  spot.className = 'select select--small';
  spot.setAttribute('data-field', 'hit-spot');
  spot.title = 'En qué punto de la raqueta le pegas';
  for (const [value, label] of [
    ['cop', 'Pegar en: centro de percusión'],
    ['wrist', 'Pegar en: más salida (muñeca)'],
    ['arm', 'Pegar en: más salida (brazo)'],
  ] as const) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    spot.appendChild(o);
  }
  spot.addEventListener('change', () => update({ hitSpot: spot.value as HitSpot, presetId: null }));
  bar.appendChild(spot);
  const caption = el('div', { class: 'racquet-caption', id: 'racquet-caption' });
  host.append(bar, caption);
};

/** Una linea con lo que ensena la raqueta: donde se le pega y que pide. */
const racquetCaption = (): string => {
  const stroke = state.racquetStroke!;
  const s = hitSpotS(state.hitSpot);
  const where =
    state.hitSpot === 'cop'
      ? 'en el centro de percusión (verde): la mano no recibe tirón'
      : `en el punto de más salida con ${state.hitSpot === 'wrist' ? 'golpe de muñeca' : 'el brazo entero'} (naranja)`;
  const head = requiredHeadSpeed(state.speed, s);
  const slice = state.sliceDeg
    ? ` · ${state.sliceDeg > 0 ? 'cortado' : 'liftado'} ${Math.abs(state.sliceDeg).toFixed(0)}°: ${Math.round(sliceSpin(state.speed, state.sliceDeg, state.shot.direction, s).rpm)} rpm`
    : '';
  return `${AXS_170T.name}. Le pegas ${where}, a ${(s * 100).toFixed(0)} cm del final del mango: para ${state.speed.toFixed(0)} m/s la raqueta tiene que ir a ${head.toFixed(0)} m/s ahí${slice}. ${strokeAdvice(stroke)} Aproximados: los pies, y la forma y el reparto de masa de la raqueta (Gearbox publica peso, balance, largo y superficie).`;
};

const syncRacquet = (): void => {
  if (scene3d) {
    scene3d.racquet.setPose(
      state.shot.origin,
      state.shot.direction,
      state.racquetStroke,
      state.handedness,
      { hitS: hitSpotS(state.hitSpot), bevelDeg: state.sliceDeg },
    );
    scene3d.racquet.setSwing(state.playhead);
  }
  const spot = document.querySelector<HTMLSelectElement>('[data-field="hit-spot"]');
  if (spot) {
    spot.value = state.hitSpot;
    spot.hidden = !state.racquetStroke;
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-stroke]')) {
    b.classList.toggle('btn--active', b.dataset.stroke === (state.racquetStroke ?? 'none'));
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-hand]')) {
    b.classList.toggle('btn--active', b.dataset.hand === state.handedness);
    b.hidden = !state.racquetStroke;
  }
  const caption = document.getElementById('racquet-caption');
  if (caption) {
    caption.hidden = !state.racquetStroke;
    if (state.racquetStroke) caption.textContent = racquetCaption();
  }
};

// ------------------------------------------------------------- pestanas

const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: 'split', label: 'Todo' },
  { id: '3d', label: '3D' },
  { id: 'plan', label: 'Planta' },
  { id: 'front', label: 'Frontal' },
  { id: 'side', label: 'Lateral' },
];

const mountLayoutTabs = (): void => {
  const host = mustGet('layout-tabs');
  for (const layout of LAYOUTS) {
    const tab = el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      'data-layout': layout.id,
      text: layout.label,
    });
    tab.addEventListener('click', () => update({ layout: layout.id }));
    host.appendChild(tab);
  }
};

const syncLayout = (): void => {
  mustGet('viewports').dataset.layout = state.layout;
  for (const tab of document.querySelectorAll<HTMLElement>('[data-layout]')) {
    if (tab.classList.contains('tab')) {
      tab.setAttribute(
        'aria-selected',
        String(tab.dataset.layout === state.layout),
      );
    }
  }
};

// ------------------------------------------------------------- panel

const mountPanel = (): void => {
  panels.push(
    createShotPanel(),
    createVenuePanel(),
    createPresetPanel(),
    createSolvePanel(),
    createBoardPanel(),
    createInspectorPanel(),
    createLibraryPanel(),
  );

  const tabs = mustGet('panel-tabs');
  const body = mustGet('panel-body');

  for (const panel of panels) {
    const tab = el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      'data-panel': panel.id,
      text: panel.label,
    });
    tab.addEventListener('click', () => selectPanel(panel.id));
    tabs.appendChild(tab);
    body.appendChild(panel.root);
  }

  // En movil el panel ocupa casi la mitad de la pantalla. Poder plegarlo
  // es lo que permite ver la cancha entera sin cambiar de vista.
  const collapse = el('button', {
    class: 'panel-collapse',
    type: 'button',
    'data-collapse': '',
    'aria-label': 'Plegar o desplegar el panel',
    title: 'Plegar el panel',
    text: '▾',
  });
  collapse.addEventListener('click', () => {
    const panel = mustGet('panel');
    const collapsed = panel.classList.toggle('panel--collapsed');
    collapse.textContent = collapsed ? '▴' : '▾';
    scene3d?.resize();
  });
  tabs.appendChild(collapse);

  selectPanel(activePanel);
};

const selectPanel = (id: string): void => {
  activePanel = id;
  for (const panel of panels) {
    panel.root.hidden = panel.id !== id;
  }
  for (const tab of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.panel === id));
  }
};

/** Añade un panel despues del arranque (lo usan las fases 6 y 9). */
export const registerPanel = (panel: PanelView): void => {
  panels.push(panel);
  const tab = el('button', {
    class: 'tab',
    type: 'button',
    role: 'tab',
    'data-panel': panel.id,
    text: panel.label,
  });
  tab.addEventListener('click', () => selectPanel(panel.id));
  mustGet('panel-tabs').appendChild(tab);
  mustGet('panel-body').appendChild(panel.root);
  panel.root.hidden = panel.id !== activePanel;
};

// ------------------------------------------------------------- barra sup.

const mountTopbarRight = (): void => {
  const host = mustGet('topbar-right');

  const models: { id: AppState['model']; label: string; title: string }[] = [
    {
      id: 'geometric',
      label: 'Geometrico',
      title: 'Reflexion ideal: sin gravedad, sin arrastre, sin perdida.',
    },
    {
      id: 'ballistic',
      label: 'Balistico',
      title: 'Gravedad, arrastre y COR. Lo que hace la pelota de verdad.',
    },
  ];

  const group = el('div', { class: 'layout-tabs' });
  for (const model of models) {
    const b = el('button', {
      class: 'tab',
      type: 'button',
      'data-model': model.id,
      title: model.title,
      text: model.label,
    });
    b.addEventListener('click', () => update({ model: model.id }));
    group.appendChild(b);
  }
  host.appendChild(group);

  const serve = el('button', {
    class: 'btn',
    type: 'button',
    'data-serve-mode': '',
    title: 'Juzga el tiro como saque: corto, largo, tres paredes, techo.',
    text: 'Modo saque',
  });
  serve.addEventListener('click', () => toggleServeMode());
  host.appendChild(serve);

  const png = el('button', {
    class: 'btn',
    type: 'button',
    title: 'Exportar una vista a PNG',
    text: 'PNG',
  });
  png.addEventListener('click', () => openExportModal());
  host.appendChild(png);
};

// ------------------------------------------------------------- export PNG

const openExportModal = (): void => {
  const status = el('div', { class: 'field-hint', text: 'Elige que vista exportar.' });
  const out = el('div');

  const run = async (label: string, make: () => Promise<{ dataUrl: string }>) => {
    status.textContent = 'Generando…';
    clearNode(out);
    try {
      const { dataUrl } = await make();
      status.textContent = '';
      out.appendChild(downloadBlock(dataUrl, `racquetball-${label}.png`, true));
    } catch (err) {
      status.textContent = `No se pudo exportar: ${(err as Error).message}`;
    }
  };

  const buttons: Node[] = [];
  for (const projection of PROJECTIONS) {
    const b = el('button', { class: 'btn', type: 'button', text: projection.label });
    b.addEventListener('click', () => {
      const view = views.get(projection.id);
      if (view) void run(projection.id, () => svgToPng(view.svg));
    });
    buttons.push(b);
  }
  if (scene3d) {
    const b = el('button', { class: 'btn', type: 'button', text: '3D' });
    b.addEventListener('click', () => {
      scene3d!.invalidate();
      scene3d!.render();
      void run('3d', async () => canvasToPng(scene3d!.renderer.domElement));
    });
    buttons.push(b);
  }

  openModal('Exportar a PNG', [
    el('div', { class: 'copy-actions' }, buttons),
    status,
    out,
  ]);
};

const syncTopbar = (): void => {
  for (const b of document.querySelectorAll<HTMLElement>('[data-model]')) {
    b.setAttribute('aria-selected', String(b.dataset.model === state.model));
  }
  const serve = document.querySelector<HTMLElement>('[data-serve-mode]');
  serve?.classList.toggle('btn--active', state.serveMode);
};

// ------------------------------------------------------------ responsive

/**
 * En movil la barra de motor / saque / PNG no cabe arriba sin recortar
 * las pestanas de vista, asi que se MUEVE al panel. Se mueve el mismo
 * nodo, no se duplica: duplicarlo obligaria a sincronizar dos copias de
 * cada boton y es la clase de cosa que se desincroniza sola.
 */
const mountResponsive = (): void => {
  const bar = mustGet('topbar-right');
  const topbar = document.querySelector('.topbar');
  const panel = mustGet('panel');
  const query = window.matchMedia('(max-width: 860px)');

  const place = (): void => {
    if (query.matches) {
      if (bar.parentElement !== panel) {
        bar.classList.add('panel-toolbar');
        panel.insertBefore(bar, panel.firstChild);
      }
    } else if (bar.parentElement !== topbar) {
      bar.classList.remove('panel-toolbar');
      topbar?.appendChild(bar);
    }
    scene3d?.resize();
  };

  query.addEventListener('change', place);
  place();
};

// ------------------------------------------------------------- timeline

let scrub: HTMLInputElement;
let timeLabel: HTMLElement;
let playButton: HTMLButtonElement;

const mountTimeline = (): void => {
  const host = mustGet('timeline');
  clearNode(host);

  playButton = el('button', {
    class: 'btn btn--icon',
    type: 'button',
    title: 'Reproducir (espacio)',
    text: '▶',
  });
  playButton.addEventListener('click', () => togglePlay());

  scrub = el('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.001,
    value: 0,
    'aria-label': 'Instante de la trayectoria',
  }) as HTMLInputElement;
  scrub.addEventListener('input', () => {
    update({ playing: false, playhead: Number(scrub.value) });
  });

  timeLabel = el('span', { class: 'timeline-time', text: '0.000 s' });

  const rate = el('select', { class: 'btn', 'aria-label': 'Velocidad' });
  for (const [label, value] of [
    ['1/20', 0.05],
    ['1/8', 0.125],
    ['1/4', 0.25],
    ['1/2', 0.5],
    ['1x', 1],
  ] as const) {
    const option = el('option', { value, text: label });
    if (value === state.playRate) option.setAttribute('selected', '');
    rate.appendChild(option);
  }
  rate.addEventListener('change', () =>
    update({ playRate: Number((rate as HTMLSelectElement).value) }),
  );

  host.append(playButton, scrub, timeLabel, rate);
};

const togglePlay = (): void => {
  if (!state.playing && state.playhead >= state.trajectory.totalTime - 1e-6) {
    // Desde el principio: en un saque, desde que la pelota sale de la mano.
    update({ playhead: timelineStart() });
  }
  update({ playing: !state.playing });
};

const syncTimeline = (): void => {
  const total = Math.max(state.trajectory.totalTime, 1e-3);
  scrub.min = String(timelineStart());
  scrub.max = String(total);
  if (document.activeElement !== scrub) scrub.value = String(state.playhead);
  // En pantallas estrechas el formato largo se corta a media cifra, que
  // es peor que no mostrarlo: se acorta en vez de truncarse.
  // Antes del golpe: con saque, la pelota sale de la mano; sin saque, solo
  // es la raqueta viniendo de atras.
  timeLabel.textContent =
    state.playhead < 0
      ? `${state.toss ? 'mano' : 'swing'} ${state.playhead.toFixed(2)} s`
      : window.innerWidth < 560
        ? `${state.playhead.toFixed(2)}/${total.toFixed(1)}s`
        : `${state.playhead.toFixed(3)} s / ${total.toFixed(2)} s`;
  playButton.textContent = state.playing ? '❚❚' : '▶';
};

// ------------------------------------------------------------- redibujo

/**
 * `changed` sin valor significa "puede haber cambiado todo": es el caso
 * del arranque y el de restaurar un tiro desde la URL. Los paneles tienen
 * que recibir el conjunto COMPLETO de claves, no uno vacio, o los sliders
 * se quedan mostrando los valores con los que se construyeron.
 */
const ALL_KEYS = (): ReadonlySet<keyof AppState> =>
  new Set(Object.keys(state) as (keyof AppState)[]);

const redraw = (changed?: ReadonlySet<string>): void => {
  const trajectoryChanged = !changed || changed.has('trajectory');
  if (!changed || changed.has('model') || changed.has('serveMode')) syncTopbar();

  const ghosts = ghostsForPlay();

  const plan = views.get('plan');
  if (plan && (!changed || changed.has('trajectory') || changed.has('mirror'))) {
    plan.setUnfold(
      state.mirror ? unfoldFirstSideBounce(state.trajectory) : null,
    );
  }

  for (const view of views.values()) {
    view.draw(state.trajectory, {
      playhead: state.playhead,
      origin: state.shot.origin,
      aim: state.aim,
      target: state.solveTarget,
      ghosts,
      toss: state.toss,
    });
  }

  if (boardOverlay && (!changed || changed.has('board'))) {
    boardOverlay.render();
  }

  if (scene3d) {
    // Reconstruir el tubo cuesta; el playhead se mueve cada frame y no
    // necesita tocarlo.
    if (trajectoryChanged) {
      scene3d.trajectory.setTrajectory(state.trajectory);
      scene3d.trajectory.setOrigin(state.shot.origin);
      scene3d.trajectory.setGhosts(ghosts);
    }
    if (!changed || changed.has('toss')) scene3d.trajectory.setToss(state.toss);
    if (
      !changed ||
      changed.has('shot') ||
      changed.has('racquetStroke') ||
      changed.has('handedness') ||
      changed.has('sliceDeg') ||
      changed.has('hitSpot')
    ) {
      syncRacquet();
    }
    if (!changed || changed.has('aim')) scene3d.trajectory.setAim(state.aim);
    scene3d.trajectory.setPlayhead(state.playhead);
    // El golpe animado: la raqueta sigue a la linea de tiempo.
    scene3d.racquet.setSwing(state.playhead);
    scene3d.invalidate();
  }

  if (trajectoryChanged) {
    const banner = document.getElementById('skip-banner');
    if (banner) banner.hidden = !isSkip(state.trajectory);
  }
  if (!changed || changed.has('shot') || changed.has('solveAlternatives')) {
    syncChoices();
  }

  syncTimeline();
  const panelKeys = (changed as ReadonlySet<keyof AppState>) ?? ALL_KEYS();
  for (const panel of panels) panel.sync(panelKeys);
};

// ------------------------------------------------------------- bucle

let lastFrame = 0;

const frame = (now: number): void => {
  const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
  lastFrame = now;

  if (state.playing) {
    const total = state.trajectory.totalTime;
    const next = state.playhead + dt * state.playRate;
    if (next >= total) update({ playhead: total, playing: false });
    else update({ playhead: next });
  }

  scene3d?.render();
  requestAnimationFrame(frame);
};

// ------------------------------------------------------------- teclado

const mountKeyboard = (): void => {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
      return;
    }
    // Avanzar y retroceder fotograma a fotograma: pararse justo en un
    // rebote es la mitad del valor pedagogico del scrub.
    const step = e.shiftKey ? 0.002 : 0.02;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      update({
        playing: false,
        playhead: Math.min(state.trajectory.totalTime, state.playhead + step),
      });
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      update({ playing: false, playhead: Math.max(timelineStart(), state.playhead - step) });
      return;
    }
    // Saltar al siguiente rebote / al anterior.
    if (e.key === '.' || e.key === ',') {
      e.preventDefault();
      const times = state.trajectory.bounces.map((b) => b.time);
      const next =
        e.key === '.'
          ? times.find((t) => t > state.playhead + 1e-6)
          : [...times].reverse().find((t) => t < state.playhead - 1e-6);
      if (next !== undefined) update({ playing: false, playhead: next });
    }
  });
};

// ------------------------------------------------------------- arranque

/** El hash siempre refleja el tiro actual y su cancha: copiar la URL ya comparte. */
const pushHash = (): void => {
  syncHash(currentDoc());
};

const restoreFromUrlAndStorage = (): void => {
  // El enlace manda sobre lo guardado: si alguien abre una URL
  // compartida, quiere ver ESE tiro, no el suyo de ayer.
  const prefs = loadViewPrefs();
  if (prefs.l) update({ layout: prefs.l as LayoutId });
  if (prefs.mi) update({ mirror: true });
  if (prefs.sv) update({ serveMode: true });
  if (prefs.rk) {
    update({ racquetStroke: prefs.rk === 'b' ? 'backhand' : prefs.rk === 'n' ? null : 'forehand' });
  }
  if (prefs.hd) update({ handedness: prefs.hd === 'l' ? 'left' : 'right' });

  const plays = loadPlays();
  if (plays.length) update({ plays });
  const board = loadBoard();
  if (board) update({ board: cloneBoard(board) });
  const venue = loadVenue();
  if (venue) update({ venue });

  const doc = readHashDoc();
  if (doc) applyDoc(doc);
};

const boot = (): void => {
  mount2D();
  mount3D();
  mountLayoutTabs();
  mountTopbarRight();
  mountPanel();
  mountTimeline();
  mountKeyboard();
  mountResponsive();

  restoreFromUrlAndStorage();

  subscribe((_s, changed) => {
    if (changed.has('layout')) {
      syncLayout();
      scene3d?.resize();
    }
    if (
      changed.has('shot') ||
      changed.has('model') ||
      changed.has('venue') ||
      changed.has('serveToss') ||
      changed.has('serveMode')
    ) {
      pushHash();
    }
    if (changed.has('venue')) storeVenue(state.venue);
    if (
      changed.has('layout') ||
      changed.has('mirror') ||
      changed.has('serveMode') ||
      changed.has('racquetStroke') ||
      changed.has('handedness')
    ) {
      storeViewPrefs({
        l: state.layout,
        mi: state.mirror ? 1 : 0,
        sv: state.serveMode ? 1 : 0,
        rk: state.racquetStroke === 'backhand' ? 'b' : state.racquetStroke ? 'f' : 'n',
        hd: state.handedness === 'left' ? 'l' : 'r',
      });
    }
    redraw(changed as ReadonlySet<string>);
  });

  syncLayout();
  redraw();
  pushHash();
  requestAnimationFrame(frame);
};

boot();
