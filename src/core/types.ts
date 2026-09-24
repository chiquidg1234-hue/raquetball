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
  /** rad/s — ignorado hasta la fase 13. */
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
}

export interface Sample {
  t: number;
  p: Vec3;
  v: Vec3;
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
  /** Restitucion tangencial. */
  tangentialRestitution?: number;
  /** Desactivar el arrastre (solo para tests de validacion del COR). */
  disableDrag?: boolean;
  /** Desactivar la gravedad (solo para tests). */
  disableGravity?: boolean;
}
