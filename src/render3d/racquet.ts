/**
 * Mano y raqueta en 3D, enganchadas al golpe.
 *
 * No es un modelo escaneado: es lo justo para que se entienda el gesto.
 * Marco ovalado, cordaje, mango, una mano que lo agarra y el antebrazo en
 * linea con la raqueta (como piden las guias en el contacto). En el
 * cordaje, un anillo marca DONDE toca la pelota; en el piso, las huellas
 * de los pies ensenan a que altura del pie adelantado va el contacto.
 *
 * Toda la geometria sale de src/core/stroke.ts, que esta testeada; aqui
 * solo se viste.
 */

import * as THREE from 'three';

import {
  RACQUET,
  STANCE,
  strokeGeometry,
  type FootPrint,
  type Handedness,
  type Stroke,
} from '../core/stroke.js';
import type { Vec3 } from '../core/types.js';

const COLORS = {
  frame: 0xd8dee8,
  strings: 0x9fb3c8,
  grip: 0x2a2f38,
  skin: 0xd6a57f,
  contact: 0x4dd4ac,
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

/** Luz propia para que la mano tenga volumen sin tocar la escena. */
const shaded = (color: number): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color });

/**
 * La raqueta en su sistema local: cabeza centrada en el origen, cara en el
 * plano XY (normal +Z) y el mango hacia -Y.
 */
const buildRacquet = (): THREE.Group => {
  const g = new THREE.Group();
  const a = RACQUET.headWidth / 2;
  const b = RACQUET.headLength / 2;

  // Marco: un tubo que sigue la elipse de la cabeza.
  const ellipse = new THREE.EllipseCurve(0, 0, a, b, 0, Math.PI * 2, false, 0);
  const pts = ellipse.getPoints(72).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const frame = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.009, 8, true),
    shaded(COLORS.frame),
  );
  g.add(frame);

  // Cordaje: velo translucido y una rejilla recortada a la elipse.
  const bed = new THREE.Mesh(new THREE.CircleGeometry(1, 48), basic(COLORS.strings, 0.12));
  bed.scale.set(a * 0.97, b * 0.97, 1);
  g.add(bed);
  const lines: number[] = [];
  const spacing = 0.021;
  for (let x = -a + spacing; x < a; x += spacing) {
    const h = b * Math.sqrt(Math.max(0, 1 - (x * x) / (a * a))) * 0.97;
    lines.push(x, -h, 0, x, h, 0);
  }
  for (let y = -b + spacing; y < b; y += spacing) {
    const w = a * Math.sqrt(Math.max(0, 1 - (y * y) / (b * b))) * 0.97;
    lines.push(-w, y, 0, w, y, 0);
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  g.add(
    new THREE.LineSegments(
      grid,
      new THREE.LineBasicMaterial({ color: COLORS.strings, transparent: true, opacity: 0.55 }),
    ),
  );

  // Garganta en V, cuello y empunadura.
  const handleLength = RACQUET.length - RACQUET.headLength;
  const neckLength = handleLength * 0.3;
  const throatY = -b;
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(side * a * 0.55, throatY + b * 0.18, 0);
    const to = new THREE.Vector3(0, throatY - neckLength, 0);
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, from.distanceTo(to), 8),
      shaded(COLORS.frame),
    );
    bar.position.copy(from).add(to).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    g.add(bar);
  }
  const gripLength = handleLength - neckLength;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.016, gripLength, 12),
    shaded(COLORS.grip),
  );
  grip.position.y = throatY - neckLength - gripLength / 2;
  g.add(grip);

  // Donde tiene que tocar la pelota: el centro del cordaje.
  // Mas ancho que la esfera del contacto (5 cm) para que asome alrededor.
  const contact = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.07, 40), basic(COLORS.contact));
  contact.position.z = 0.001;
  contact.name = 'contact-ring';
  g.add(contact);

  return g;
};

/**
 * La mano, tambien en local: sobre la empunadura. `palmSide` = +1 si la
 * palma empuja hacia donde va la pelota (derecha), -1 si van los nudillos
 * delante (reves).
 */
const buildHand = (palmSide: 1 | -1): THREE.Group => {
  const g = new THREE.Group();
  const handleLength = RACQUET.length - RACQUET.headLength;
  const y = -RACQUET.headLength / 2 - handleLength * 0.62;
  const skin = shaded(COLORS.skin);

  // Palma detras (o delante) del mango.
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.03), skin);
  palm.position.set(0, y, -palmSide * 0.03);
  g.add(palm);

  // Cuatro dedos que rodean el mango.
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(
      new THREE.TorusGeometry(0.024, 0.0085, 8, 16, Math.PI * 1.25),
      skin,
    );
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
  const forearm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.036, forearmLength, 14),
    skin,
  );
  forearm.position.set(0, y - 0.07 - forearmLength / 2, -palmSide * 0.012);
  g.add(forearm);

  return g;
};

/** Huella de un pie en el piso, orientada del talon a la punta. */
const buildFoot = (foot: FootPrint, color: number, opacity: number): THREE.Mesh => {
  const shape = new THREE.Mesh(new THREE.CircleGeometry(1, 32), basic(color, opacity));
  shape.scale.set(STANCE.footWidth / 2, STANCE.footLength / 2, 1);
  shape.rotation.x = -Math.PI / 2;
  // En el piso el eje Y local de la huella apunta del talon a la punta.
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

export class RacquetLayer {
  readonly group = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly floor = new THREE.Group();
  private readonly light = new THREE.DirectionalLight(0xffffff, 0.7);
  private builtFor = '';

  constructor() {
    this.group.name = 'racquet';
    this.group.add(this.model, this.floor, this.light, this.light.target);
    this.group.visible = false;
  }

  /**
   * Coloca mano, raqueta y pies para un golpe desde `contact` hacia
   * `direction`. Se llama cada vez que cambia el tiro: por eso se mueve
   * con los sliders.
   */
  setPose(
    contact: Vec3 | null,
    direction: Vec3 | null,
    stroke: Stroke | null,
    hand: Handedness,
  ): void {
    this.group.visible = !!(contact && direction && stroke);
    if (!contact || !direction || !stroke) return;
    const g = strokeGeometry(contact, direction, stroke, hand);

    // La raqueta y la mano solo se reconstruyen si cambia el golpe; lo
    // demas es mover y girar.
    const key = `${stroke}:${hand}`;
    if (key !== this.builtFor) {
      disposeTree(this.model);
      this.model.add(buildRacquet(), buildHand(stroke === 'forehand' ? 1 : -1));
      this.builtFor = key;
    }

    // Base local -> mundo: Z = normal de la cara, Y = de la cabeza hacia
    // la punta (lo contrario del mango), X = Y x Z.
    const z = vec(g.faceNormal);
    const y = vec(g.handleDir).multiplyScalar(-1);
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    this.model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.model.position.copy(vec(g.stringsCenter));

    this.light.position.copy(vec(contact)).add(new THREE.Vector3(1.5, 3, 2.5));
    this.light.target.position.copy(vec(contact));

    // Piso: huellas, la vertical del contacto y la linea que une la pelota
    // con el talon (derecha) o con la punta (reves) del pie adelantado.
    disposeTree(this.floor);
    this.floor.add(buildFoot(g.frontFoot, COLORS.footFront, 0.75));
    this.floor.add(buildFoot(g.backFoot, COLORS.footBack, 0.45));
    const ballOnFloor = new THREE.Vector3(contact.x, 0.012, contact.z);
    this.floor.add(dashed(vec(contact), ballOnFloor, COLORS.guide));
    const mark = stroke === 'forehand' ? g.frontFoot.heel : g.frontFoot.toe;
    this.floor.add(dashed(ballOnFloor, new THREE.Vector3(mark.x, 0.012, mark.z), COLORS.contact));
  }

  dispose(): void {
    disposeTree(this.group);
  }
}
