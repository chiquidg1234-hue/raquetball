/**
 * FASE 4 — Modo de input B: sliders numericos.
 *
 * Es el modo preciso: el que permite decir "dos grados mas abierto" y
 * medirlo. Los tres modos de input editan el MISMO objeto Shot, asi que
 * cambiar de modo nunca pierde el tiro actual.
 */

import { COURT, SPEED } from '../core/constants.js';
import { CENTER_BOX } from '../core/court.js';
import { TOSS_LIMITS, describeStrike } from '../core/serveToss.js';
import { el, slider, type SliderHandle } from './dom.js';
import type { PanelView } from './panels.js';
import { sliceSpin } from '../core/racquet.js';
import { hitSpotS, state, update, type AppState } from './state.js';

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
    hint: `saque pro ~${Math.round(SPEED.proServe)} m/s (150 mph) · open ~${Math.round(SPEED.hardAmateurServe)} · récord ~${Math.round(SPEED.recordServe)}`,
    onInput: (v) => update({ speed: v, presetId: null }),
  });

  // --------------------------------------------- saque: bote con la mano

  const setToss = (patch: Partial<AppState['serveToss']>): void =>
    update({ serveToss: { ...state.serveToss, ...patch }, presetId: null });

  const release = slider({
    field: 'toss-release',
    label: 'Altura a la que sueltas la pelota',
    min: TOSS_LIMITS.releaseHeight.min,
    max: TOSS_LIMITS.releaseHeight.max,
    step: 0.05,
    value: state.serveToss.releaseHeight,
    format: metres,
    hint: 'Cuanto más alto la sueltas, más alto sube después del bote.',
    onInput: (releaseHeight) => setToss({ releaseHeight }),
  });

  const throwSpeed = slider({
    field: 'toss-speed',
    label: 'Fuerza del lanzamiento',
    min: TOSS_LIMITS.throwSpeed.min,
    max: TOSS_LIMITS.throwSpeed.max,
    step: 0.1,
    value: state.serveToss.throwSpeed,
    format: (v) => (v < 0.05 ? 'soltarla (0)' : `${v.toFixed(1)} m/s`),
    hint: '0 = dejarla caer ("drop the ball, don\'t bounce it"). Más fuerza, más lejos bota y más adelante le pegas.',
    onInput: (throwSpeed) => setToss({ throwSpeed }),
  });

  const throwAzimuth = slider({
    field: 'toss-azimuth',
    label: 'Hacia dónde la lanzas',
    min: TOSS_LIMITS.throwAzimuthDeg.min,
    max: TOSS_LIMITS.throwAzimuthDeg.max,
    step: 1,
    value: state.serveToss.throwAzimuthDeg,
    format: (v) =>
      Math.abs(v) < 0.5
        ? 'hacia la frontal'
        : `${Math.abs(v).toFixed(0)}° a la ${v > 0 ? 'derecha' : 'izquierda'}`,
    hint: 'En diagonal, el golpe se va hacia ese lado.',
    onInput: (throwAzimuthDeg) => setToss({ throwAzimuthDeg }),
  });

  const throwDown = slider({
    field: 'toss-down',
    label: 'Hacia abajo',
    min: TOSS_LIMITS.throwDownDeg.min,
    max: TOSS_LIMITS.throwDownDeg.max,
    step: 1,
    value: state.serveToss.throwDownDeg,
    format: (v) => `${v.toFixed(0)}°`,
    hint: '0° = horizontal, 90° = derecho al piso.',
    onInput: (throwDownDeg) => setToss({ throwDownDeg }),
  });

  const phase = slider({
    field: 'toss-phase',
    label: 'Cuándo le pegas',
    min: TOSS_LIMITS.strikePhase.min,
    max: TOSS_LIMITS.strikePhase.max,
    step: 0.05,
    value: state.serveToss.strikePhase,
    format: (v) =>
      v < 0.97 ? 'subiendo' : v <= 1.03 ? 'arriba' : v < 2 ? 'bajando' : 'tras 2.º bote',
    hint: 'Izquierda: recién botada, subiendo. Centro: lo más alto. Derecha del todo: ya botó dos veces, y eso es falta.',
    onInput: (strikePhase) => setToss({ strikePhase }),
  });

  const tossReadout = el('div', { class: 'toss-readout', 'data-readout': 'toss' });
  const tossSection = el('div', { class: 'toss-section' }, [
    el('div', { class: 'section-title', text: 'Saque: el lanzamiento con la mano' }),
    el('div', {
      class: 'field-hint',
      text: 'Es su propio movimiento: la sueltas o la lanzas (adelante, en diagonal), bota una vez en la zona de saque y le pegas en ese rebote (IRF 3.3). De aquí sale el punto de golpe: dónde, a qué altura y cuándo.',
    }),
    release.root,
    throwSpeed.root,
    throwAzimuth.root,
    throwDown.root,
    phase.root,
    tossReadout,
  ]);

  const labelOf = (h: SliderHandle): HTMLElement | null => h.root.querySelector('.field-label');

  const syncToss = (): void => {
    tossSection.hidden = !state.serveMode;
    const heightInput = originY.root.querySelector('input');
    if (heightInput) heightInput.disabled = !!state.toss;
    originY.root.classList.toggle('field--derived', !!state.toss);
    originY.set(state.shot.origin.y);
    // En modo saque la posicion es la de la mano; el golpe lo pone el
    // lanzamiento.
    const x = labelOf(originX);
    const z = labelOf(originZ);
    if (x) x.textContent = state.toss ? 'Dónde la sueltas — ancho (X)' : 'Posicion — ancho (X)';
    if (z) z.textContent = state.toss ? 'Dónde la sueltas — fondo (Z)' : 'Posicion — fondo (Z)';
    const t = state.toss;
    tossReadout.replaceChildren();
    if (!t) return;
    tossReadout.classList.toggle('toss-readout--fault', t.fault !== null);
    const p = t.strike.point;
    const moved = Math.hypot(p.x - t.release.x, p.z - t.release.z);
    const rows: [string, string][] = [
      ['Golpe', `${p.y.toFixed(2)} m de alto, ${describeStrike(t)}`],
      [
        'Dónde',
        `a ${p.z.toFixed(2)} m de la frontal, x = ${p.x.toFixed(2)}${moved > 0.02 ? ` (${moved.toFixed(2)} m desde la mano)` : ''}`,
      ],
      ['Bote de saque', `a ${t.bounce.point.z.toFixed(2)} m de la frontal`],
      ['Desde que la sueltas', `${t.duration.toFixed(2)} s hasta el golpe`],
    ];
    for (const [k, v] of rows) {
      tossReadout.append(
        el('div', { class: 'toss-row' }, [
          el('span', { class: 'toss-key', text: k }),
          el('span', { class: 'toss-value', text: v }),
        ]),
      );
    }
    if (t.fault === 'toss-outside') {
      tossReadout.append(
        el('div', {
          class: 'toss-fault',
          text: `Falta: botas fuera de la zona de saque (${COURT.serviceLine.toFixed(2)}–${COURT.shortLine.toFixed(2)} m).`,
        }),
      );
    } else if (t.fault === 'double-bounce') {
      tossReadout.append(
        el('div', {
          class: 'toss-fault',
          text: 'Falta: la pelota ya botó dos veces cuando le pegas.',
        }),
      );
    } else if (t.fault === 'toss-wall') {
      tossReadout.append(
        el('div', {
          class: 'toss-fault',
          text: 'Falta: la pelota toca una pared antes del golpe. Tiene que botar y ser golpeada sin tocar nada más.',
        }),
      );
    }
  };

  const slice = slider({
    field: 'slice',
    label: 'Efecto del golpe',
    min: -30,
    max: 30,
    step: 1,
    value: state.sliceDeg,
    format: (v) => {
      if (Math.abs(v) < 0.5) return 'plano';
      const rpm = sliceSpin(state.speed, v, state.shot.direction, hitSpotS(state.hitSpot)).rpm;
      return `${v > 0 ? 'cortado' : 'liftado'} ${Math.abs(v).toFixed(0)}° · ${Math.round(rpm)} rpm`;
    },
    hint: 'Cortado (slice): la raqueta baja por detrás de la pelota con la cara abierta y le da efecto hacia atrás, que la frena contra la frontal y ayuda al nick. Liftado: al revés.',
    onInput: (sliceDeg) => update({ sliceDeg, presetId: null }),
  });

  root.append(
    el('div', { class: 'section-title', text: 'Donde estoy' }),
    originX.root,
    originZ.root,
    originY.root,
    tossSection,
    el('div', { class: 'section-title', text: 'Como le pego' }),
    azimuth.root,
    elevation.root,
    speed.root,
    slice.root,
  );
  syncToss();

  const handles: [keyof AppState | 'origin', SliderHandle, () => number][] = [
    ['origin', originX, () => state.origin.x],
    ['origin', originZ, () => state.origin.z],
    ['origin', originY, () => state.shot.origin.y],
    ['azimuthDeg', azimuth, () => state.azimuthDeg],
    ['elevationDeg', elevation, () => state.elevationDeg],
    ['speed', speed, () => state.speed],
    ['sliceDeg', slice, () => state.sliceDeg],
  ];

  return {
    id: 'shot',
    label: 'Tiro',
    root,
    sync(changed) {
      for (const [key, handle, read] of handles) {
        if (changed.has(key as keyof AppState)) handle.set(read());
      }
      // El rpm del corte depende de la velocidad y de donde se le pega.
      if (changed.has('speed') || changed.has('hitSpot')) slice.set(state.sliceDeg);
      if (changed.has('serveToss')) {
        release.set(state.serveToss.releaseHeight);
        throwSpeed.set(state.serveToss.throwSpeed);
        throwAzimuth.set(state.serveToss.throwAzimuthDeg);
        throwDown.set(state.serveToss.throwDownDeg);
        phase.set(state.serveToss.strikePhase);
      }
      if (changed.has('toss') || changed.has('serveMode') || changed.has('shot')) syncToss();
    },
  };
};
