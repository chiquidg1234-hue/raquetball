/**
 * FASE 11 — Biblioteca: guardar, cargar, exportar e importar.
 *
 * Las tres vias de persistencia del spec, sin backend:
 *   localStorage        para el dia a dia
 *   JSON export/import  para el respaldo de verdad
 *   hash de la URL      para compartir (el enlace ES los datos)
 */

import { toShotDoc, type NamedShot, type Doc, DOC_VERSION } from '../persist/schema.js';
import {
  deleteShot,
  loadSavedShots,
  saveShot,
  storageAvailable,
  storeSavedShots,
} from '../persist/storage.js';
import { buildShareUrl, decodeDoc } from '../persist/share.js';
import { storePlays } from '../persist/storage.js';
import type { Play } from '../core/board.js';
import { clearNode, el } from './dom.js';
import { copyField, openModal } from './modal.js';
import type { PanelView } from './panels.js';
import { applyShotDoc, state, update } from './state.js';

const formatDate = (t: number): string =>
  new Date(t).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const createLibraryPanel = (): PanelView => {
  const root = el('div', { class: 'panel-view' });
  const list = el('div', { class: 'saved-list' });
  let saved: NamedShot[] = loadSavedShots();

  const nameInput = el('input', {
    class: 'text-input',
    type: 'text',
    placeholder: 'Nombre del tiro',
    'data-field': 'shot-name',
  }) as HTMLInputElement;

  const saveButton = el('button', {
    class: 'btn btn--active',
    type: 'button',
    text: 'Guardar',
  });
  saveButton.addEventListener('click', () => {
    saved = saveShot(nameInput.value || suggestName(), toShotDoc(state));
    nameInput.value = '';
    renderList();
  });

  const suggestName = (): string =>
    state.presetId ?? `tiro ${new Date().toLocaleTimeString()}`;

  const renderList = (): void => {
    clearNode(list);
    if (saved.length === 0) {
      list.append(
        el('div', {
          class: 'field-hint',
          text: storageAvailable()
            ? 'Todavia no has guardado ningun tiro.'
            : 'Este navegador no deja guardar datos locales (ventana privada o cookies bloqueadas). Puedes seguir usando el enlace para compartir.',
        }),
      );
      return;
    }
    for (const entry of saved) {
      const load = el('button', { class: 'saved-load', type: 'button' }, [
        el('span', { class: 'saved-name', text: entry.n }),
        el('span', { class: 'saved-date', text: formatDate(entry.t) }),
      ]);
      load.addEventListener('click', () => applyShotDoc(entry.shot));

      const remove = el('button', {
        class: 'btn btn--ghost btn--icon',
        type: 'button',
        'aria-label': `Borrar ${entry.n}`,
        text: '✕',
      });
      remove.addEventListener('click', () => {
        saved = deleteShot(entry.id);
        renderList();
      });

      list.append(el('div', { class: 'saved-row' }, [load, remove]));
    }
  };

  // ------------------------------------------------------------ compartir

  const share = el('button', { class: 'btn', type: 'button', text: 'Copiar enlace' });
  share.addEventListener('click', () => {
    const url = buildShareUrl({ v: DOC_VERSION, shot: toShotDoc(state) });
    openModal('Compartir este tiro', [
      el('p', {
        class: 'field-hint',
        text: 'El enlace ES los datos: el tiro entero viaja comprimido dentro de la URL. No hay servidor ni base de datos, y quien no tenga el enlace no tiene nada.',
      }),
      copyField(url, 4),
    ]);
  });

  // ------------------------------------------------------- exportar JSON

  const exportJson = el('button', { class: 'btn', type: 'button', text: 'Exportar JSON' });
  exportJson.addEventListener('click', () => {
    const doc: Doc = {
      v: DOC_VERSION,
      shot: toShotDoc(state),
      saved,
      plays: state.plays,
    };
    openModal('Exportar', [
      el('p', {
        class: 'field-hint',
        text: 'Este JSON es el respaldo real: lleva el tiro actual, la biblioteca guardada y todas las jugadas de la pizarra.',
      }),
      copyField(JSON.stringify(doc, null, 2), 12),
    ]);
  });

  // -------------------------------------------------------- importar JSON

  const importJson = el('button', { class: 'btn', type: 'button', text: 'Importar' });
  importJson.addEventListener('click', () => {
    const area = el('textarea', {
      class: 'copy-area',
      rows: 10,
      spellcheck: 'false',
      placeholder: 'Pega aqui un JSON exportado, o un enlace compartido',
    }) as HTMLTextAreaElement;
    const status = el('div', { class: 'field-hint' });

    const apply = el('button', { class: 'btn btn--active', type: 'button', text: 'Importar' });
    apply.addEventListener('click', () => {
      const text = area.value.trim();
      const doc = parseIncoming(text);
      if (!doc) {
        status.textContent = 'No se reconoce el contenido. Debe ser un JSON exportado o un enlace con #s=.';
        return;
      }
      applyShotDoc(doc.shot);
      if (doc.saved?.length) {
        const byId = new Map(saved.map((s) => [s.id, s]));
        for (const s of doc.saved) if (!byId.has(s.id)) byId.set(s.id, s);
        saved = [...byId.values()].sort((a, b) => b.t - a.t);
        storeSavedShots(saved);
        renderList();
      }
      const plays = Array.isArray(doc.plays) ? (doc.plays as Play[]) : [];
      if (plays.length) {
        const byId = new Map(state.plays.map((p) => [p.id, p]));
        for (const play of plays) if (play?.id) byId.set(play.id, play);
        const merged = [...byId.values()];
        update({ plays: merged });
        storePlays(merged);
      }
      status.textContent = `Importado. ${doc.saved?.length ?? 0} tiro(s) y ${plays.length} jugada(s).`;
    });

    openModal('Importar', [
      area,
      el('div', { class: 'copy-actions' }, [apply]),
      status,
    ]);
  });

  root.append(
    el('div', { class: 'section-title', text: 'Guardar el tiro actual' }),
    el('div', { class: 'row-inline' }, [nameInput, saveButton]),
    el('div', { class: 'section-title', text: 'Biblioteca' }),
    list,
    el('div', { class: 'section-title', text: 'Compartir y respaldar' }),
    el('div', { class: 'copy-actions' }, [share, exportJson, importJson]),
    el('div', {
      class: 'field-hint',
      text: 'La URL de la barra de direcciones ya lleva el tiro actual: copiarla desde ahi tambien vale.',
    }),
  );

  renderList();

  return {
    id: 'library',
    label: 'Guardar',
    root,
    sync() {
      /* la lista solo cambia por accion directa del usuario */
    },
  };
};

/** Acepta tanto un JSON exportado como un enlace compartido. */
const parseIncoming = (text: string): Doc | null => {
  if (!text) return null;
  const hashAt = text.indexOf('#s=');
  if (hashAt !== -1) return decodeDoc(text.slice(hashAt + 3));
  try {
    const parsed = JSON.parse(text) as Doc;
    return parsed && parsed.shot ? parsed : null;
  } catch {
    return null;
  }
};

export { update };
