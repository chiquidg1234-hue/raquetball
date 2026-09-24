/**
 * FASE 6 — Modo de input C: presets con nombre.
 *
 * Cada boton carga un tiro canonico desde donde este parado el jugador y
 * muestra en una linea CUANDO USARLO. Para quien esta aprendiendo, esa
 * linea es la mitad del producto: el dibujo ensena la geometria, el texto
 * ensena para que sirve.
 */

import { PRESETS, PRESET_GROUPS, presetById } from '../core/presets.js';
import { el } from './dom.js';
import type { PanelView } from './panels.js';
import { loadPreset, state, update } from './state.js';

export const createPresetPanel = (): PanelView => {
  const root = el('div', { class: 'panel-view' });
  const buttons = new Map<string, HTMLButtonElement>();

  for (const group of PRESET_GROUPS) {
    const inGroup = PRESETS.filter((p) => p.group === group.id);
    if (inGroup.length === 0) continue;

    root.append(el('div', { class: 'section-title', text: group.label }));
    const grid = el('div', { class: 'preset-grid' });
    for (const preset of inGroup) {
      const b = el('button', {
        class: 'preset',
        type: 'button',
        'data-preset': preset.id,
        title: preset.when,
      }, [
        el('span', { class: 'preset-name', text: preset.label }),
        ...(preset.prefersBallistic
          ? [el('span', { class: 'preset-flag', text: 'balistico' })]
          : []),
      ]);
      b.addEventListener('click', () => loadPreset(preset.id));
      buttons.set(preset.id, b);
      grid.append(b);
    }
    root.append(grid);
  }

  const when = el('div', { class: 'preset-when' });
  const mirrorRow = el('label', { class: 'toggle-row' }, [
    (() => {
      const input = el('input', { type: 'checkbox', 'data-field': 'mirror' });
      input.addEventListener('change', () =>
        update({ mirror: (input as HTMLInputElement).checked }),
      );
      return input;
    })(),
    el('span', {
      text: 'Modo espejo: desplegar la cancha en la planta',
    }),
  ]);

  root.append(
    el('div', { class: 'section-title', text: 'Cuando usarlo' }),
    when,
    mirrorRow,
    el('div', {
      class: 'field-hint',
      text: 'El espejo refleja la cancha al otro lado de la lateral: la trayectoria de dos tramos se convierte en una recta hacia el punto espejado. Exacto con el motor geometrico, aproximado con el balistico.',
    }),
  );

  const render = (): void => {
    for (const [id, b] of buttons) {
      b.classList.toggle('preset--active', id === state.presetId);
    }
    const preset = state.presetId ? presetById(state.presetId) : undefined;
    when.textContent = preset
      ? preset.when
      : 'Carga un preset para ver para que sirve, o mueve los sliders a mano.';
    when.classList.toggle('preset-when--empty', !preset);

    const checkbox = root.querySelector<HTMLInputElement>('[data-field="mirror"]');
    if (checkbox) checkbox.checked = state.mirror;
  };

  render();

  return {
    id: 'presets',
    label: 'Presets',
    root,
    sync(changed) {
      if (changed.has('presetId') || changed.has('mirror')) render();
    },
  };
};
