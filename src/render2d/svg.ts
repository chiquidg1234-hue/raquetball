/** Utilidades minimas de SVG. Todo se dibuja en metros de cancha. */

const NS = 'http://www.w3.org/2000/svg';

export type Attrs = Record<string, string | number | undefined>;

export const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  parent?: SVGElement,
): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    el.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(el);
  return el;
};

export const setAttrs = (el: Element, attrs: Attrs): void => {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) el.removeAttribute(k);
    else el.setAttribute(k, String(v));
  }
};

export const clear = (el: Element): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

/** Convierte un evento de puntero a coordenadas del viewBox del SVG. */
export const pointerToViewBox = (
  svg: SVGSVGElement,
  event: { clientX: number; clientY: number },
): { u: number; v: number } => {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;

  // preserveAspectRatio = xMidYMid meet: el viewBox se escala por el lado
  // que mas aprieta y se centra en el otro.
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
  const drawnW = vb.width * scale;
  const drawnH = vb.height * scale;
  const offsetX = rect.left + (rect.width - drawnW) / 2;
  const offsetY = rect.top + (rect.height - drawnH) / 2;

  return {
    u: vb.x + (event.clientX - offsetX) / scale,
    v: vb.y + (event.clientY - offsetY) / scale,
  };
};

export const fmt = (n: number, digits = 2): string => n.toFixed(digits);

/** Une puntos en el atributo `points` de una polyline. */
export const pointsAttr = (pts: { u: number; v: number }[]): string =>
  pts.map((p) => `${p.u.toFixed(4)},${p.v.toFixed(4)}`).join(' ');
