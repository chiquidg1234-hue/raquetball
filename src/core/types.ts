/**
 * El contrato entre el motor de fisica y todo lo demas.
 *
 * CONGELADO al terminar la fase 1. Las vistas 3D y 2D, las reglas, la
 * pizarra y el solver consumen exactamente esto y nada mas. El motor no
 * sabe que existe el renderizado.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type SurfaceId =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'floor'
  | 'ceiling';

export interface Shot {
  /** Posicion del contacto raqueta-pelota (centro de la pelota). */
  origin: Vec3;
  /** Unitario. */
  direction: Vec3;
  /** m/s */
  speed: number;
  /**
   * rad/s: el giro con el que sale de la raqueta. Lo usa el motor
   * balistico (src/core/spin.ts); el geometrico lo ignora. Sin el, sale
   * sin giro y lo va tomando en cada contacto.
   */
  spin?: Vec3;
}

export interface Bounce {
  index: number;
  surface: SurfaceId;
  /** Centro de la pelota en el contacto. */
  point: Vec3;
  /** s desde el golpe. */
  time: number;
  incomingSpeed: number;
  outgoingSpeed: number;
  /** Grados respecto a la normal de la superficie. */
  incidenceAngleDeg: number;
  /** m/s, velocidad justo antes y justo despues del contacto. */
  velocityIn?: Vec3;
  velocityOut?: Vec3;
  /** rad/s, giro al llegar y al salir. Solo el motor balistico con efecto. */
  spinIn?: Vec3;
  spinOut?: Vec3;
  /** La friccion se saturo: la pelota deslizo todo el contacto. */
  slipped?: boolean;
  /**
   * Pared vertical tocada en la banda del crack y bajando: tau del
   * criterio del nick (PNAS 2025). Rollout si < 1.
   */
  nickTau?: number;
  /** Este contacto con la pared fue un nick: la pelota sale rodando. */
  rollout?: boolean;
  /** Desde este contacto con el piso la pelota rueda: ya no bota. */
  rolling?: boolean;
}

export interface Sample {
  t: number;
  p: Vec3;
  v: Vec3;
  /** rad/s. Solo el motor balistico con efecto. */
  w?: Vec3;
}

export type Termination =
  | 'maxBounces'
  | 'maxTime'
  | 'restingOnFloor'
  | 'exitedCourt';

export interface Trajectory {
  /** Muestreado a paso fijo para dibujar. */
  samples: Sample[];
  bounces: Bounce[];
  totalTime: number;
  terminated: Termination;
  /** Que motor la produjo. Las vistas lo usan para etiquetar. */
  model: PhysicsModel;
}

export type PhysicsModel = 'geometric' | 'ballistic';

export interface SimOptions {
  model?: PhysicsModel;
  maxBounces?: number;
  maxTime?: number;
  /** Paso de integracion del motor balistico. */
  physicsDt?: number;
  /** Paso de muestreo para dibujar. */
  sampleDt?: number;
  /** COR normal por superficie. Sobrescribe el valor global. */
  surfaceRestitution?: Partial<Record<SurfaceId, number>>;
  /**
   * Friccion de deslizamiento mu por superficie (sitio de juego). Con ella
   * el motor calcula el efecto en cada contacto: agarre o deslizamiento.
   */
  surfaceFriction?: Partial<Record<SurfaceId, number>>;
  /** E efectivo de la pelota (Pa), para el criterio del nick. */
  ballStiffness?: number;
  /**
   * Cuanto COR se pierde por cada m/s de velocidad normal por encima de la
   * de la prueba de homologacion (fraccion por m/s). Sin ella, 0.92 %.
   * 0 = COR constante, como antes.
   */
  corSpeedLoss?: number;
  /**
   * Motor de antes, sin efecto: la velocidad paralela se multiplica por una
   * restitucion tangencial fija y la pelota no gira. Solo para comparar.
   */
  disableSpin?: boolean;
  /** Restitucion tangencial del motor sin efecto, para todas las superficies. */
  tangentialRestitution?: number;
  /**
   * Restitucion tangencial por superficie del motor sin efecto. Gana a
   * `tangentialRestitution`.
   */
  surfaceTangential?: Partial<Record<SurfaceId, number>>;
  /**
   * Constante de arrastre k (1/m), a = -k|v|v. Depende del aire del sitio
   * de juego (src/core/atmosphere.ts). Sin ella, la de nivel del mar y 20 C.
   */
  dragK?: number;
  /** Desactivar el arrastre (solo para tests de validacion del COR). */
  disableDrag?: boolean;
  /** Desactivar la gravedad (solo para tests). */
  disableGravity?: boolean;
  /**
   * Parar en cuanto la pelota haya dado este numero de botes de PISO. La
   * usa el solver: para saber donde cae el 2.º bote no hace falta simular
   * lo que pasa despues. Termina como 'maxBounces', que es lo que es: un
   * limite de botes.
   */
  stopAfterFloorBounces?: number;
}

/** Lo que el sitio de juego le pasa al motor (src/core/venue.ts). */
export type VenuePhysics = Pick<
  SimOptions,
  'dragK' | 'surfaceRestitution' | 'surfaceFriction' | 'ballStiffness' | 'corSpeedLoss'
>;
