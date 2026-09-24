/**
 * FASE 11 — Compartir por URL.
 *
 * El estado se serializa, se comprime con lz-string y se mete en el hash.
 * EL ENLACE ES LOS DATOS: cero servidor, cero base de datos, cero costo, y
 * privado por construccion. Si no mandas el enlace, nadie lo tiene.
 *
 * El hash se actualiza con replaceState, no con push: mover un slider no
 * debe llenar el historial del navegador de entradas.
 */

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';

import { DOC_VERSION, isDoc, type Doc } from './schema.js';

const PREFIX = '#s=';

export const encodeDoc = (doc: Doc): string =>
  compressToEncodedURIComponent(JSON.stringify(doc));

export const decodeDoc = (payload: string): Doc | null => {
  try {
    const json = decompressFromEncodedURIComponent(payload);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    return isDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const buildShareUrl = (doc: Doc, base = window.location.href): string => {
  const url = new URL(base);
  url.hash = '';
  return `${url.toString().replace(/#$/, '')}${PREFIX}${encodeDoc(doc)}`;
};

/** Lee el documento del hash actual, si lo hay. */
export const readHashDoc = (hash = window.location.hash): Doc | null => {
  if (!hash.startsWith(PREFIX)) return null;
  return decodeDoc(hash.slice(PREFIX.length));
};

let pending: number | null = null;

/** Refresca el hash sin ensuciar el historial. Agrupado a 400 ms. */
export const syncHash = (doc: Doc): void => {
  if (pending !== null) window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = null;
    try {
      const encoded = `${PREFIX}${encodeDoc(doc)}`;
      window.history.replaceState(null, '', encoded);
    } catch {
      // Un navegador que no deje tocar el historial no debe romper la app.
    }
  }, 400);
};

export const emptyDoc = (shot: Doc['shot']): Doc => ({ v: DOC_VERSION, shot });
