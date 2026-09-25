/**
 * La raqueta en 3D: la Gearbox AXS 170 Teardrop, con la mano, los pies y
 * el golpe animado.
 *
 * La forma sale de src/core/racquet.ts: el largo y el area encordada son
 * los publicados; la lagrima, modelada. En el cordaje se ven tres marcas:
 *   - verde: el centro de percusion, donde el golpe no da tiron a la mano;
 *   - naranja: el punto de mas salida con un golpe de muneca;
 *   - el anillo grande: donde toca la pelota ahora (el punto elegido).
 *
 * El golpe se anima con la linea de tiempo: antes del contacto (t < 0) la
 * raqueta viene de atras girando alrededor del hombro, en el contacto la
 * cara mira hacia donde sale la pelota, y despues acompana. Con corte baja
 * de arriba abajo; con liftado, al reves.
 *
 * Toda la geometria sale de modulos testeados (stroke.ts, racquet.ts):
 * aqui solo se viste y se mueve.
 */

import * as THREE from 'three';

import { AXS_MODEL, COP_HAND, PIVOTS, headOutline, powerPoint, stringHalfWidth } from '../core/racquet.js';
import {
  RACQUET,
  STANCE,
  SWING,
  strokeGeometry,
  type FootPrint,
  type Handedness,
  type Stroke,
  type StrokeOptions,
} from '../core/stroke.js';
import type { Vec3 } from '../core/types.js';

const COLORS = {
  frame: 0x2f5bd3,
  frameAccent: 0x9b6bff,
  strings: 0xdfe8f5,
  grip: 0x1d2027,
  skin: 0xd6a57f,
  contact: 0xffffff,
  cop: 0x4dd4ac,
  power: 0xff9f43,
  footFront: 0x58a6ff,
  footBack: 0x3b5a80,
  guide: 0x93a1b3,
} as const;

const vec = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

const basic = (color: number, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });

/** Luz propia para que la mano y el marco tengan volumen sin tocar la escena. */
const shaded = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

/**
 * La raqueta en su sistema local: el punto de impacto en el origen, la
 * cara en el plano XY (normal +Z), la cabeza hacia +Y y el mango hacia -Y.
 * `hitS` es a que distancia del final del mango esta ese punto.
 */
const buildRacquet = (hitS: number): THREE.Group => {
  const g = new THREE.Group();
  const y = (s: number): number => s - hitS;

  // Marco: un tubo por el contorno de la lagrima, con el marco a mitad.
  const outline = headOutline(AXS_MODEL.frame / 2, 120).map((p) => new THREE.Vector3(p.u, y(p.s), 0));
  const frame = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 240, 0.0075, 8, true),
    shaded(COLORS.frame),
  );
  g.add(frame);

  // Cordaje: velo translucido con la forma exacta y la rejilla recortada.
  const inner = headOutline(0, 120);
  const shape = new THREE.Shape(inner.map((p) => new THREE.Vector2(p.u, y(p.s))));
  g.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), basic(COLORS.strings, 0.1)));
  const lines: number[] = [];
  const top = RACQUET.length - AXS_MODEL.frame;
  // Principales (a lo largo) cada 1.8 cm, cruzadas cada 1.9 cm.
  for (let u = -0.12; u <= 0.12 + 1e-9; u += 0.018) {
    let s0: number | null = null;
    for (let s = AXS_MODEL.throat; s <= top; s += 0.002) {
      const inside = stringHalfWidth(s) * 0.97 > Math.abs(u);
      if (inside && s0 == null) s0 = s;
      if ((!inside || s + 0.002 > top) && s0 != null) {
        lines.push(u, y(s0), 0, u, y(s), 0);
        s0 = null;
      }
    }
  }
  for (let s = AXS_MODEL.throat + 0.012; s < top - 0.004; s += 0.019) {
    const w = stringHalfWidth(s) * 0.97;
    if (w > 0.004) lines.push(-w, y(s), 0, w, y(s), 0);
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  g.add(
    new THREE.LineSegments(
      grid,
      new THREE.LineBasicMaterial({ color: COLORS.strings, transparent: true, opacity: 0.6 }),
    ),
  );

  // Mango: del final a la garganta, con el tope un poco mas grueso.
  const gripLength = AXS_MODEL.throat;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0145, gripLength, 10), shaded(COLORS.grip));
  grip.position.y = y(gripLength / 2);
  g.add(grip);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 12), shaded(COLORS.frameAccent));
  cap.position.y = y(0.006);
  g.add(cap);

  // Las marcas del cordaje, un pelo por delante de la cara.
  const mark = (s: number, inner: number, outer: number, color: number, name: string): void => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 36), basic(color, 0.95));
    ring.position.set(0, y(s), 0.002);
    ring.name = name;
    g.add(ring);
  };
  mark(COP_HAND, 0.0, 0.011, COLORS.cop, 'cop');
  mark(powerPoint(PIVOTS.wrist), 0.0, 0.008, COLORS.power, 'power-wrist');
  // Donde toca la pelota: mas ancho que la pelota (5.7 cm) para que asome.
  mark(hitS, 0.055, 0.064, COLORS.contact, 'contact-ring');

  return g;
};

/**
 * La mano, tambien en local: sobre el mango, a `AXS_MODEL.handAt` del
 * final. `palmSide` = +1 si la palma empuja hacia donde va la pelota
 * (derecha), -1 si van los nudillos delante (reves).
 */
const buildHand = (palmSide: 1 | -1, hitS: number): THREE.Group => {
  const g = new THREE.Group();
  const y = AXS_MODEL.handAt - hitS;
  const skin = shaded(COLORS.skin);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.03), skin);
  palm.position.set(0, y, -palmSide * 0.03);
  g.add(palm);

  // Cuatro dedos que rodean el mango.
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0085, 8, 16, Math.PI * 1.25), skin);
    finger.rotation.x = Math.PI / 2;
    finger.rotation.z = palmSide > 0 ? Math.PI * 0.62 : -Math.PI * 0.38;
    finger.position.set(0, y + 0.03 - i * 0.021, 0);
    g.add(finger);
  }

  // Pulgar, cruzando por el otro lado.
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.045, 4, 8), skin);
  thumb.position.set(0.018, y + 0.045, palmSide * 0.016);
  thumb.rotation.z = 0.5;
  g.add(thumb);

  // Antebrazo en linea con la raqueta, hacia el cuerpo.
  const forearmLength = 0.27;
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, forearmLength, 14), skin);
  forearm.position.set(0, y - 0.07 - forearmLength / 2, -palmSide * 0.012);
  g.add(forearm);

  return g;
};

/** Huella de un pie en el piso, orientada del talon a la punta. */
const buildFoot = (foot: FootPrint, color: number, opacity: number): THREE.Mesh => {
  const shape = new THREE.Mesh(new THREE.CircleGeometry(1, 32), basic(color, opacity));
  shape.scale.set(STANCE.footWidth / 2, STANCE.footLength / 2, 1);
  shape.rotation.x = -Math.PI / 2;
  const along = new THREE.Vector3(foot.toe.x - foot.heel.x, 0, foot.toe.z - foot.heel.z);
  shape.rotation.z = Math.atan2(along.x, -along.z) * -1;
  shape.position.set(foot.center.x, 0.009, foot.center.z);
  shape.renderOrder = 3;
  return shape;
};

const dashed = (a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Line => {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.05, gapSize: 0.04 }),
  );
  line.computeLineDistances();
  return line;
};

const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose?.();
  });
  root.clear();
};

/** Angulo del golpe (grados) en el instante t, con el contacto en t = 0. */
export const swingAngle = (t: number): number => {
  if (t <= -SWING.backTime) return -SWING.backDeg;
  if (t < 0) return -SWING.backDeg * (-t / SWING.backTime) ** 2;
  if (t < SWING.followTime) return SWING.followDeg * Math.sqrt(t / SWING.followTime);
  return SWING.followDeg;
};

export class RacquetLayer {
  readonly group = new THREE.Group();
  /** Lo que se mueve con el golpe: raqueta y mano. */
  private readonly swing = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly floor = new THREE.Group();
  private readonly light = new THREE.DirectionalLight(0xffffff, 0.7);
  private builtFor = '';
  /** Pose del contacto y el giro del golpe, para animar. */
  private pose: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    pivot: THREE.Vector3;
    sign: number;
    lift: number;
  } | null = null;

  constructor() {
    this.group.name = 'racquet';
    this.swing.add(this.model);
    this.group.add(this.swing, this.floor, this.light, this.light.target);
    this.group.visible = false;
  }

  /**
   * Coloca mano, raqueta y pies para un golpe desde `contact` hacia
   * `direction`. Se llama cada vez que cambia el tiro.
   */
  setPose(
    contact: Vec3 | null,
    direction: Vec3 | null,
    stroke: Stroke | null,
    hand: Handedness,
    opts: StrokeOptions = {},
  ): void {
    this.group.visible = !!(contact && direction && stroke);
    if (!contact || !direction || !stroke) {
      this.pose = null;
      return;
    }
    const g = strokeGeometry(contact, direction, stroke, hand, opts);

    // La raqueta y la mano solo se reconstruyen si cambia el golpe o el
    // punto de impacto; lo demas es mover y girar.
    const key = `${stroke}:${hand}:${g.hitS.toFixed(3)}`;
    if (key !== this.builtFor) {
      disposeTree(this.model);
      this.model.add(buildRacquet(g.hitS), buildHand(stroke === 'forehand' ? 1 : -1, g.hitS));
      this.builtFor = key;
    }

    // Base local -> mundo: Z = normal de la cara, Y = hacia la punta (lo
    // contrario del mango), X = Y x Z.
    const z = vec(g.faceNormal);
    const y = vec(g.handleDir).multiplyScalar(-1);
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const position = vec(g.hitPoint);

    // El golpe gira alrededor de un eje vertical en el hombro: la mano mas
    // un brazo hacia el cuerpo. El sentido es el que lleva la punta hacia
    // delante (hacia donde sale la pelota) al acercarse al contacto.
    const pivot = vec(g.hand).add(vec(g.handleDir).multiplyScalar(SWING.shoulder));
    pivot.y = g.hand.y;
    const toTip = vec(g.tip).sub(pivot);
    const forward = new THREE.Vector3(direction.x, 0, direction.z).normalize();
    const sign = Math.sign(new THREE.Vector3(0, 1, 0).cross(toTip).dot(forward)) || 1;
    // Corte: viene de arriba abajo; liftado: de abajo arriba (30 cm a 30°).
    const lift = ((opts.bevelDeg ?? 0) / 30) * 0.3;
    this.pose = { position, quaternion, pivot, sign, lift };
    this.setSwing(0);

    this.light.position.copy(vec(contact)).add(new THREE.Vector3(1.5, 3, 2.5));
    this.light.target.position.copy(vec(contact));

    // Piso: huellas, la vertical del contacto y la linea que une la pelota
    // con el talon (derecha) o con la punta (reves) del pie adelantado.
    disposeTree(this.floor);
    this.floor.add(buildFoot(g.frontFoot, COLORS.footFront, 0.75));
    this.floor.add(buildFoot(g.backFoot, COLORS.footBack, 0.45));
    const ballOnFloor = new THREE.Vector3(contact.x, 0.012, contact.z);
    this.floor.add(dashed(vec(contact), ballOnFloor, COLORS.guide));
    const markAt = stroke === 'forehand' ? g.frontFoot.heel : g.frontFoot.toe;
    this.floor.add(dashed(ballOnFloor, new THREE.Vector3(markAt.x, 0.012, markAt.z), COLORS.cop));
  }

  /**
   * El golpe en el instante t (s, contacto en 0): gira la raqueta y la mano
   * alrededor del hombro y las sube o baja si hay corte o liftado.
   */
  setSwing(t: number): void {
    const p = this.pose;
    if (!p) return;
    const angle = ((p.sign * swingAngle(t)) * Math.PI) / 180;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const rel = p.position.clone().sub(p.pivot).applyQuaternion(rot);
    const k = t < 0 ? Math.min(1, -t / SWING.backTime) : -Math.min(1, t / SWING.followTime) * 0.5;
    this.model.position.copy(p.pivot).add(rel).add(new THREE.Vector3(0, p.lift * k, 0));
    this.model.quaternion.copy(rot).multiply(p.quaternion);
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
