/**
 * Panel "Cancha": donde se juega, con que pelota y sobre que paredes.
 *
 * La mitad de la leccion es ver el numero: la densidad del aire y la k de
 * arrastre salen en vivo, y cambian en cuanto se cambia de ciudad. Lo que
 * no tiene dato publicado (el rebote de cada pelota, las superficies, el
 * efecto de la temperatura en la goma) se dice aqui mismo y queda a mano
 * para calibrarlo.
 */

import { BALLS, BALL_IDS, corForRebound, type BallId } from '../core/balls.js';
import { GRAVITY } from '../core/constants.js';
import { AIR_DENSITY } from '../core/constants.js';
import {
  FLOOR_MATERIALS,
  FLOOR_MATERIAL_IDS,
  WALL_MATERIALS,
  WALL_MATERIAL_IDS,
  type FloorMaterialId,
  type WallMaterialId,
} from '../core/surfaces.js';
import {
  DEFAULT_VENUE,
  LIMITS,
  PLACES,
  PLACE_IDS,
  venueAir,
  venueBallCor,
  venueReynolds,
  venueSimOptions,
  withBall,
  withFloor,
  withPlace,
  withWalls,
  type PlaceId,
  type Venue,
} from '../core/venue.js';
import { standardPressure } from '../core/atmosphere.js';
import { button, el, slider, type SliderHandle } from './dom.js';
import type { PanelView } from './panels.js';
import { state, update } from './state.js';

const setVenue = (patch: Partial<Venue> | ((v: Venue) => Venue)): void => {
  const next = typeof patch === 'function' ? patch(state.venue) : { ...state.venue, ...patch };
  update({ venue: next });
};

const selectField = <T extends string>(
  label: string,
  field: string,
  options: { value: T; text: string }[],
  onChange: (value: T) => void,
): { root: HTMLElement; select: HTMLSelectElement; hint: HTMLElement } => {
  const select = el('select', {
    class: 'btn select-wide',
    'data-field': field,
    'aria-label': label,
  }) as HTMLSelectElement;
  for (const o of options) select.append(el('option', { value: o.value, text: o.text }));
  select.addEventListener('change', () => onChange(select.value as T));
  const hint = el('div', { class: 'field-hint' });
  const root = el('div', { class: 'field', 'data-field-row': field }, [
    el('div', { class: 'field-head' }, [el('span', { class: 'field-label', text: label })]),
    select,
    hint,
  ]);
  return { root, select, hint };
};

const stat = (label: string, field: string): { root: HTMLElement; value: HTMLElement } => {
  const value = el('div', { class: 'stat-value', 'data-readout': field });
  return {
    root: el('div', { class: 'stat' }, [el('div', { class: 'stat-label', text: label }), value]),
    value,
  };
};

const sci = (n: number): string => {
  const exp = Math.floor(Math.log10(Math.abs(n)));
  return `${(n / 10 ** exp).toFixed(1)}·10${String(exp).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]!)}`;
};

export const createVenuePanel = (): PanelView => {
  const root = el('div', { class: 'panel-view', 'data-panel-view': 'venue' });

  // ------------------------------------------------------------ lugar

  const place = selectField<PlaceId>(
    'Ciudad',
    'venue-place',
    [
      ...PLACE_IDS.map((id) => ({
        value: id as PlaceId,
        text: `${PLACES[id].name} · ${PLACES[id].altitude.toLocaleString('es')} m`,
      })),
      { value: 'custom' as PlaceId, text: 'Otra altitud…' },
    ],
    (id) => setVenue((v) => withPlace(v, id)),
  );

  const altitude = slider({
    field: 'venue-altitude',
    label: 'Altitud',
    min: LIMITS.altitude.min,
    max: LIMITS.altitude.max,
    step: 10,
    value: state.venue.altitude,
    format: (v) => `${Math.round(v).toLocaleString('es')} m`,
    // Mover la altitud a mano es salirse de la lista de ciudades.
    onInput: (v) => setVenue({ place: 'custom', altitude: v }),
  });

  const temperature = slider({
    field: 'venue-temperature',
    label: 'Temperatura de la cancha',
    min: LIMITS.temperatureC.min,
    max: LIMITS.temperatureC.max,
    step: 1,
    value: state.venue.temperatureC,
    format: (v) => `${v.toFixed(0)} °C`,
    hint: 'Entra en la densidad del aire. La norma homologa la pelota a 21-23 °C.',
    onInput: (v) => setVenue({ temperatureC: v }),
  });

  const pressureToggle = el('input', {
    type: 'checkbox',
    'data-field': 'venue-pressure-on',
  }) as HTMLInputElement;
  const pressureInput = el('input', {
    type: 'number',
    class: 'btn number-input',
    min: LIMITS.pressureHpa.min,
    max: LIMITS.pressureHpa.max,
    step: 1,
    'data-field': 'venue-pressure',
    'aria-label': 'Presión medida en hPa',
  }) as HTMLInputElement;
  pressureToggle.addEventListener('change', () => {
    setVenue({
      pressureHpa: pressureToggle.checked
        ? Math.round(standardPressure(state.venue.altitude) / 100)
        : null,
    });
  });
  pressureInput.addEventListener('change', () => {
    const v = Number(pressureInput.value);
    if (Number.isFinite(v) && v >= LIMITS.pressureHpa.min && v <= LIMITS.pressureHpa.max) {
      setVenue({ pressureHpa: v });
    }
  });
  const pressureRow = el('div', { class: 'field' }, [
    el('label', { class: 'toggle-row' }, [
      pressureToggle,
      el('span', { text: 'Usar una presión medida (hPa)' }),
    ]),
    pressureInput,
    el('div', {
      class: 'field-hint',
      text: 'Sin marcar, la presión es la de la atmósfera estándar para esa altitud. La real se mueve con el tiempo; en los Andes suele estar algo por encima.',
    }),
  ]);

  // --------------------------------------------------------- lectura viva

  const rho = stat('Densidad del aire', 'rho');
  const k = stat('Arrastre k', 'k');
  const pressure = stat('Presión', 'pressure');
  const dragAtSpeed = stat('Freno al tiro actual', 'drag-g');
  const reynoldsStat = stat('Reynolds', 'reynolds');
  const cor = stat('COR de la pelota', 'cor');
  reynoldsStat.root.classList.add('stat--wide');
  cor.root.classList.add('stat--wide');
  const readout = el('div', { class: 'stat-grid venue-readout' }, [
    rho.root,
    k.root,
    pressure.root,
    dragAtSpeed.root,
    cor.root,
    reynoldsStat.root,
  ]);

  const geometricNotice = el('div', { class: 'notice' }, [
    el('span', {
      text: 'El modelo geométrico no tiene aire ni pérdidas: la cancha no le cambia nada. ',
    }),
    button('Pasar a balístico', () => update({ model: 'ballistic' }), {
      'data-action': 'venue-ballistic',
    }),
  ]);

  // ------------------------------------------------------------ pelota

  const ball = selectField<BallId>(
    'Pelota',
    'venue-ball',
    BALL_IDS.map((id) => ({ value: id, text: BALLS[id].name })),
    (id) => setVenue((v) => withBall(v, id)),
  );

  const rebound = slider({
    field: 'venue-rebound',
    label: 'Rebote en la prueba (desde 100 in)',
    min: LIMITS.reboundIn.min,
    max: LIMITS.reboundIn.max,
    step: 0.5,
    value: state.venue.reboundIn,
    format: (v) => `${v.toFixed(1)} in · COR ${corForRebound(v).toFixed(3)}`,
    hint: 'La norma exige 68-72 in. Ningún fabricante publica el de su pelota: el valor de cada una es una estimación por su ficha. Calíbralo si lo mides.',
    onInput: (v) => setVenue({ reboundIn: v }),
  });

  // ------------------------------------------------------------ cancha

  const walls = selectField<WallMaterialId>(
    'Paredes',
    'venue-walls',
    WALL_MATERIAL_IDS.map((id) => ({ value: id, text: WALL_MATERIALS[id].name })),
    (id) => setVenue((v) => withWalls(v, id)),
  );
  const floor = selectField<FloorMaterialId>(
    'Piso',
    'venue-floor',
    FLOOR_MATERIAL_IDS.map((id) => ({ value: id, text: FLOOR_MATERIALS[id].name })),
    (id) => setVenue((v) => withFloor(v, id)),
  );

  // ------------------------------------------------------- calibracion

  const factor = (v: number): string => `× ${v.toFixed(2)}`;
  const plain = (v: number): string => v.toFixed(2);
  const wallCor = slider({
    field: 'venue-wall-cor',
    label: 'Paredes: factor de COR',
    min: LIMITS.corFactor.min,
    max: LIMITS.corFactor.max,
    step: 0.01,
    value: state.venue.wallCorFactor,
    format: factor,
    onInput: (v) => setVenue({ wallCorFactor: v }),
  });
  const wallFriction = slider({
    field: 'venue-wall-friction',
    label: 'Paredes: fricción μ',
    min: LIMITS.friction.min,
    max: LIMITS.friction.max,
    step: 0.01,
    value: state.venue.wallFriction,
    format: plain,
    hint: 'Cuánto "agarra" la pared: de ella sale el efecto (el Z que sale paralelo a la trasera). 0.9 sale de una medida con pelota de racquetball sobre madera.',
    onInput: (v) => setVenue({ wallFriction: v }),
  });
  const floorCor = slider({
    field: 'venue-floor-cor',
    label: 'Piso: factor de COR',
    min: LIMITS.corFactor.min,
    max: LIMITS.corFactor.max,
    step: 0.01,
    value: state.venue.floorCorFactor,
    format: factor,
    onInput: (v) => setVenue({ floorCorFactor: v }),
  });
  const floorFriction = slider({
    field: 'venue-floor-friction',
    label: 'Piso: fricción μ',
    min: LIMITS.friction.min,
    max: LIMITS.friction.max,
    step: 0.01,
    value: state.venue.floorFriction,
    format: plain,
    hint: 'Un bote rasante desliza y sale con efecto liftado, que después hace "trepar" la pelota por la pared del fondo. Si en tu cancha sale menos, bájalo.',
    onInput: (v) => setVenue({ floorFriction: v }),
  });
  const stiffness = slider({
    field: 'venue-ball-stiffness',
    label: 'Pelota: rigidez E (nick)',
    min: LIMITS.ballStiffnessKpa.min,
    max: LIMITS.ballStiffnessKpa.max,
    step: 1,
    value: state.venue.ballStiffnessKpa,
    format: (v) => `${v.toFixed(0)} kPa`,
    hint: 'Decide cuánto dura el contacto con la pared y, con eso, si un tiro al crack sale rodando. No está publicada: 45 kPa es una estimación. Más blanda = rollout más fácil.',
    onInput: (v) => setVenue({ ballStiffnessKpa: v }),
  });
  const corSpeed = slider({
    field: 'venue-cor-speed',
    label: 'COR que se pierde con la velocidad',
    min: LIMITS.corSpeedLoss.min * 100,
    max: LIMITS.corSpeedLoss.max * 100,
    step: 0.01,
    value: state.venue.corSpeedLoss * 100,
    format: (v) => `${v.toFixed(2)} % por m/s`,
    hint: 'Toda pelota hueca rebota menos cuanto más fuerte llega. De racquetball no hay medida a velocidad de juego: 0.92 % sale de squash y tenis. 0 = COR constante.',
    onInput: (v) => setVenue({ corSpeedLoss: v / 100 }),
  });
  const corPerDegree = slider({
    field: 'venue-cor-temperature',
    label: 'COR de la pelota por grado',
    min: 0,
    max: LIMITS.corPerDegree.max * 100,
    step: 0.05,
    value: state.venue.corPerDegree * 100,
    format: (v) => `${v.toFixed(2)} %/°C`,
    hint: 'Una pelota fría rebota menos, pero no hay curva publicada para racquetball (solo para squash). Por eso vale 0 hasta que lo midas.',
    onInput: (v) => setVenue({ corPerDegree: v / 100 }),
  });

  const calibration = el('details', { class: 'calibrate' }, [
    el('summary', { text: 'Calibrar a mano (no hay datos publicados)' }),
    el('div', {
      class: 'field-hint',
      text: 'No existe ninguna medida publicada del rebote de una pelota de racquetball contra panel, revoque, cristal, madera o cemento. Todas las superficies arrancan iguales; si en tu cancha la pelota sale más viva o más muerta, ajústalo aquí.',
    }),
    wallCor.root,
    wallFriction.root,
    floorCor.root,
    floorFriction.root,
    stiffness.root,
    corSpeed.root,
    corPerDegree.root,
  ]);

  const reset = button('Volver a la referencia', () => update({ venue: { ...DEFAULT_VENUE } }), {
    'data-action': 'venue-reset',
  });

  root.append(
    el('div', { class: 'section-title', text: 'Donde se juega' }),
    place.root,
    altitude.root,
    temperature.root,
    pressureRow,
    el('div', { class: 'section-title', text: 'El aire, en vivo' }),
    readout,
    geometricNotice,
    el('div', { class: 'section-title', text: 'Pelota' }),
    ball.root,
    rebound.root,
    el('div', { class: 'section-title', text: 'Cancha' }),
    walls.root,
    floor.root,
    calibration,
    el('div', { class: 'copy-actions' }, [reset]),
  );

  const sliders: [SliderHandle, () => number][] = [
    [altitude, () => state.venue.altitude],
    [temperature, () => state.venue.temperatureC],
    [rebound, () => state.venue.reboundIn],
    [wallCor, () => state.venue.wallCorFactor],
    [wallFriction, () => state.venue.wallFriction],
    [floorCor, () => state.venue.floorCorFactor],
    [floorFriction, () => state.venue.floorFriction],
    [stiffness, () => state.venue.ballStiffnessKpa],
    [corSpeed, () => state.venue.corSpeedLoss * 100],
    [corPerDegree, () => state.venue.corPerDegree * 100],
  ];

  const render = (): void => {
    const v = state.venue;
    for (const [handle, read] of sliders) handle.set(read());
    place.select.value = v.place;
    ball.select.value = v.ball;
    walls.select.value = v.walls;
    floor.select.value = v.floor;
    place.hint.textContent =
      v.place === 'custom'
        ? 'Altitud a mano.'
        : `Altitud: ${PLACES[v.place].source}.`;
    const spec = BALLS[v.ball];
    ball.hint.textContent = `${spec.maker} dice: ${spec.claim}. Rebote ${spec.reboundIn} in: ${spec.reboundBasis}.`;
    walls.hint.textContent = WALL_MATERIALS[v.walls].detail;
    floor.hint.textContent = FLOOR_MATERIALS[v.floor].detail;

    pressureToggle.checked = v.pressureHpa != null;
    pressureInput.disabled = v.pressureHpa == null;
    if (document.activeElement !== pressureInput) {
      pressureInput.value = String(
        Math.round(v.pressureHpa ?? standardPressure(v.altitude) / 100),
      );
    }

    const air = venueAir(v);
    const ratio = air.density / AIR_DENSITY;
    rho.value.innerHTML = '';
    rho.value.append(
      `${air.density.toFixed(3)} `,
      el('small', { text: `kg/m³ · ${Math.round(ratio * 100)} % del mar` }),
    );
    k.value.innerHTML = '';
    k.value.append(`${air.dragK.toFixed(4)} `, el('small', { text: '1/m' }));
    pressure.value.innerHTML = '';
    pressure.value.append(
      `${(air.pressure / 100).toFixed(0)} `,
      el('small', { text: air.pressureSource === 'measured' ? 'hPa medida' : 'hPa estándar' }),
    );
    const speed = state.speed;
    const gs = (air.dragK * speed * speed) / GRAVITY;
    dragAtSpeed.value.innerHTML = '';
    dragAtSpeed.value.append(
      `${gs.toFixed(1)} g `,
      el('small', { text: `a ${speed.toFixed(0)} m/s` }),
    );
    const e = venueBallCor(v);
    const opts = venueSimOptions(v);
    cor.value.innerHTML = '';
    cor.value.append(
      `${e.toFixed(3)} `,
      el('small', {
        text:
          opts.surfaceRestitution!.front === opts.surfaceRestitution!.floor
            ? 'paredes y piso'
            : `pared ${opts.surfaceRestitution!.front!.toFixed(3)} · piso ${opts.surfaceRestitution!.floor!.toFixed(3)}`,
      }),
    );
    const re = venueReynolds(v, speed);
    reynoldsStat.value.classList.add('stat-value--text');
    reynoldsStat.value.textContent =
      re > 2.5e5
        ? `Re ${sci(re)} a ${speed.toFixed(0)} m/s: cerca de la crisis de arrastre (≈3·10⁵). El Cd = 0.5 del modelo aquí es menos fiable.`
        : `Re ${sci(re)} a ${speed.toFixed(0)} m/s: régimen subcrítico, Cd ≈ 0.5 vale.`;
    reynoldsStat.root.classList.toggle('stat--warn', re > 2.5e5);

    geometricNotice.hidden = state.model !== 'geometric';
  };

  render();

  return {
    id: 'venue',
    label: 'Cancha',
    root,
    sync(changed) {
      if (changed.has('venue') || changed.has('speed') || changed.has('model')) render();
    },
  };
};
