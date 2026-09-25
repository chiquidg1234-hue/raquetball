/**
 * Catalogo de pelotas. Gael juega con estas y solo con estas.
 *
 * Los fabricantes no publican NI UN numero medido: ni diametro, ni masa,
 * ni COR, ni altura de rebote. Solo adjetivos. Asi que:
 *   - diametro y masa: los de la norma (USAR regla 2, IRF 2.2);
 *   - rebote: cada pelota se coloca DENTRO del rango legal (68-72 in desde
 *     100 in) segun el orden que dan sus propias fichas. Es una estimacion
 *     ORDINAL, no una medida, y el panel Cancha la deja calibrar.
 *
 * Fuentes: INVESTIGACION.md, seccion 1.
 */

import { BALL_TEST_AIR, airDensity, corFromDropTest, dragConstant } from './atmosphere.js';
import { BALL, BALL_TEST, IN } from './constants.js';

export type BallId = 'gearbox-black' | 'gearbox-blue' | 'formulaflow-blue';

export interface BallSpec {
  id: BallId;
  name: string;
  maker: string;
  /** Color para dibujarla. */
  color: string;
  /** Lo que dice el fabricante, literal. */
  claim: string;
  /** Rebote estimado desde 100 in, en pulgadas (68-72 legal). */
  reboundIn: number;
  /** Por que ese rebote: siempre una estimacion, nunca una medida. */
  reboundBasis: string;
  source: string;
}

export const BALLS: Record<BallId, BallSpec> = {
  'gearbox-black': {
    id: 'gearbox-black',
    name: 'Gearbox Sleek Black',
    maker: 'Gearbox',
    color: '#26282c',
    claim: 'Speed "Fast and Smooth", bounce "Soft and Consistent"',
    reboundIn: 69,
    reboundBasis:
      'estimacion: la mas blanda de las tres segun su ficha ("soft"), por debajo del centro del rango',
    source: 'https://gearboxsports.com/products/racquetball-3-ball-pack-sleek-black',
  },
  'formulaflow-blue': {
    id: 'formulaflow-blue',
    name: 'Formulaflow Blue',
    maker: 'Formulaflow',
    color: '#2f6fe0',
    claim: '"Balanced Speed: a controlled, lively response"',
    reboundIn: 70,
    reboundBasis: 'estimacion: "balanced", el centro del rango legal',
    source: 'https://formulaflow.com/products/racquetballs',
  },
  'gearbox-blue': {
    id: 'gearbox-blue',
    name: 'Gearbox Electric Blue',
    maker: 'Gearbox',
    color: '#1aa3ff',
    claim: 'Speed "Gearbox\'s Fastest Ball", bounce "Lively and Consistent"',
    reboundIn: 71,
    reboundBasis:
      'estimacion: la mas rapida de Gearbox segun su ficha ("fastest"), por encima del centro',
    source: 'https://gearboxsports.com/products/racquetball-3-ball-pack-electric-blue',
  },
};

export const BALL_IDS = Object.keys(BALLS) as BallId[];

export const DEFAULT_BALL: BallId = 'formulaflow-blue';

export const isBallId = (v: unknown): v is BallId =>
  typeof v === 'string' && v in BALLS;

/** Rango legal del rebote, en pulgadas. */
export const REBOUND_RANGE_IN = {
  min: BALL_TEST.reboundMin / IN,
  max: BALL_TEST.reboundMax / IN,
} as const;

/** k del aire de la prueba de homologacion (nivel del mar, 72 F). */
const TEST_DRAG_K = dragConstant(airDensity(BALL_TEST_AIR), BALL);

/**
 * COR de una pelota que rebota `reboundIn` pulgadas en la prueba de
 * homologacion, con arrastre. 68 in -> 0.859, 70 in -> 0.872, 72 in -> 0.885.
 */
export const corForRebound = (reboundIn: number): number =>
  corFromDropTest(reboundIn * IN, BALL_TEST.dropHeight, TEST_DRAG_K);

/**
 * Temperatura de la prueba de homologacion: 70-74 F, el centro es 72 F.
 * La sensibilidad del COR a la temperatura NO esta publicada para
 * racquetball (los datos que hay son de squash, una pelota hecha para
 * morir). Por eso entra como parametro, 0 por defecto, y el panel lo dice.
 */
export const BALL_TEST_TEMPERATURE_C = BALL_TEST_AIR.temperatureC;

export const corAtTemperature = (
  cor: number,
  temperatureC: number,
  perDegree: number,
): number => {
  const scaled = cor * (1 + perDegree * (temperatureC - BALL_TEST_TEMPERATURE_C));
  return Math.min(0.98, Math.max(0.3, scaled));
};
