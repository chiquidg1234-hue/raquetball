/**
 * FASE 10 — Panel del problema inverso.
 *
 * Invierte la pregunta: en vez de "que hace este tiro", "que tiro hace
 * esto". Se elige donde tiene que caer la pelota y la app dice desde
 * donde apuntar y con cuanta fuerza.
 */

import { COURT } from '../core/constants.js';
import { CENTER_BOX } from '../core/court.js';
import { NAMED_TARGETS, solveAim, type SolveResult } from '../core/solve.js';
import { clearNode, el, slider, type SliderHandle } from './dom.js';
import type { PanelView } from './panels.js';
import { state, update } from './state.js';

const metres = (v: number): string => `${v.toFixed(2)} m`;

export const createSolvePanel = (): PanelView => {
  const root = el('div', { class: 'panel-view' });
  const result = el('div', { class: 'solve-result' });
  let searchSpeed = true;

  const setTarget = (x: number, z: number, bounceIndex?: 1 | 2): void => {
    update({
      solveTarget: {
        x,
        z,
        bounceIndex: bounceIndex ?? state.solveTarget?.bounceIndex ?? 1,
      },
    });
  };

  // ------------------------------------------------------ objetivos fijos

  const namedGrid = el('div', { class: 'preset-grid' });
  for (const t of NAMED_TARGETS) {
    const b = el('button', {
      class: 'preset',
      type: 'button',
      'data-target': t.id,
    }, [el('span', { class: 'preset-name', text: t.label })]);
    b.addEventListener('click', () => setTarget(t.x, t.z, t.bounceIndex));
    namedGrid.append(b);
  }

  // ----------------------------------------------------- ajuste fino

  const targetX: SliderHandle = slider({
    field: 'target-x',
    label: 'Objetivo — ancho (X)',
    min: CENTER_BOX.xMin,
    max: CENTER_BOX.xMax,
    step: 0.05,
    value: state.solveTarget?.x ?? COURT.width / 2,
    format: metres,
    onInput: (x) => setTarget(x, state.solveTarget?.z ?? 10.5),
  });

  const targetZ: SliderHandle = slider({
    field: 'target-z',
    label: 'Objetivo — fondo (Z)',
    min: CENTER_BOX.zMin,
    max: CENTER_BOX.zMax,
    step: 0.05,
    value: state.solveTarget?.z ?? 10.5,
    format: metres,
    onInput: (z) => setTarget(state.solveTarget?.x ?? COURT.width / 2, z),
  });

  // --------------------------------------------------------- opciones

  const pick = el('button', {
    class: 'btn',
    type: 'button',
    'data-target-pick': '',
    text: 'Elegir en la planta',
  });
  pick.addEventListener('click', () =>
    update({ targetPickMode: !state.targetPickMode }),
  );

  const bounceSelect = el('select', {
    class: 'btn',
    'aria-label': 'Que bote debe caer ahi',
  }) as HTMLSelectElement;
  bounceSelect.append(
    el('option', { value: '1', text: '1er bote en el piso' }),
    el('option', { value: '2', text: '2o bote en el piso' }),
  );
  bounceSelect.addEventListener('change', () => {
    const t = state.solveTarget;
    if (t) setTarget(t.x, t.z, Number(bounceSelect.value) as 1 | 2);
  });

  const speedToggle = el('label', { class: 'toggle-row' }, [
    (() => {
      const input = el('input', {
        type: 'checkbox',
        checked: true,
        'data-field': 'search-speed',
      }) as HTMLInputElement;
      input.addEventListener('change', () => {
        searchSpeed = input.checked;
      });
      return input;
    })(),
    el('span', { text: 'Buscar tambien la fuerza, no solo el angulo' }),
  ]);

  // --------------------------------------------------------- resolver

  const solveButton = el('button', {
    class: 'btn btn--active',
    type: 'button',
    'data-solve': '',
    text: '¿Donde apunto?',
  });

  const applyResult = (r: SolveResult): void => {
    clearNode(result);

    const tone = r.ok ? 'ok' : 'warn';
    result.append(
      el('div', { class: 'badge-row' }, [
        el('span', {
          class: `badge badge--${tone}`,
          text: r.ok ? 'resuelto' : 'sin solucion exacta',
        }),
        el('span', { class: 'badge', text: r.method }),
        el('span', {
          class: 'badge',
          text: `error ${r.error < 0.005 ? '0' : r.error.toFixed(2)} m`,
        }),
      ]),
      el('div', { class: 'verdict-detail', text: r.note }),
    );

    if (r.aimPoint) {
      result.append(
        el('div', {
          class: 'verdict-detail',
          text: `Punto de mira en la pared frontal: x = ${r.aimPoint.x.toFixed(2)} m, altura ${r.aimPoint.y.toFixed(2)} m.`,
        }),
      );
    }

    result.append(
      el('div', {
        class: 'verdict-detail',
        text: `Azimut ${r.azimuthDeg.toFixed(1)}°, elevacion ${r.elevationDeg.toFixed(1)}°, ${r.speed.toFixed(0)} m/s.`,
      }),
    );

    update({
      azimuthDeg: r.azimuthDeg,
      elevationDeg: r.elevationDeg,
      speed: Math.round(r.speed),
      aim: r.aimPoint,
      presetId: null,
    });
  };

  solveButton.addEventListener('click', () => {
    const target = state.solveTarget;
    if (!target) {
      clearNode(result);
      result.append(
        el('div', {
          class: 'field-hint',
          text: 'Elige antes donde quieres que caiga la pelota.',
        }),
      );
      return;
    }
    const r = solveAim(
      {
        origin: state.origin,
        speed: state.speed,
        model: state.model,
        searchSpeed,
      },
      target,
    );
    applyResult(r);
  });

  root.append(
    el('div', { class: 'section-title', text: 'Quiero que muera en…' }),
    namedGrid,
    el('div', { class: 'copy-actions' }, [pick, bounceSelect]),
    el('div', { class: 'section-title', text: 'Ajuste fino' }),
    targetX.root,
    targetZ.root,
    speedToggle,
    el('div', { class: 'copy-actions' }, [solveButton]),
    result,
    el('div', {
      class: 'field-hint',
      text: 'Con el motor geometrico la respuesta es exacta: metodo del espejo. Con el balistico no hay formula cerrada, asi que se resuelve por disparo, partiendo de la solucion geometrica como semilla.',
    }),
  );

  const render = (): void => {
    pick.classList.toggle('btn--active', state.targetPickMode);
    const t = state.solveTarget;
    if (t) {
      targetX.set(t.x);
      targetZ.set(t.z);
      bounceSelect.value = String(t.bounceIndex);
    }
    for (const b of namedGrid.querySelectorAll<HTMLElement>('[data-target]')) {
      const named = NAMED_TARGETS.find((n) => n.id === b.dataset.target);
      const active =
        !!t &&
        !!named &&
        Math.abs(named.x - t.x) < 0.06 &&
        Math.abs(named.z - t.z) < 0.06;
      b.classList.toggle('preset--active', active);
    }
  };

  render();

  return {
    id: 'solve',
    label: 'Apuntar',
    root,
    sync(changed) {
      if (changed.has('solveTarget') || changed.has('targetPickMode')) render();
    },
  };
};
