/**
 * FASE 11 — SVG a PNG.
 *
 * Dos problemas que hay que resolver para que la imagen salga igual que
 * la pantalla:
 *
 * 1. El SVG de la pizarra no lleva estilos propios: todo son clases
 *    definidas en la hoja del documento. Serializado tal cual, sale en
 *    blanco y negro. Aqui se recogen de document.styleSheets las reglas
 *    que de verdad afectan a ese SVG y se inyectan dentro del clon, junto
 *    con :root para que las variables CSS resuelvan.
 * 2. Un SVG sin fondo se convierte en un PNG transparente, y sobre fondo
 *    blanco un tema oscuro no se ve. Se pinta el fondo explicitamente.
 *
 * La descarga se ofrece por enlace, pero tambien se muestra la imagen:
 * algunos entornos sandbox bloquean las descargas que inicia la propia
 * pagina, y ahi guardar la imagen a mano sigue funcionando.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const collectCss = (svg: SVGSVGElement): string => {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // hoja de otro origen
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const selector = rule.selectorText;
      if (!selector) continue;
      // :root lleva las variables CSS; dentro del SVG suelto, el propio
      // <svg> es el elemento raiz, asi que resuelven.
      if (selector === ':root') {
        out.push(rule.cssText);
        continue;
      }
      try {
        if (svg.querySelector(selector)) out.push(rule.cssText);
      } catch {
        // Selector que querySelector no entiende: se ignora.
      }
    }
  }
  return out.join('\n');
};

export interface PngResult {
  dataUrl: string;
  width: number;
  height: number;
}

export const svgToPng = async (
  svg: SVGSVGElement,
  options: { scale?: number; background?: string } = {},
): Promise<PngResult> => {
  const scale = options.scale ?? 2;
  const viewBox = svg.viewBox.baseVal;
  const aspect = viewBox.width / viewBox.height;

  const rect = svg.getBoundingClientRect();
  const baseWidth = Math.max(640, Math.round(rect.width || 900));
  const width = Math.round(baseWidth);
  const height = Math.round(width / aspect);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const background =
    options.background ??
    getComputedStyle(document.body).getPropertyValue('--bg-sunken').trim() ??
    '#090d13';

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(viewBox.x));
  bg.setAttribute('y', String(viewBox.y));
  bg.setAttribute('width', String(viewBox.width));
  bg.setAttribute('height', String(viewBox.height));
  bg.setAttribute('fill', background || '#090d13');
  clone.insertBefore(bg, clone.firstChild);

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = collectCss(svg);
  clone.insertBefore(style, clone.firstChild);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('no se pudo rasterizar el SVG'));
    image.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sin contexto 2d');
  ctx.fillStyle = background || '#090d13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
};

/** Exporta el lienzo WebGL tal cual lo ve el usuario. */
export const canvasToPng = (canvas: HTMLCanvasElement): PngResult => ({
  dataUrl: canvas.toDataURL('image/png'),
  width: canvas.width,
  height: canvas.height,
});
