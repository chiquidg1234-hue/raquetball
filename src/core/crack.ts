/**
 * Por que un tiro salio rodando, o por que no.
 *
 * El nick (INVESTIGACION.md, seccion 8) pide dos cosas a la vez: que la
 * pelota toque la pared con el centro en la franja 0.6-0.75 D (34-43 mm)
 * y que llegue bajando lo bastante para que tau = t_rodar/t_contacto < 1.
 * Cuando falla una, decirlo con numeros es lo que ensena a pegarle: "a 6
 * mm de la franja" o "en la franja, pero llega plana".
 */

import { BALL } from './constants.js';
import { WALL_CODE, WALL_NAME } from './contacts.js';
import { SPIN } from './spin.js';
import type { Bounce, SurfaceId, Trajectory } from './types.js';

export type CrackKind = 'rollout' | 'flat' | 'near';

export interface CrackReport {
  kind: CrackKind;
  bounce: Bounce;
  /** Altura del centro al tocar la pared, en mm. */
  heightMm: number;
  tau: number;
  /** La franja del nick, en mm. */
  bandMm: [number, number];
  text: string;
}

/** Cuanto por fuera de la franja todavia merece aviso. */
const NEAR_MM = 15;

const BAND_MM: [number, number] = [
  SPIN.nickBand.min * BALL.diameter * 1000,
  SPIN.nickBand.max * BALL.diameter * 1000,
];

const wallName = (s: SurfaceId): string =>
  s === 'floor' ? 'piso' : `la ${WALL_NAME[WALL_CODE[s]]}`;

const mm = (v: number): string => v.toFixed(0);

export const crackReport = (t: Trajectory): CrackReport | null => {
  // Solo mientras la jugada sigue viva: despues del 2.o bote de piso el
  // punto ya se acabo y lo que haga la pelota en un crack no importa.
  const floors = t.bounces.filter((x) => x.surface === 'floor');
  const over = floors[1]?.time ?? Infinity;
  const b = t.bounces.find((x) => x.time < over && (x.rollout || x.nickTau != null));
  if (!b) return null;
  const h = b.point.y * 1000;
  const tau = b.nickTau ?? 0;
  const [lo, hi] = BAND_MM;
  const band = `${mm(lo)}-${mm(hi)} mm`;
  const where = wallName(b.surface);

  if (b.rollout) {
    return {
      kind: 'rollout',
      bounce: b,
      heightMm: h,
      tau,
      bandMm: BAND_MM,
      text: `Nick: tocó ${where} con el centro a ${mm(h)} mm del piso, bajando. τ = ${tau.toFixed(2)} < 1: sale rodando, sin bote.`,
    };
  }
  if (h > lo && h < hi) {
    return {
      kind: 'flat',
      bounce: b,
      heightMm: h,
      tau,
      bandMm: BAND_MM,
      text: `Entró en la franja del crack de ${where} (${mm(h)} mm), pero llega demasiado plana: τ = ${tau.toFixed(2)}. Para que salga rodando tiene que llegar bajando más, o más despacio.`,
    };
  }
  const off = h < lo ? lo - h : h - hi;
  if (off > NEAR_MM) return null;
  // tau es proporcional a la altura (t_rodar crece con H; t_contacto no
  // depende de ella): el mejor caso dentro de la franja es su borde de
  // abajo, con la misma llegada.
  const tauInBand = tau * (lo / h);
  return {
    kind: 'near',
    bounce: b,
    heightMm: h,
    tau,
    bandMm: BAND_MM,
    text: `Pasó por el crack de ${where} a ${mm(h)} mm: ${mm(off)} mm ${h < lo ? 'por debajo' : 'por encima'} de la franja del nick (${band}).${tauInBand < 1 ? ' Con esa caída, dentro de la franja habría salido rodando.' : ' Además llega demasiado plana para salir rodando.'}`,
  };
};
