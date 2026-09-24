/**
 * FASE 9 — Panel de la pizarra tactica.
 *
 * Herramientas de dibujo, y jugadas: una jugada es una secuencia ordenada
 * de tiros mas las anotaciones del tablero, reproducible paso a paso.
 * Al avanzar por los pasos, los anteriores quedan dibujados en gris, que
 * es lo que convierte una secuencia de tiros sueltos en una jugada
 * legible.
 */

import {
  duplicatePlay,
  emptyBoard,
  cloneBoard,
  newId,
  type Play,
} from '../core/board.js';
import type { BoardTool } from '../render2d/overlay.js';
import { toShotDoc } from '../persist/schema.js';
import { storeBoard, storePlays } from '../persist/storage.js';
import { clearNode, el } from './dom.js';
import type { PanelView } from './panels.js';
import { applyShotDoc, state, update } from './state.js';

const TOOLS: { id: BoardTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Mover', hint: 'Arrastra fichas. El resto de la cancha sigue funcionando igual.' },
  { id: 'token-me', label: 'Yo', hint: 'Pon una ficha tuya.' },
  { id: 'token-rival', label: 'Rival', hint: 'Pon una ficha del rival.' },
  { id: 'token-ball', label: 'Pelota', hint: 'Marca donde esta la pelota.' },
  { id: 'token-cone', label: 'Marca', hint: 'Una marca cualquiera.' },
  { id: 'arrow', label: 'Flecha', hint: 'Arrastra para dibujar un movimiento. Van punteadas para no confundirlas con la pelota.' },
  { id: 'text', label: 'Texto', hint: 'Clic para escribir una nota.' },
  { id: 'draw', label: 'Trazo', hint: 'Dibuja a mano alzada.' },
  { id: 'erase', label: 'Borrar', hint: 'Clic en un elemento para quitarlo.' },
];

export const createBoardPanel = (): PanelView => {
  const root = el('div', { class: 'panel-view' });
  const toolGrid = el('div', { class: 'tool-grid' });
  const toolHint = el('div', { class: 'field-hint' });
  const stepList = el('div', { class: 'saved-list' });
  const playList = el('div', { class: 'saved-list' });

  for (const tool of TOOLS) {
    const b = el('button', {
      class: 'btn',
      type: 'button',
      'data-tool': tool.id,
      title: tool.hint,
      text: tool.label,
    });
    b.addEventListener('click', () => update({ tool: tool.id }));
    toolGrid.append(b);
  }

  const clearBoard = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: 'Limpiar tablero',
  });
  clearBoard.addEventListener('click', () => {
    update({ board: emptyBoard() });
    storeBoard(emptyBoard());
  });

  // --------------------------------------------------------- jugadas

  const currentPlay = (): Play | null =>
    state.plays.find((p) => p.id === state.currentPlayId) ?? null;

  const persistPlays = (plays: Play[]): void => {
    update({ plays });
    storePlays(plays);
  };

  const newPlay = el('button', { class: 'btn', type: 'button', text: 'Nueva jugada' });
  newPlay.addEventListener('click', () => {
    const play: Play = {
      id: newId(),
      name: `Jugada ${state.plays.length + 1}`,
      createdAt: Date.now(),
      steps: [{ shot: toShotDoc(state), note: '' }],
      board: cloneBoard(state.board),
    };
    persistPlays([play, ...state.plays]);
    update({ currentPlayId: play.id, playStep: 0 });
  });

  const addStep = el('button', { class: 'btn btn--active', type: 'button', text: 'Anadir paso' });
  addStep.addEventListener('click', () => {
    const play = currentPlay();
    if (!play) {
      newPlay.click();
      return;
    }
    const updated: Play = {
      ...play,
      steps: [...play.steps, { shot: toShotDoc(state), note: '' }],
      board: cloneBoard(state.board),
    };
    persistPlays(state.plays.map((p) => (p.id === play.id ? updated : p)));
    update({ playStep: updated.steps.length - 1 });
  });

  const goTo = (index: number): void => {
    const play = currentPlay();
    if (!play) return;
    const clamped = Math.max(0, Math.min(index, play.steps.length - 1));
    const step = play.steps[clamped];
    if (!step) return;
    applyShotDoc(step.shot);
    update({ playStep: clamped, currentPlayId: play.id });
  };

  const prev = el('button', { class: 'btn', type: 'button', text: '‹ Anterior' });
  prev.addEventListener('click', () => goTo(state.playStep - 1));
  const next = el('button', { class: 'btn', type: 'button', text: 'Siguiente ›' });
  next.addEventListener('click', () => goTo(state.playStep + 1));

  const stepCounter = el('span', { class: 'copy-status' });

  // ------------------------------------------------------------ render

  const renderSteps = (): void => {
    clearNode(stepList);
    const play = currentPlay();
    if (!play) {
      stepList.append(
        el('div', {
          class: 'field-hint',
          text: 'Crea una jugada para encadenar tiros y reproducirlos paso a paso.',
        }),
      );
      stepCounter.textContent = '';
      return;
    }
    stepCounter.textContent = `paso ${state.playStep + 1} de ${play.steps.length}`;

    play.steps.forEach((step, i) => {
      const load = el('button', { class: 'saved-load', type: 'button' }, [
        el('span', { class: 'saved-name', text: `${i + 1}. ${step.note || describeShot(step.shot)}` }),
      ]);
      if (i === state.playStep) load.classList.add('preset--active');
      load.addEventListener('click', () => goTo(i));

      const remove = el('button', {
        class: 'btn btn--ghost btn--icon',
        type: 'button',
        'aria-label': `Quitar paso ${i + 1}`,
        text: '✕',
      });
      remove.addEventListener('click', () => {
        const updated: Play = {
          ...play,
          steps: play.steps.filter((_, k) => k !== i),
        };
        persistPlays(state.plays.map((p) => (p.id === play.id ? updated : p)));
        update({ playStep: Math.min(state.playStep, updated.steps.length - 1) });
      });

      stepList.append(el('div', { class: 'saved-row' }, [load, remove]));
    });
  };

  const renderPlays = (): void => {
    clearNode(playList);
    if (state.plays.length === 0) {
      playList.append(
        el('div', { class: 'field-hint', text: 'Todavia no hay jugadas guardadas.' }),
      );
      return;
    }
    for (const play of state.plays) {
      const load = el('button', { class: 'saved-load', type: 'button' }, [
        el('span', { class: 'saved-name', text: play.name }),
        el('span', { class: 'saved-date', text: `${play.steps.length} paso(s)` }),
      ]);
      if (play.id === state.currentPlayId) load.classList.add('preset--active');
      load.addEventListener('click', () => {
        update({
          currentPlayId: play.id,
          playStep: 0,
          board: cloneBoard(play.board),
        });
        const first = play.steps[0];
        if (first) applyShotDoc(first.shot);
      });

      const copy = el('button', {
        class: 'btn btn--ghost btn--icon',
        type: 'button',
        'aria-label': `Duplicar ${play.name}`,
        text: '⧉',
      });
      copy.addEventListener('click', () =>
        persistPlays([duplicatePlay(play), ...state.plays]),
      );

      const remove = el('button', {
        class: 'btn btn--ghost btn--icon',
        type: 'button',
        'aria-label': `Borrar ${play.name}`,
        text: '✕',
      });
      remove.addEventListener('click', () => {
        persistPlays(state.plays.filter((p) => p.id !== play.id));
        if (state.currentPlayId === play.id) {
          update({ currentPlayId: null, playStep: -1 });
        }
      });

      playList.append(el('div', { class: 'saved-row' }, [load, copy, remove]));
    }
  };

  const render = (): void => {
    for (const b of toolGrid.querySelectorAll<HTMLElement>('[data-tool]')) {
      b.classList.toggle('btn--active', b.dataset.tool === state.tool);
    }
    toolHint.textContent = TOOLS.find((t) => t.id === state.tool)?.hint ?? '';
    renderSteps();
    renderPlays();
  };

  root.append(
    el('div', { class: 'section-title', text: 'Herramientas' }),
    toolGrid,
    toolHint,
    el('div', { class: 'copy-actions' }, [clearBoard]),
    el('div', { class: 'section-title', text: 'Jugada actual' }),
    el('div', { class: 'copy-actions' }, [prev, next, stepCounter]),
    stepList,
    el('div', { class: 'copy-actions' }, [addStep, newPlay]),
    el('div', { class: 'section-title', text: 'Jugadas guardadas' }),
    playList,
  );

  render();

  return {
    id: 'board',
    label: 'Pizarra',
    root,
    sync(changed) {
      if (
        changed.has('tool') ||
        changed.has('plays') ||
        changed.has('currentPlayId') ||
        changed.has('playStep')
      ) {
        render();
      }
    },
  };
};

const describeShot = (shot: { a: number; e: number; s: number }): string =>
  `az ${shot.a.toFixed(0)}° · el ${shot.e.toFixed(0)}° · ${shot.s.toFixed(0)} m/s`;
