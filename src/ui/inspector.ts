/**
 * FASE 4 — Inspector: la tabla de rebotes y las cifras del tiro.
 *
 * Es lo que convierte "se ve bonito" en "puedo discutirlo": cada fila es
 * un rebote con su instante, su punto, su velocidad y su angulo, y al
 * pulsarla el playhead salta ahi.
 */

import { COURT } from '../core/constants.js';
import {
  PRIMARY_FLOOR_BOUNCES,
  labelContacts,
  readableSequence,
  type Contact,
} from '../core/contacts.js';
import { SURFACE_BY_ID } from '../core/court.js';
import { DEEP_PROBE_Z, analyse } from '../core/rules.js';
import { pathLength } from '../core/trajectory-utils.js';
import type { Termination, Trajectory } from '../core/types.js';
import { length } from '../core/vec3.js';
import { clearNode, el } from './dom.js';
import type { PanelView } from './panels.js';
import { state, update } from './state.js';

const TERMINATION_TEXT: Record<Termination, string> = {
  maxBounces: 'limite de rebotes',
  maxTime: 'limite de tiempo',
  restingOnFloor: 'se queda en el piso',
  exitedCourt: 'sale de la cancha',
};

const badge = (
  text: string,
  tone: 'ok' | 'warn' | 'bad' | 'plain',
): HTMLElement =>
  el('span', {
    class: tone === 'plain' ? 'badge' : `badge badge--${tone}`,
    text,
  });

const stat = (label: string, value: string, unit = ''): HTMLElement =>
  el('div', { class: 'stat' }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value' }, [
      value,
      ...(unit ? [el('small', { text: ` ${unit}` })] : []),
    ]),
  ]);

/** Etiqueta de un contacto: circulo dorado si es piso, rombo si es pared. */
const contactChip = (c: Contact): HTMLElement => {
  if (c.skip) return el('span', { class: 'chip chip--skip', text: '!' });
  if (c.kind === 'floor') {
    return el('span', {
      class: c.primary ? 'chip chip--floor' : 'chip chip--floor chip--minor',
      text: c.label,
    });
  }
  return el('span', { class: 'chip chip--wall' }, [el('span', { text: c.label })]);
};

/** "a 1.1 m de la izquierda": como lo dice un jugador. */
const lateral = (x: number): string =>
  x <= COURT.width / 2
    ? `a ${x.toFixed(1)} m de la izquierda`
    : `a ${(COURT.width - x).toFixed(1)} m de la derecha`;

const ORDINAL = ['1.er', '2.º', '3.er'];

export const createInspectorPanel = (): PanelView => {
  const root = el('div', { class: 'panel-view' });
  const verdict = el('div', { class: 'verdict' });
  const floorsHost = el('div', { class: 'floor-cards' });
  const stats = el('div', { class: 'stat-grid' });
  const tableHost = el('div', { class: 'table-host' });

  root.append(
    el('div', { class: 'section-title', text: 'Que tiro es' }),
    verdict,
    el('div', { class: 'section-title', text: 'Botes de piso' }),
    floorsHost,
    el('div', { class: 'section-title', text: 'Resumen' }),
    stats,
    el('div', { class: 'section-title', text: 'Todos los contactos' }),
    tableHost,
  );

  /**
   * Los tres primeros botes de PISO, arriba del todo: son los que
   * deciden el punto. Donde cae cada uno, cuando y a que velocidad llega.
   */
  const renderFloorCards = (trajectory: Trajectory): void => {
    clearNode(floorsHost);
    const floors = labelContacts(trajectory).filter((c) => c.kind === 'floor');

    for (let k = 1; k <= PRIMARY_FLOOR_BOUNCES; k++) {
      const c = floors[k - 1];
      if (!c) {
        floorsHost.append(
          el('div', { class: 'floor-card floor-card--none' }, [
            el('span', { class: 'chip chip--floor chip--minor', text: String(k) }),
            el('span', {
              class: 'floor-card-text',
              text:
                trajectory.model === 'geometric' && k > 1
                  ? `sin ${ORDINAL[k - 1]} bote: el motor geometrico no tiene gravedad`
                  : `no llega a dar un ${ORDINAL[k - 1]} bote`,
            }),
          ]),
        );
        continue;
      }
      const b = c.bounce;
      const card = el(
        'button',
        {
          class: c.skip ? 'floor-card floor-card--skip' : 'floor-card',
          type: 'button',
          'data-floor-card': k,
          title: 'Ir a este bote en la linea de tiempo',
        },
        [
          contactChip(c),
          el('span', { class: 'floor-card-text' }, [
            el('strong', {
              text: c.skip
                ? 'PISO antes que la frontal: skip'
                : `a ${b.point.z.toFixed(1)} m de la frontal`,
            }),
            el('span', {
              text: `${lateral(b.point.x)} · ${b.time.toFixed(2)} s · llega a ${b.incomingSpeed.toFixed(0)} m/s`,
            }),
          ]),
        ],
      );
      card.addEventListener('click', () => update({ playhead: b.time, playing: false }));
      floorsHost.append(card);
    }
  };

  const render = (trajectory: Trajectory): void => {
    // ---- FASE 8: juicio reglamentario y clasificacion ----
    const a = analyse(trajectory, state.shot.origin, state.serveMode);

    clearNode(verdict);
    const badges = el('div', { class: 'badge-row' });
    badges.append(badge(a.classLabel, a.classification === 'skip' ? 'bad' : 'ok'));
    badges.append(
      a.ret.legal
        ? badge('devolucion legal', 'plain')
        : badge(a.ret.label, 'bad'),
    );
    if (a.serve) {
      badges.append(badge(a.serve.label, a.serve.legal ? 'ok' : 'bad'));
    }
    verdict.append(badges);
    if (trajectory.bounces.length > 0) {
      verdict.append(
        el('div', { class: 'sequence', title: 'F frontal · I izquierda · D derecha · T trasera · C techo' }, [
          readableSequence(trajectory, 7),
        ]),
      );
    }
    verdict.append(el('div', { class: 'verdict-detail', text: a.classDetail }));
    if (!a.ret.legal) {
      verdict.append(el('div', { class: 'verdict-detail', text: a.ret.detail }));
    }
    if (a.serve && !a.serve.legal) {
      verdict.append(el('div', { class: 'verdict-detail', text: a.serve.detail }));
    }

    renderFloorCards(trajectory);

    clearNode(stats);
    stats.append(
      stat(
        'Botes de piso',
        String(trajectory.bounces.filter((b) => b.surface === 'floor').length),
        `de ${trajectory.bounces.length} contactos`,
      ),
      stat('Duracion', trajectory.totalTime.toFixed(2), 's'),
      stat('Recorrido', pathLength(trajectory).toFixed(1), 'm'),
      stat(
        'Velocidad final',
        length(trajectory.samples.at(-1)?.v ?? { x: 0, y: 0, z: 0 }).toFixed(0),
        'm/s',
      ),
    );
    // La metrica util del spec: el mejor predictor de si un passing shot
    // es ganador o un regalo. Se muestra siempre.
    stats.append(
      el('div', { class: 'stat stat--wide' }, [
        el('div', {
          class: 'stat-label',
          text: `Altura al cruzar ${DEEP_PROBE_Z} m (tras el 1er bote)`,
        }),
        el('div', { class: 'stat-value' }, [
          a.deepHeight == null ? 'no llega' : a.deepHeight.toFixed(2),
          ...(a.deepHeight == null ? [] : [el('small', { text: ' m' })]),
          el('small', {
            text:
              a.deepHeight == null
                ? ''
                : a.deepHeight < 1
                  ? '  · no la levanta'
                  : a.deepHeight < 1.8
                    ? '  · devolvible'
                    : '  · regalo',
          }),
        ]),
      ]),
    );

    stats.append(
      stat(
        '1er bote',
        a.firstFloor ? `${a.firstFloor.point.z.toFixed(1)}` : '—',
        a.firstFloor
          ? a.firstFloor.point.z > COURT.shortLine
            ? 'm · profundo'
            : 'm · corto'
          : '',
      ),
      stat(
        'Impacto frontal',
        a.frontImpactHeight == null ? '—' : a.frontImpactHeight.toFixed(2),
        a.frontImpactHeight == null ? '' : 'm',
      ),
    );

    stats.append(
      el('div', { class: 'stat stat--wide' }, [
        el('div', { class: 'stat-label', text: 'Termina por' }),
        el('div', {
          class: 'stat-value stat-value--text',
          text: TERMINATION_TEXT[trajectory.terminated],
        }),
      ]),
    );

    clearNode(tableHost);
    if (trajectory.bounces.length === 0) {
      tableHost.append(
        el('div', {
          class: 'field-hint',
          text: 'Este tiro no toca ninguna superficie.',
        }),
      );
      return;
    }

    const table = el('table', { class: 'inspector-table' });
    const head = el('tr', {}, [
      el('th', { text: '' }),
      el('th', { text: 'donde' }),
      el('th', { text: 't (s)' }),
      el('th', { text: 'alto' }),
      el('th', { text: 'v' }),
      el('th', { text: 'ang' }),
    ]);
    table.append(el('thead', {}, [head]));

    const body = el('tbody');
    for (const c of labelContacts(trajectory)) {
      const b = c.bounce;
      const row = el(
        'tr',
        {
          'data-bounce': b.index,
          class: c.kind === 'floor' ? 'row-floor' : 'row-wall',
        },
        [
          el('td', {}, [contactChip(c)]),
          el('td', { text: c.kind === 'floor' ? 'piso' : SURFACE_BY_ID[b.surface].label }),
          el('td', { text: b.time.toFixed(3) }),
          el('td', { text: `${b.point.y.toFixed(2)} m` }),
          el('td', { text: b.outgoingSpeed.toFixed(0) }),
          el('td', { text: `${b.incidenceAngleDeg.toFixed(0)}°` }),
        ],
      );
      row.title = `x ${b.point.x.toFixed(2)}  y ${b.point.y.toFixed(2)}  z ${b.point.z.toFixed(2)}`;
      row.addEventListener('click', () =>
        update({ playhead: b.time, playing: false }),
      );
      body.append(row);
    }
    table.append(body);
    tableHost.append(table);
  };

  render(state.trajectory);

  return {
    id: 'inspector',
    label: 'Rebotes',
    root,
    sync(changed) {
      if (changed.has('trajectory') || changed.has('serveMode')) {
        render(state.trajectory);
      }
    },
  };
};
