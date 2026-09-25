/**
 * El aire de la cancha: altitud + temperatura -> densidad -> arrastre.
 *
 * Es el efecto fisico mas grande de todo el sitio de juego. El arrastre
 * del motor es  a = -k|v|v  con  k = 0.5 rho Cd A / m, y rho cae con la
 * altitud: a la misma temperatura, el aire de El Alto pesa un 37 % menos
 * que el de Santa Cruz, y la pelota se frena un 37 % menos.
 *
 * Modulo puro: no importa constants.ts (constants.ts lo importa a el para
 * calcular DRAG_K), asi que las medidas de la pelota entran por parametro.
 *
 * Fuentes y cuentas: INVESTIGACION.md, seccion 3.
 */

/**
 * Atmosfera estandar, capa 0 de la U.S. Standard Atmosphere 1976 (valida
 * hasta 11 km). https://en.wikipedia.org/wiki/Barometric_formula
 *
 *   P(h) = P0 * (1 - L h / T0) ^ (g0 M / (R* L))
 */
export const ISA = {
  /** Pa, presion a nivel del mar. */
  p0: 101_325,
  /** K, temperatura a nivel del mar. */
  t0: 288.15,
  /** K/m, gradiente termico de la troposfera. */
  lapse: 0.0065,
  /** g0*M/(R*L), adimensional (tabla de la fuente). */
  exponent: 5.25588,
} as const;

/** J/(kg K), constante especifica del aire seco. */
export const R_DRY_AIR = 287.05;

export const CELSIUS_TO_KELVIN = 273.15;

/**
 * Condiciones de referencia del spec original: nivel del mar y 20 C. Con
 * ellas rho = 1.2041 kg/m3 (la tabla de "Density of air" da exactamente
 * eso) y k = 0.01945 1/m. El 0.0194 del spec salia de redondear rho a 1.20.
 */
export const REFERENCE_AIR = { altitude: 0, temperatureC: 20 } as const;

/**
 * Condiciones de la prueba de homologacion de la pelota: 70-74 F. Se toma
 * el centro, 72 F. La norma no dice a que altitud: se supone nivel del mar.
 */
export const BALL_TEST_AIR = {
  altitude: 0,
  temperatureC: ((72 - 32) * 5) / 9, // 22.22 C
} as const;

/** Presion estandar a una altitud, en Pa. */
export const standardPressure = (altitudeM: number): number => {
  const h = Math.min(11_000, Math.max(-500, altitudeM));
  return ISA.p0 * Math.pow(1 - (ISA.lapse * h) / ISA.t0, ISA.exponent);
};

export interface AirInput {
  altitude: number;
  temperatureC: number;
  /**
   * Presion medida, en hPa. Si no hay, la estandar de esa altitud. La real
   * se mueve con el tiempo meteorologico y en los Andes suele estar algo
   * por encima de la estandar.
   */
  pressureHpa?: number | null;
}

/** Densidad del aire seco, gas ideal:  rho = P / (R T). */
export const airDensity = (air: AirInput): number => {
  const pressure =
    air.pressureHpa != null && air.pressureHpa > 0
      ? air.pressureHpa * 100
      : standardPressure(air.altitude);
  const kelvin = air.temperatureC + CELSIUS_TO_KELVIN;
  return pressure / (R_DRY_AIR * Math.max(1, kelvin));
};

export interface BallAero {
  /** m */
  radius: number;
  /** kg */
  mass: number;
  dragCoefficient: number;
}

/** k = 0.5 rho Cd A / m,  en 1/m. */
export const dragConstant = (density: number, ball: BallAero): number =>
  (0.5 * density * ball.dragCoefficient * Math.PI * ball.radius * ball.radius) /
  ball.mass;

/**
 * Viscosidad dinamica del aire, ley de Sutherland (Pa s). Solo sirve para
 * el numero de Reynolds que se ensena en el panel.
 *   mu = mu0 (T/T0)^(3/2) (T0 + S)/(T + S),  mu0 = 1.716e-5, T0 = 273.15, S = 110.4
 */
export const airViscosity = (temperatureC: number): number => {
  const t = temperatureC + CELSIUS_TO_KELVIN;
  const t0 = 273.15;
  const s = 110.4;
  return 1.716e-5 * Math.pow(t / t0, 1.5) * ((t0 + s) / (t + s));
};

/**
 * Numero de Reynolds de la pelota. Por encima de ~3e5 una esfera lisa
 * entra en la "crisis de arrastre" y el Cd = 0.5 del motor deja de valer.
 */
export const reynolds = (
  speed: number,
  density: number,
  temperatureC: number,
  diameter: number,
): number => (density * speed * diameter) / airViscosity(temperatureC);

/**
 * COR a partir de la prueba de homologacion (soltar desde h_caida y medir
 * a que altura rebota), CON arrastre cuadratico. La caida y la subida
 * verticales tienen solucion cerrada:
 *
 *   v_llegada^2 = (g/k)(1 - e^(-2k h_caida))
 *   v_salida^2  = (g/k)(e^(2k h_rebote) - 1)
 *
 * La cuenta de siempre, sqrt(h_rebote/h_caida), ignora el arrastre y da
 * un COR demasiado bajo: con 0.837 el propio motor veia a la pelota
 * rebotar a 64.6 in desde 100 in, fuera del rango legal de 68-72 in.
 * g se cancela. Con k -> 0 la formula vuelve a sqrt(h_rebote/h_caida).
 */
export const corFromDropTest = (
  reboundM: number,
  dropM: number,
  k: number,
): number => {
  if (k <= 1e-12) return Math.sqrt(reboundM / dropM);
  const up = Math.expm1(2 * k * reboundM);
  const down = -Math.expm1(-2 * k * dropM);
  return Math.sqrt(up / down);
};

/** La inversa: a que altura rebota una pelota con este COR. */
export const reboundFromCor = (cor: number, dropM: number, k: number): number => {
  if (k <= 1e-12) return cor * cor * dropM;
  return Math.log1p(cor * cor * -Math.expm1(-2 * k * dropM)) / (2 * k);
};
