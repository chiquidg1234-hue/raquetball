/**
 * Punto de entrada. Monta las vistas, las conecta al estado y arranca el
 * bucle de reproduccion. Todo lo demas cuelga de `ui/state.ts`.
 */

import './style.css';

import { cloneBoard } from './core/board.js';
import { simulate } from './core/engine.js';
import { unfoldFirstSideBounce } from './core/unfold.js';
import { BoardOverlay } from './render2d/overlay.js';
import { canvasToPng, svgToPng } from './persist/exportPng.js';
import { DOC_VERSION, toShotDoc } from './persist/schema.js';
import { readHashDoc, syncHash } from './persist/share.js';
import {
  loadBoard,
  loadPlays,
  loadViewPrefs,
  storeBoard,
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
  applyShotDoc,
  state,
  subscribe,
  update,
  type AppState,
  type LayoutId,
} from './ui/state.js';

const views = new Map<ProjectionId, CourtView2D>();
const panels: PanelView[] = [];
let scene3d: Scene3D | null = null;
let boardOverlay: BoardOverlay | null = null;
let ghostCache: { key: string; list: Trajectory[] } = { key: '', list: [] };
let activePanel = 'shot';

// ------------------------------------------------------------- vistas 2D

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
    views.set(projection.id, view);
  }

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
  const key = `${play.id}:${state.playStep}`;
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
        { model: parsed.model },
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
  serve.addEventListener('click', () => update({ serveMode: !state.serveMode }));
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
    update({ playhead: 0 });
  }
  update({ playing: !state.playing });
};

const syncTimeline = (): void => {
  const total = Math.max(state.trajectory.totalTime, 1e-3);
  scrub.max = String(total);
  if (document.activeElement !== scrub) scrub.value = String(state.playhead);
  // En pantallas estrechas el formato largo se corta a media cifra, que
  // es peor que no mostrarlo: se acorta en vez de truncarse.
  timeLabel.textContent =
    window.innerWidth < 560
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
    });
  }

  if (boardOverlay && (!changed || changed.has('board'))) {
    boardOverlay.render();
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
    if (!changed || changed.has('aim')) scene3d.trajectory.setAim(state.aim);
    scene3d.trajectory.setPlayhead(state.playhead);
    scene3d.invalidate();
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
      update({ playing: false, playhead: Math.max(0, state.playhead - step) });
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

/** El hash siempre refleja el tiro actual: copiar la URL ya comparte. */
const pushHash = (): void => {
  syncHash({ v: DOC_VERSION, shot: toShotDoc(state) });
};

const restoreFromUrlAndStorage = (): void => {
  // El enlace manda sobre lo guardado: si alguien abre una URL
  // compartida, quiere ver ESE tiro, no el suyo de ayer.
  const prefs = loadViewPrefs();
  if (prefs.l) update({ layout: prefs.l as LayoutId });
  if (prefs.mi) update({ mirror: true });
  if (prefs.sv) update({ serveMode: true });

  const plays = loadPlays();
  if (plays.length) update({ plays });
  const board = loadBoard();
  if (board) update({ board: cloneBoard(board) });

  const doc = readHashDoc();
  if (doc) applyShotDoc(doc.shot);
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
    if (changed.has('shot') || changed.has('model')) pushHash();
    if (changed.has('layout') || changed.has('mirror') || changed.has('serveMode')) {
      storeViewPrefs({
        l: state.layout,
        mi: state.mirror ? 1 : 0,
        sv: state.serveMode ? 1 : 0,
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
