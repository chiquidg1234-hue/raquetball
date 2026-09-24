/** Contrato minimo de un panel lateral. */

import type { AppState } from './state.js';

export interface PanelView {
  id: string;
  label: string;
  root: HTMLElement;
  /** Refresca los controles cuando el estado cambia desde otro sitio. */
  sync(changed: ReadonlySet<keyof AppState>): void;
}
