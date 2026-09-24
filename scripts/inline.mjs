/**
 * Empaqueta el build de Vite en UN SOLO archivo HTML autocontenido.
 *
 * Decision de la fase 0: el mismo artefacto sirve para publicarlo como
 * Artifact de Claude, subirlo a Cloudflare Pages o abrirlo con doble clic
 * desde el disco. Cero peticiones de red en runtime.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const OUT = join(dist, 'racquetball.html');

const escapeForScript = (code) =>
  // Un `</script>` dentro del bundle cerraria la etiqueta antes de tiempo.
  code.replace(/<\/script>/gi, '<\\/script>');

/**
 * String.replace con un reemplazo de TEXTO interpreta $&, $`, $' y $1 como
 * patrones. El bundle de lz-string contiene el alfabeto base64 url-safe,
 * que acaba en "+-$", y ese $ iba seguido de una comilla invertida: el
 * motor lo leia como $` e insertaba TODO el HTML anterior en mitad del
 * codigo. El archivo resultante cargaba sin pedir nada a la red y con
 * apariencia normal, pero moria con "Invalid left-hand side in
 * assignment" y la app no arrancaba.
 *
 * Con una FUNCION de reemplazo no se interpreta nada. Nunca se debe
 * inyectar codigo con replace de texto.
 */
const replaceOnce = (haystack, needle, replacement) =>
  haystack.replace(needle, () => replacement);

const dirSize = async (dir) => {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
};

const main = async () => {
  let html = await readFile(join(dist, 'index.html'), 'utf8');
  const inlinedScripts = [];

  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)];
  for (const [tag, src] of scripts) {
    const code = await readFile(join(dist, src.replace(/^\.?\//, '')), 'utf8');
    html = replaceOnce(
      html,
      tag,
      `<script type="module">\n${escapeForScript(code)}\n</script>`,
    );
    inlinedScripts.push(escapeForScript(code));
  }

  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
  for (const [tag, href] of links) {
    const css = await readFile(join(dist, href.replace(/^\.?\//, '')), 'utf8');
    html = replaceOnce(html, tag, `<style>\n${css}\n</style>`);
  }

  // Los modulos precargados ya estan dentro: el <link modulepreload> sobra.
  html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

  // Guardia contra la clase de bug de arriba: lo que quedo dentro de la
  // etiqueta tiene que ser EXACTAMENTE lo que se metio, byte a byte.
  for (const expected of inlinedScripts) {
    if (!html.includes(expected)) {
      console.error(
        'ERROR: el codigo inlineado no coincide con el bundle. ' +
          'Algo lo ha alterado al insertarlo.',
      );
      process.exit(1);
    }
  }

  await writeFile(OUT, html, 'utf8');

  const bytes = Buffer.byteLength(html, 'utf8');
  const mb = (bytes / 1024 / 1024).toFixed(2);
  console.log(`dist/racquetball.html  ${mb} MB  (limite de Artifact: 16 MB)`);
  console.log(`dist/ completo         ${((await dirSize(dist)) / 1024 / 1024).toFixed(2)} MB`);
  if (bytes > 16 * 1024 * 1024) {
    console.error('AVISO: por encima del limite de 16 MB de un Artifact.');
    process.exitCode = 1;
  }
  if (/src="[^"]*"|href="[^"]*\.css"/.test(html.replace(/href="#[^"]*"/g, ''))) {
    const leftovers = html.match(/(src|href)="(?!data:|#)[^"]*"/g) ?? [];
    if (leftovers.length) {
      console.error('AVISO: quedan referencias externas:', leftovers.slice(0, 5));
      process.exitCode = 1;
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
