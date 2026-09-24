/** Helpers de DOM. Minimos: la UI son sliders, botones y dos lienzos. */

export type ElAttrs = Record<string, string | number | boolean | undefined>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'string') continue;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

export const clearNode = (node: Element): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const mustGet = <T extends Element = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`falta el elemento #${id}`);
  return node as unknown as T;
};

export const button = (
  label: string,
  onClick: () => void,
  attrs: ElAttrs = {},
): HTMLButtonElement => {
  const b = el('button', { class: 'btn', type: 'button', ...attrs }, [label]);
  b.addEventListener('click', onClick);
  return b;
};

/** Slider con etiqueta y valor en vivo. Devuelve un `set` para refrescarlo. */
export interface SliderSpec {
  /** Identificador estable, para estilos y para las pruebas de UI. */
  field?: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  hint?: string;
  onInput: (v: number) => void;
}

export interface SliderHandle {
  root: HTMLElement;
  set(value: number): void;
  setRange(min: number, max: number): void;
}

export const slider = (spec: SliderSpec): SliderHandle => {
  const value = el('span', { class: 'field-value', text: spec.format(spec.value) });
  const input = el('input', {
    type: 'range',
    min: spec.min,
    max: spec.max,
    step: spec.step,
    value: spec.value,
    'data-field': spec.field,
    'aria-label': spec.label,
  }) as HTMLInputElement;

  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = spec.format(v);
    spec.onInput(v);
  });

  const head = el('div', { class: 'field-head' }, [
    el('span', { class: 'field-label', text: spec.label }),
    value,
  ]);
  const children: Node[] = [head, input];
  if (spec.hint) {
    children.push(el('div', { class: 'field-hint', text: spec.hint }));
  }
  const root = el('div', { class: 'field', 'data-field-row': spec.field }, children);

  return {
    root,
    set(v: number) {
      if (document.activeElement !== input) input.value = String(v);
      value.textContent = spec.format(v);
    },
    setRange(min: number, max: number) {
      input.min = String(min);
      input.max = String(max);
    },
  };
};
