/**
 * Aviso breve sobre una vista. Lo usa el arrastre de botes para decir si
 * el tiro se pudo recalcular y con que error, sin obligar a mirar el panel.
 */

import { el } from './dom.js';

export type ToastTone = 'info' | 'ok' | 'warn';

const timers = new WeakMap<HTMLElement, number>();

export const showToast = (
  host: HTMLElement,
  text: string,
  tone: ToastTone = 'info',
  ms = 3200,
): void => {
  let node = host.querySelector<HTMLElement>(':scope > .toast');
  if (!node) {
    node = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    host.appendChild(node);
  }
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = false;

  const previous = timers.get(node);
  if (previous) window.clearTimeout(previous);
  if (ms > 0) {
    const target = node;
    timers.set(
      node,
      window.setTimeout(() => {
        target.hidden = true;
      }, ms),
    );
  }
};
