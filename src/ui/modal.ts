/** Dialogo minimo. Lo usan compartir, exportar e importar. */

import { clearNode, el } from './dom.js';

let host: HTMLElement | null = null;

const ensureHost = (): HTMLElement => {
  if (host) return host;
  host = el('div', { class: 'modal-host', hidden: true });
  host.addEventListener('click', (e) => {
    if (e.target === host) closeModal();
  });
  document.body.appendChild(host);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  return host;
};

export const closeModal = (): void => {
  if (!host) return;
  host.hidden = true;
  clearNode(host);
};

export const openModal = (title: string, body: (Node | string)[]): void => {
  const h = ensureHost();
  clearNode(h);

  const close = el('button', {
    class: 'btn btn--ghost btn--icon',
    type: 'button',
    'aria-label': 'Cerrar',
    text: '✕',
  });
  close.addEventListener('click', closeModal);

  h.appendChild(
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal-head' }, [
        el('h2', { class: 'modal-title', text: title }),
        close,
      ]),
      el('div', { class: 'modal-body' }, body),
    ]),
  );
  h.hidden = false;
};

/** Campo de solo lectura con boton de copiar y respaldo si no hay portapapeles. */
export const copyField = (value: string, rows = 3): HTMLElement => {
  const area = el('textarea', {
    class: 'copy-area',
    readonly: true,
    rows,
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  area.value = value;
  area.addEventListener('focus', () => area.select());

  const status = el('span', { class: 'copy-status' });
  const copy = el('button', { class: 'btn', type: 'button', text: 'Copiar' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = 'copiado';
    } catch {
      area.select();
      status.textContent = 'selecciona y copia a mano';
    }
    window.setTimeout(() => {
      status.textContent = '';
    }, 2600);
  });

  return el('div', { class: 'copy-field' }, [
    area,
    el('div', { class: 'copy-actions' }, [copy, status]),
  ]);
};

/**
 * Enlace de descarga MAS la propia imagen. Algunos entornos sandbox
 * bloquean las descargas que inicia la pagina; ahi guardar la imagen a
 * mano sigue funcionando, asi que se muestra siempre.
 */
export const downloadBlock = (
  dataUrl: string,
  filename: string,
  preview: boolean,
): HTMLElement => {
  const link = el('a', {
    class: 'btn btn--active',
    href: dataUrl,
    download: filename,
    text: `Descargar ${filename}`,
  });
  const children: Node[] = [el('div', { class: 'copy-actions' }, [link])];
  if (preview) {
    children.push(
      el('img', { class: 'modal-preview', src: dataUrl, alt: filename }),
      el('div', {
        class: 'field-hint',
        text: 'Si el navegador bloquea la descarga, pulsa la imagen con el boton derecho (o mantenla pulsada en movil) y guardala.',
      }),
    );
  }
  return el('div', {}, children);
};
