/**
 * FASE 4 — Modo de input B: sliders numericos.
 *
 * Es el modo preciso: el que permite decir "dos grados mas abierto" y
 * medirlo. Los tres modos de input editan el MISMO objeto Shot, asi que
 * cambiar de modo nunca pierde el tiro actual.
 */

import { COURT, SPEED } from '../core/constants.js';
import { CENTER_BOX } from '../core/court.js';
import { el, slider, type SliderHandle } from './dom.js';
import type { PanelView } from './panels.js';
import { state, update, type AppState } from './state.js';

const metres = (v: number): string => `${v.toFixed(2)} m`;
const degrees = (v: number): string => `${v.toFixed(1)}°`;
const speedText = (v: number): string =>
  `${v.toFixed(0)} m/s · ${(v * 3.6).toFixed(0)} km/h`;

export const createShotPanel = (): PanelView => {
  const root = el('div', { class: 'panel-view' });

  const originX = slider({
    field: 'origin-x',
    label: 'Posicion — ancho (X)',
    min: CENTER_BOX.xMin,
    max: CENTER_BOX.xMax,
    step: 0.01,
    value: state.origin.x,
    format: metres,
    onInput: (x) =>
      update({ origin: { ...state.origin, x }, presetId: null, aim: null }),
  });

  const originZ = slider({
    field: 'origin-z',
    label: 'Posicion — fondo (Z)',
    min: CENTER_BOX.zMin,
    max: CENTER_BOX.zMax,
    step: 0.01,
    value: state.origin.z,
    format: metres,
    hint: `0 = pared frontal · ${COURT.shortLine.toFixed(2)} m = short line`,
    onInput: (z) =>
      update({ origin: { ...state.origin, z }, presetId: null, aim: null }),
  });

  const originY = slider({
    field: 'origin-y',
    label: 'Altura de contacto (Y)',
    min: 0.1,
    max: 2.6,
    step: 0.01,
    value: state.origin.y,
    format: metres,
    hint: '0.9 m es la altura de un golpe normal.',
    onInput: (y) =>
      update({ origin: { ...state.origin, y }, presetId: null, aim: null }),
  });

  const azimuth = slider({
    field: 'azimuth',
    label: 'Azimut',
    min: -90,
    max: 90,
    step: 0.5,
    value: state.azimuthDeg,
    format: degrees,
    hint: '0 = perpendicular a la frontal. Positivo abre a la derecha.',
    onInput: (azimuthDeg) => update({ azimuthDeg, presetId: null, aim: null }),
  });

  const elevation = slider({
    field: 'elevation',
    label: 'Elevacion',
    min: -30,
    max: 60,
    step: 0.5,
    value: state.elevationDeg,
    format: degrees,
    onInput: (elevationDeg) =>
      update({ elevationDeg, presetId: null, aim: null }),
  });

  const speed = slider({
    field: 'speed',
    label: 'Velocidad',
    min: SPEED.min,
    max: SPEED.max,
    step: 1,
    value: state.speed,
    format: speedText,
    hint: `peloteo ~${SPEED.rallyComfortable} · drive ~${SPEED.drive} · saque pro ~${SPEED.proServe} m/s`,
    onInput: (v) => update({ speed: v, presetId: null }),
  });

  root.append(
    el('div', { class: 'section-title', text: 'Donde estoy' }),
    originX.root,
    originZ.root,
    originY.root,
    el('div', { class: 'section-title', text: 'Como le pego' }),
    azimuth.root,
    elevation.root,
    speed.root,
  );

  const handles: [keyof AppState | 'origin', SliderHandle, () => number][] = [
    ['origin', originX, () => state.origin.x],
    ['origin', originZ, () => state.origin.z],
    ['origin', originY, () => state.origin.y],
    ['azimuthDeg', azimuth, () => state.azimuthDeg],
    ['elevationDeg', elevation, () => state.elevationDeg],
    ['speed', speed, () => state.speed],
  ];

  return {
    id: 'shot',
    label: 'Tiro',
    root,
    sync(changed) {
      for (const [key, handle, read] of handles) {
        if (changed.has(key as keyof AppState)) handle.set(read());
      }
    },
  };
};
