/**
 * FASE 7 — Motor balistico: gravedad, arrastre y COR.
 *
 *   a = (0, -g, 0) - k * |v| * v      con k = 0.5 * rho * Cd * A / m
 *
 * A nivel del mar k = 0.0194 1/m (en El Alto, 0.0116: ver atmosphere.ts),
 * lo que significa que el arrastre pesa 1.8 g a 30 m/s y 14.3 g a 85 m/s
 * a nivel del mar: DOMINA SOBRE LA
 * GRAVEDAD en todo el rango util. No es un refinamiento opcional; sin el,
 * las trayectorias rapidas no desaceleran y los rebotes tardios quedan
 * demasiado vivos.
 *
 * EL RIESGO NUMERO UNO ES EL TUNNELING. A 85 m/s con un paso de 1/60 s la
 * pelota avanza 1.42 m por frame y la cancha mide 6.1 m de ancho: un
 * integrador de "avanza, luego mira si estas dentro" se salta paredes
 * enteras. Aqui no se hace eso en ningun sitio:
 *
 *   1. La fisica corre a paso fijo (1/1000 s), desacoplada del render.
 *   2. En cada substep se prueba el SEGMENTO p(t) -> p(t+dt) contra los
 *      seis planos, se toma el cruce mas temprano y se avanza EXACTAMENTE
 *      hasta ahi. Luego se rebota y se sigue con lo que queda del paso.
 *   3. La prueba de segmento funciona a cualquier dt, asi que el paso
 *      pequeno es por precision de la INTEGRACION, no por la colision.
 *      Aunque alguien suba el dt, no se puede colar por una pared.
 *
 * EL EFECTO (src/core/spin.ts). La pelota lleva su giro w. En cada
 * contacto la friccion la agarra o la deja deslizar, y eso cambia a la vez
 * la velocidad y el giro: es lo que hace que el Z salga de la segunda
 * lateral casi paralelo a la trasera. En vuelo el giro se conserva (sin
 * Magnus: INVESTIGACION.md, seccion 7). Si llega bajando a la banda del
 * crack y cumple el criterio del nick, sale RODANDO: desde ahi la pelota
 * va pegada al piso, frenada por el aire y la rodadura, hasta que se para
 * o choca con una pared.
 */

import {
  BALL,
  COR_SPEED,
  DRAG_K,
  GRAVITY,
  SIM,
  SURFACE_COR,
  corAtSpeed,
} from './constants.js';
import {
  clampToCourt,
  clearsBackWall,
  firstSegmentCrossing,
  type Surface,
} from './court.js';
import {
  SPIN,
  defaultNick,
  nickCheck,
  rollingSpin,
  settleRolling,
  spinBounce,
  type ContactParams,
} from './spin.js';
import type { Shot, SimOptions, SurfaceId, Trajectory, Vec3 } from './types.js';
import { TrajectoryBuilder, defaultSampleDt } from './trajectory-builder.js';
import { addScaled, clone, cross, dot, length, normalize, scale } from './vec3.js';

/** Cuantos contactos se admiten dentro de un mismo substep (esquinas). */
const MAX_CONTACTS_PER_STEP = 8;

interface Accel {
  (v: Vec3): Vec3;
}

const makeAccel = (dragK: number, gravity: boolean): Accel => {
  const g = gravity ? GRAVITY : 0;
  const k = dragK;
  return (v: Vec3): Vec3 => {
    const speed = length(v);
    const c = k * speed;
    return { x: -c * v.x, y: -g - c * v.y, z: -c * v.z };
  };
};

/**
 * Rodando por el piso: el aire frena el centro y la rodadura se opone al
 * avance. Como el piso obliga a seguir rodando, cada fuerza se reparte
 * entre traslacion y giro: a = F/(m (1 + alpha)).
 */
const makeRollAccel = (dragK: number, gravity: boolean): Accel => {
  const g = gravity ? GRAVITY : 0;
  const share = 1 / (1 + SPIN.inertiaFactor);
  return (v: Vec3): Vec3 => {
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-12) return { x: 0, y: 0, z: 0 };
    const c = (dragK * speed + (SPIN.rollingResistance * g) / speed) * share;
    return { x: -c * v.x, y: 0, z: -c * v.z };
  };
};

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const isVerticalWall = (id: SurfaceId): boolean =>
  id === 'front' || id === 'back' || id === 'left' || id === 'right';

/**
 * Rebote SIN efecto, el del motor de antes: se aplica una restitucion a la
 * componente normal y otra, fija, a la tangencial.
 *
 *   v_n' = -e_n * v_n     e_n = COR de esa superficie (0.872 por defecto)
 *   v_t' =  e_t * v_t     e_t = restitucion tangencial (0.65 por defecto)
 *
 * No es fisica: la pelota no gira y el rebote no recuerda nada. Queda solo
 * para comparar (`disableSpin`); el motor usa `spinBounce`.
 */
export const bounceVelocity = (
  v: Vec3,
  surface: Surface,
  normalRestitution: number,
  tangentialRestitution: number,
): Vec3 => {
  const n = surface.normal;
  const vn = dot(v, n);
  const tangential = addScaled(v, n, -vn);
  return addScaled(
    scale(tangential, tangentialRestitution),
    n,
    -vn * normalRestitution,
  );
};

export const simulateBallistic = (
  shot: Shot,
  opts: SimOptions = {},
): Trajectory => {
  const dt = opts.physicsDt && opts.physicsDt > 0 ? opts.physicsDt : SIM.physicsDt;
  const maxBounces = opts.maxBounces ?? SIM.maxBounces;
  const maxTime = opts.maxTime ?? SIM.maxTime;
  const spinOn = !opts.disableSpin;
  const corOf = (id: SurfaceId): number =>
    opts.surfaceRestitution?.[id] ?? SURFACE_COR[id];
  // El COR de cada impacto depende de su velocidad normal (constants.ts).
  const corLoss =
    opts.corSpeedLoss != null && opts.corSpeedLoss >= 0 ? opts.corSpeedLoss : COR_SPEED.lossPerMs;
  const corFor = (id: SurfaceId, vIn: Vec3, n: Vec3): number =>
    corAtSpeed(corOf(id), dot(vIn, n), corLoss);
  // Motor sin efecto (solo para comparar).
  const tangential = opts.tangentialRestitution ?? BALL.tangentialRestitution;
  const tangentialOf = (id: SurfaceId): number =>
    opts.surfaceTangential?.[id] ?? tangential;
  // Motor con efecto.
  const contactOf = (id: SurfaceId, vIn: Vec3, n: Vec3): ContactParams => ({
    restitution: corFor(id, vIn, n),
    friction: opts.surfaceFriction?.[id] ?? SPIN.friction,
    tangentialCor: SPIN.tangentialCor,
    inertiaFactor: SPIN.inertiaFactor,
    radius: BALL.radius,
  });
  const nickParams = {
    ...defaultNick(),
    stiffness:
      opts.ballStiffness != null && opts.ballStiffness > 0
        ? opts.ballStiffness
        : SPIN.stiffness,
  };
  const dragK = opts.disableDrag
    ? 0
    : opts.dragK != null && opts.dragK >= 0
      ? opts.dragK
      : DRAG_K;

  const accel = makeAccel(dragK, !opts.disableGravity);
  const rollAccel = makeRollAccel(dragK, !opts.disableGravity);
  const builder = new TrajectoryBuilder(
    defaultSampleDt(opts.sampleDt),
    'ballistic',
  );

  let p = clampToCourt(shot.origin);
  let v = scale(normalize(shot.direction), Math.max(0, shot.speed));
  // El giro solo existe con efecto; sin el, las muestras no lo llevan.
  let w: Vec3 | undefined = spinOn ? clone(shot.spin ?? ZERO) : undefined;
  let rolling = false;
  let t = 0;
  let floorBounces = 0;
  const stopAfterFloor = opts.stopAfterFloorBounces ?? Infinity;

  builder.pushExact(t, p, v, w);

  /**
   * Pasa a rodar desde un contacto con el piso en `at`: la pelota se
   * arrastra hasta rodar sin deslizar (spin.ts, `settleRolling`).
   */
  const startRolling = (at: Vec3, vel: Vec3, spin: Vec3): void => {
    const settled = settleRolling({ ...vel, y: 0 }, spin, BALL.radius, SPIN.inertiaFactor);
    p = { x: at.x, y: CENTER_Y_FLOOR, z: at.z };
    v = settled.v;
    w = settled.w;
    rolling = true;
  };

  /** Termino por limite de botes: comun a todos los contactos. */
  const limitReached = (): boolean =>
    builder.bounceCount >= maxBounces || floorBounces >= stopAfterFloor;

  while (t < maxTime - 1e-12) {
    let remaining = Math.min(dt, maxTime - t);
    let contacts = 0;

    while (remaining > 1e-12 && contacts < MAX_CONTACTS_PER_STEP) {
      const acc = rolling ? rollAccel : accel;
      const a0 = acc(v);

      // Velocity Verlet con un paso de correccion. La aceleracion depende
      // de la velocidad (arrastre), asi que el Verlet puro seria
      // implicito; una sola correccion sobra a 1 ms, donde la velocidad
      // cambia como mucho 0.14 m/s de 85.
      const pNext: Vec3 = {
        x: p.x + v.x * remaining + 0.5 * a0.x * remaining * remaining,
        y: p.y + v.y * remaining + 0.5 * a0.y * remaining * remaining,
        z: p.z + v.z * remaining + 0.5 * a0.z * remaining * remaining,
      };
      const vPredicted = addScaled(v, a0, remaining);
      const a1 = acc(vPredicted);
      const vNext: Vec3 = {
        x: v.x + 0.5 * (a0.x + a1.x) * remaining,
        y: v.y + 0.5 * (a0.y + a1.y) * remaining,
        z: v.z + 0.5 * (a0.z + a1.z) * remaining,
      };

      const hit = firstSegmentCrossing(p, pNext, 0);

      // Estado a mitad de tramo, para la rejilla de muestreo. Rodando, el
      // giro sigue a la velocidad; en vuelo no cambia.
      const p0 = p;
      const v0 = v;
      const w0 = w;
      const t0 = t;
      const rolling0 = rolling;
      const stateAt = (tt: number) => {
        const tau = tt - t0;
        const vv = addScaled(v0, a0, tau);
        return {
          p: {
            x: p0.x + v0.x * tau + 0.5 * a0.x * tau * tau,
            y: p0.y + v0.y * tau + 0.5 * a0.y * tau * tau,
            z: p0.z + v0.z * tau + 0.5 * a0.z * tau * tau,
          },
          v: vv,
          w: w0 && rolling0 ? rollingSpin(vv, BALL.radius, w0.y) : w0,
        };
      };

      // --- tramo libre: ningun plano en el camino ---
      if (!hit) {
        builder.fillGrid(t0, t0 + remaining, stateAt);
        p = pNext;
        v = vNext;
        if (rolling && w) w = rollingSpin(v, BALL.radius, w.y);
        t += remaining;
        remaining = 0;

        // Rodando se frena hasta pararse: ahi termina.
        if (rolling && Math.hypot(v.x, v.z) < SPIN.rollingStopSpeed) {
          builder.pushExact(t, p, v, w);
          return builder.finish(t, 'restingOnFloor');
        }
        break;
      }

      // --- hay contacto dentro del substep ---
      contacts++;
      const s = hit.t;
      const contactTime = t + s * remaining;
      builder.fillGrid(t0, contactTime, stateAt);

      const vIn = addScaled(v, a0, s * remaining);
      const wIn = w && rolling ? rollingSpin(vIn, BALL.radius, w.y) : w;
      const surface = hit.surface;

      // La pared trasera solo mide 12 ft: por encima no hay pared.
      if (surface.id === 'back' && clearsBackWall(hit.point.y)) {
        builder.pushExact(contactTime, hit.point, vIn, wIn);
        return builder.finish(contactTime, 'exitedCourt');
      }

      remaining -= s * remaining;
      t = contactTime;

      // ------------------------------------------------ sin efecto
      if (!spinOn || !wIn) {
        const vOut = bounceVelocity(
          vIn,
          surface,
          corFor(surface.id, vIn, surface.normal),
          tangentialOf(surface.id),
        );
        // Se guarda la velocidad SALIENTE en la muestra del contacto: asi
        // la energia entre dos muestras consecutivas nunca sube, que es
        // uno de los criterios de aceptacion.
        builder.pushExact(contactTime, hit.point, vOut);
        builder.pushBounce({
          surface: surface.id,
          point: hit.point,
          time: contactTime,
          vIn,
          vOut,
          normal: surface.normal,
        });
        p = hit.point;
        v = vOut;

        // Condicion de reposo. Sin esto se entra en el bucle clasico de
        // micro-rebotes infinitos contra el piso.
        if (surface.id === 'floor' && Math.abs(dot(vOut, surface.normal)) < SIM.restingSpeed) {
          return builder.finish(t, 'restingOnFloor');
        }
        if (surface.id === 'floor') floorBounces++;
        if (limitReached()) return builder.finish(t, 'maxBounces');
        continue;
      }

      // ------------------------------------------------ con efecto
      const extra: NonNullable<Parameters<TrajectoryBuilder['pushBounce']>[0]['extra']> = {
        spinIn: wIn,
      };

      // El nick: bajando a la banda del crack de una pared vertical.
      if (!rolling && isVerticalWall(surface.id)) {
        const nick = nickCheck(vIn, wIn, surface.normal, hit.point.y, nickParams);
        if (nick.descending && nick.heightRatio < 1) extra.nickTau = nick.tau;

        if (nick.rollout) {
          // La pared devuelve la componente normal y el giro sobre la
          // arista del crack se anula con la friccion del piso: sale en
          // horizontal, sin bote (PNAS 2025). Luego se arrastra hasta rodar.
          const b = spinBounce(vIn, wIn, surface.normal, contactOf(surface.id, vIn, surface.normal));
          const crease = normalize(cross(surface.normal, { x: 0, y: 1, z: 0 }));
          const wWall = addScaled(b.w, crease, -dot(b.w, crease));
          const vWall = { ...b.v, y: 0 };
          const floorPoint = { x: hit.point.x, y: CENTER_Y_FLOOR, z: hit.point.z };
          startRolling(floorPoint, vWall, wWall);

          builder.pushExact(contactTime, hit.point, vWall, wWall);
          builder.pushBounce({
            surface: surface.id,
            point: hit.point,
            time: contactTime,
            vIn,
            vOut: vWall,
            normal: surface.normal,
            extra: { ...extra, spinOut: wWall, slipped: b.slipped, rollout: true },
          });
          // Y en el mismo instante toca el piso, ya rodando: es su bote 1.
          builder.pushExact(contactTime, p, v, w);
          builder.pushBounce({
            surface: 'floor',
            point: p,
            time: contactTime,
            vIn: vWall,
            vOut: v,
            normal: { x: 0, y: 1, z: 0 },
            extra: { spinIn: wWall, spinOut: w, rolling: true },
          });
          floorBounces++;
          if (limitReached()) return builder.finish(t, 'maxBounces');
          continue;
        }
      }

      const b = spinBounce(vIn, wIn, surface.normal, contactOf(surface.id, vIn, surface.normal));
      let vOut = b.v;
      let wOut = b.w;
      let startsRolling = false;

      if (rolling) {
        // Rodando, la pelota choca con la pared SIN dejar el piso: toca las
        // dos superficies a la vez, como en el nick. La pared frena el punto
        // de contacto hacia arriba y el piso hacia abajo; las dos fricciones
        // se oponen y el giro sobre la arista se anula (PNAS 2025). Sale en
        // horizontal y vuelve a rodar: no salta.
        const crease = normalize(cross(surface.normal, { x: 0, y: 1, z: 0 }));
        const settled = settleRolling(
          { ...vOut, y: 0 },
          addScaled(wOut, crease, -dot(wOut, crease)),
          BALL.radius,
          SPIN.inertiaFactor,
        );
        vOut = settled.v;
        wOut = settled.w;
      } else if (surface.id === 'floor' && Math.abs(vOut.y) < SIM.restingSpeed) {
        // Ya casi no bota: si aun corre, rueda; si no, se queda.
        if (Math.hypot(vOut.x, vOut.z) >= SPIN.rollingStopSpeed) {
          const settled = settleRolling({ ...vOut, y: 0 }, wOut, BALL.radius, SPIN.inertiaFactor);
          vOut = settled.v;
          wOut = settled.w;
          startsRolling = true;
        } else {
          builder.pushExact(contactTime, hit.point, vOut, wOut);
          builder.pushBounce({
            surface: surface.id,
            point: hit.point,
            time: contactTime,
            vIn,
            vOut,
            normal: surface.normal,
            extra: { ...extra, spinOut: wOut, slipped: b.slipped },
          });
          return builder.finish(t, 'restingOnFloor');
        }
      }

      // Se guarda la velocidad SALIENTE en la muestra del contacto: asi la
      // energia entre dos muestras consecutivas nunca sube, que es uno de
      // los criterios de aceptacion.
      builder.pushExact(contactTime, hit.point, vOut, wOut);
      builder.pushBounce({
        surface: surface.id,
        point: hit.point,
        time: contactTime,
        vIn,
        vOut,
        normal: surface.normal,
        extra: {
          ...extra,
          spinOut: wOut,
          slipped: b.slipped,
          ...(startsRolling ? { rolling: true } : {}),
        },
      });

      p = hit.point;
      v = vOut;
      w = wOut;
      if (startsRolling) {
        rolling = true;
        p = { ...p, y: CENTER_Y_FLOOR };
      }

      if (surface.id === 'floor') floorBounces++;
      if (limitReached()) return builder.finish(t, 'maxBounces');
    }

    // Atascado en una esquina con demasiados contactos en un solo paso:
    // es reposo en la practica, y es preferible a colgar el bucle.
    if (contacts >= MAX_CONTACTS_PER_STEP && remaining > 1e-12) {
      return builder.finish(t, 'restingOnFloor');
    }
  }

  builder.pushExact(t, p, v, w);
  return builder.finish(t, 'maxTime');
};

/** Donde va el centro de la pelota apoyada en el piso. */
const CENTER_Y_FLOOR = BALL.radius;
