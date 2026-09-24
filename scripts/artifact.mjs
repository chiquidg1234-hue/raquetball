/**
 * Variante del empaquetado para publicar como Artifact de Claude.
 *
 * El contenedor de Artifact aporta su propio <!doctype>, <head> y <body>,
 * asi que la pagina se entrega SIN esos envoltorios: solo <title>,
 * <style>, el contenido del cuerpo y el script.
 *
 * Se reutiliza dist/racquetball.html, que ya esta verificado y no pide
 * nada a la red, de modo que las dos salidas no pueden divergir.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

const main = async () => {
  const html = await readFile(join(dist, 'racquetball.html'), 'utf8');

  const title =
    html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Racquetball Trajectory Lab';
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1];

  // Vite deja el <script type="module"> en el HEAD, no en el cuerpo. Hay
  // que sacarlo de ahi y ponerlo DESPUES del contenido, o la pagina se
  // publica con los 650 KB de codigo fuera y no arranca nada.
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );

  if (!style || !body || scripts.length === 0) {
    console.error('ERROR: faltan <style>, <body> o el script del build.');
    process.exit(1);
  }

  const out =
    `<title>${title}</title>\n<style>\n${style}\n</style>\n${body.trim()}\n` +
    scripts.map((code) => `<script type="module">\n${code}\n</script>`).join('\n') +
    '\n';
  const file = join(dist, 'artifact.html');
  await writeFile(file, out, 'utf8');

  // Los envoltorios no pueden colarse: el contenedor ya los pone. Se
  // compara la etiqueta COMPLETA: "<head" tambien casa con <header>, que
  // es una etiqueta legitima del cuerpo de la pagina.
  const wrapper = /<!doctype|<\/?(html|head|body)(\s|>)/i.exec(out);
  if (wrapper) {
    console.error(`ERROR: la salida contiene ${wrapper[0]}, que el contenedor ya aporta.`);
    process.exit(1);
  }
  const bytes = Buffer.byteLength(out, 'utf8');
  console.log(
    `dist/artifact.html     ${(bytes / 1024 / 1024).toFixed(2)} MB` +
      `  (script: ${(Buffer.byteLength(scripts.join(''), 'utf8') / 1024).toFixed(0)} KB)`,
  );
  // Guardia de tamano: si el script no entra, el archivo sale pequenisimo
  // y la pagina publicada estaria vacia.
  if (bytes < 200 * 1024) {
    console.error('ERROR: la salida es demasiado pequena; falta el bundle.');
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
