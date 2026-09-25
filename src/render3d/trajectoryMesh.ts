/**
 * FASE 2 — La trayectoria en 3D.
 *
 * Un tubo por tramo entre rebotes, no uno solo para toda la trayectoria:
 * una CatmullRom que atravesara los rebotes redondearia justo las esquinas
 * que son el objeto de estudio.
 *
 * El color va por velocidad en una escala ABSOLUTA (0 a 90 m/s), no
 * relativa a cada tiro: asi "calido = rapido" significa lo mismo de un
 * tiro a otro y se puede comparar un drive con un peloteo de un vistazo.
 */

import * as THREE from 'three';

import { BALL, SPEED } from '../core/constants.js';
import {
  floorCountPerSegment,
  isSkip,
  labelContacts,
  segmentOpacity,
  type Contact,
} from '../core/contacts.js';
import { splitByBounce, stateAt } from '../core/trajectory-utils.js';
import type { Sample, Trajectory, Vec3 } from '../core/types.js';
import { length } from '../core/vec3.js';
import { PALETTE } from './palette.js';
import type { Toss } from '../core/serveToss.js';

const TUBE_RADIUS = 0.025;
const RADIAL_SEGMENTS = 8;

const toVector3 = (p: Vec3): THREE.Vector3 =>
  new THREE.Vector3(p.x, p.y, p.z);

/**
 * Rampa de velocidad con cuatro paradas. Una interpolacion directa de azul
 * a naranja pasa por un gris desaturado justo en la mitad del rango util,
 * que es donde viven casi todos los tiros: con paradas intermedias el color
 * se mantiene saturado y la lectura es continua.
 */
const RAMP: readonly { at: number; color: THREE.Color }[] = [
  { at: 0.0, color: new THREE.Color(0x3aa0ff) }, // parado / muy lento
  { at: 0.33, color: new THREE.Color(0x4dd4ac) }, // peloteo
  { at: 0.62, color: new THREE.Color(0xf5d14e) }, // drive
  { at: 1.0, color: new THREE.Color(0xff6b3d) }, // saque de profesional
];

/** Escala ABSOLUTA de velocidad -> color: 0 a SPEED.max m/s. */
export const speedColor = (
  speed: number,
  target = new THREE.Color(),
): THREE.Color => {
  const k = Math.min(1, Math.max(0, speed / SPEED.max));
  for (let i = 1; i < RAMP.length; i++) {
    const a = RAMP[i - 1]!;
    const b = RAMP[i]!;
    if (k <= b.at) {
      const span = b.at - a.at;
      return target.copy(a.color).lerp(b.color, span > 0 ? (k - a.at) / span : 0);
    }
  }
  return target.copy(RAMP[RAMP.length - 1]!.color);
};

type ContactStyle = 'floor' | 'wall' | 'skip' | 'toss';

/**
 * Marcador flotante de un contacto. Dos familias que no se confunden:
 * el bote de PISO es un circulo dorado con su numero; el rebote de PARED
 * es un rombo oscuro con la inicial de la pared. El skip, en rojo.
 */
const makeContactSprite = (label: string, style: ContactStyle): THREE.Sprite => {
  const size = 128;
  // El rotulo del bote de saque es texto, no un numero: lienzo apaisado.
  const wide = style === 'toss' ? 3 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = size * wide;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const cx = (size * wide) / 2;

  if (style === 'wall') {
    const h = size * 0.34;
    ctx.beginPath();
    ctx.moveTo(c, c - h);
    ctx.lineTo(c + h, c);
    ctx.lineTo(c, c + h);
    ctx.lineTo(c - h, c);
    ctx.closePath();
    ctx.fillStyle = '#090d13';
    ctx.fill();
    ctx.lineWidth = size * 0.055;
    ctx.strokeStyle = '#8ea5be';
    ctx.stroke();
    ctx.fillStyle = '#8ea5be';
  } else if (style === 'toss') {
    // El bote de saque: un cuadrado violeta, ni circulo de piso ni rombo
    // de pared. Lleva texto, no numero: no cuenta como bote del tiro.
    ctx.fillStyle = '#1a1326';
    ctx.strokeStyle = '#b58cff';
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    ctx.roundRect(size * 0.08, size * 0.22, size * wide - size * 0.16, size * 0.56, size * 0.12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9c6ff';
  } else {
    ctx.beginPath();
    ctx.arc(c, c, size * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = style === 'skip' ? '#ef5f5f' : '#ffc94d';
    ctx.fill();
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = '#090d13';
    ctx.stroke();
    ctx.fillStyle = style === 'skip' ? '#ffffff' : '#1c1405';
  }

  const fontSize =
    style === 'toss' ? size * 0.3 : label.length > 2 ? size * 0.24 : size * 0.44;
  ctx.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, c + size * 0.02, size * wide - size * 0.3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
      opacity: 1,
    }),
  );
  const scale = style === 'floor' || style === 'skip' ? 0.46 : style === 'toss' ? 0.3 : 0.3;
  sprite.scale.set(scale * wide, scale, 1);
  sprite.renderOrder = style === 'wall' ? 9 : 10;
  return sprite;
};

/** Marca de impacto en el piso: un anillo plano donde bota la pelota. */
const makeFloorImpact = (color: number, radius: number, opacity: number): THREE.Mesh => {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.55, radius, 36),
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 4;
  return ring;
};

/** Tubo de un tramo, con color por vertice segun la velocidad. */
const buildSegmentTube = (
  samples: Sample[],
  ghost: boolean,
  opacity = 1,
): THREE.Mesh | null => {
  if (samples.length < 2) return null;

  const points = samples.map((s) => toVector3(s.p));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const tubular = Math.max(1, Math.min(samples.length - 1, 600));
  const geometry = new THREE.TubeGeometry(
    curve,
    tubular,
    ghost ? TUBE_RADIUS * 0.5 : TUBE_RADIUS,
    RADIAL_SEGMENTS,
    false,
  );

  if (ghost) {
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: PALETTE.ghost,
        transparent: true,
        opacity: 0.35,
      }),
    );
  }

  // TubeGeometry ordena los vertices por anillo: el vertice i pertenece al
  // anillo floor(i / (RADIAL_SEGMENTS + 1)).
  const ringSize = RADIAL_SEGMENTS + 1;
  const vertexCount = geometry.attributes.position!.count;
  const colors = new Float32Array(vertexCount * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < vertexCount; i++) {
    const ring = Math.floor(i / ringSize);
    const u = tubular === 0 ? 0 : ring / tubular;
    const idx = Math.min(samples.length - 1, Math.round(u * (samples.length - 1)));
    speedColor(length(samples[idx]!.v), tmp);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    }),
  );
};

const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) {
      const withMap = mat as THREE.Material & { map?: THREE.Texture | null };
      withMap.map?.dispose?.();
      mat.dispose();
    }
  });
  root.clear();
};

export class TrajectoryLayer {
  readonly group = new THREE.Group();

  private readonly gPath = new THREE.Group();
  private readonly gGhosts = new THREE.Group();
  private readonly gMarkers = new THREE.Group();
  private readonly gToss = new THREE.Group();
  private readonly ball: THREE.Mesh;
  private toss: Toss | null = null;
  private readonly originMarker: THREE.Group;
  private readonly aimMarker: THREE.Group;

  private trajectory: Trajectory | null = null;

  constructor() {
    this.group.name = 'trajectory';
    this.group.add(this.gGhosts, this.gPath, this.gMarkers, this.gToss);

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius * 1.6, 20, 14),
      new THREE.MeshBasicMaterial({ color: PALETTE.ball }),
    );
    this.ball.renderOrder = 6;
    this.ball.visible = false;
    this.group.add(this.ball);

    this.originMarker = buildOriginMarker();
    this.originMarker.visible = false;
    this.group.add(this.originMarker);

    this.aimMarker = buildAimMarker();
    this.aimMarker.visible = false;
    this.group.add(this.aimMarker);
  }

  setTrajectory(trajectory: Trajectory | null): void {
    this.trajectory = trajectory;
    disposeTree(this.gPath);
    disposeTree(this.gMarkers);
    if (!trajectory) return;

    // El tubo se atenua por BOTES DE PISO, no por contactos: hasta el
    // primer bote va entero. Tras un skip, lo que sigue casi no se ve.
    const floors = floorCountPerSegment(trajectory);
    const skip = isSkip(trajectory);
    splitByBounce(trajectory).forEach((segment, i) => {
      const opacity = segmentOpacity(floors[i] ?? 0, skip && i >= 1);
      const tube = buildSegmentTube(segment, false, opacity);
      if (tube) this.gPath.add(tube);
    });

    for (const contact of labelContacts(trajectory)) {
      this.addContactMarker(contact);
    }
  }

  private addContactMarker(c: Contact): void {
    const { x, y, z } = c.bounce.point;

    if (c.kind === 'wall') {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x8ea5be }),
      );
      dot.position.set(x, y, z);
      this.gMarkers.add(dot);

      const sprite = makeContactSprite(c.label, 'wall');
      sprite.position.set(x, y + 0.22, z);
      this.gMarkers.add(sprite);
      return;
    }

    // Bote de piso: marca de impacto en el suelo y su numero encima.
    const style: ContactStyle = c.skip ? 'skip' : 'floor';
    const color = c.skip ? 0xef5f5f : 0xffc94d;
    const impact = makeFloorImpact(
      color,
      c.skip ? 0.26 : c.primary ? 0.2 : 0.11,
      c.primary || c.skip ? 0.95 : 0.5,
    );
    impact.position.set(x, 0.006, z);
    this.gMarkers.add(impact);

    // Del 4.º bote en adelante, solo la marca en el suelo: sus numeros se
    // amontonan donde la pelota se muere y tapan lo que importa.
    if (!c.primary && !c.skip) return;
    const sprite = makeContactSprite(c.skip ? 'PISO' : c.label, style);
    sprite.position.set(x, y + 0.36, z);
    this.gMarkers.add(sprite);
  }

  setGhosts(list: readonly Trajectory[]): void {
    disposeTree(this.gGhosts);
    for (const ghost of list) {
      for (const segment of splitByBounce(ghost)) {
        const tube = buildSegmentTube(segment, true);
        if (tube) this.gGhosts.add(tube);
      }
    }
  }

  /**
   * El bote con la mano del saque, aparte del tiro: tubo fino violeta de la
   * mano al piso y del piso al golpe, y en el piso un cuadrado con
   * "bote de saque". No lleva numero: los botes del tiro empiezan despues.
   */
  setToss(toss: Toss | null): void {
    this.toss = toss;
    disposeTree(this.gToss);
    if (!toss) return;
    const color = toss.fault ? 0xef5f5f : 0xb58cff;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const bounceT = toss.bounce.time;
    for (const part of [
      toss.path.samples.filter((sm) => sm.t <= bounceT + 1e-9),
      toss.path.samples.filter((sm) => sm.t >= bounceT - 1e-9),
    ]) {
      if (part.length < 2) continue;
      const pts = part.map((sm) => new THREE.Vector3(sm.p.x, sm.p.y, sm.p.z));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 6, false),
        material.clone(),
      );
      tube.renderOrder = 5;
      this.gToss.add(tube);
    }

    const square = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.17, 4),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    square.rotation.x = -Math.PI / 2;
    square.rotation.z = Math.PI / 4;
    square.position.set(toss.bounce.point.x, 0.007, toss.bounce.point.z);
    square.renderOrder = 4;
    this.gToss.add(square);

    const label =
      toss.fault === 'double-bounce'
        ? 'saque: 2 botes'
        : toss.fault === 'toss-outside'
          ? 'saque: fuera'
          : 'bote de saque';
    const sprite = makeContactSprite(label, 'toss');
    // Al lado, no encima: encima esta la mano y, en el golpe, la raqueta.
    sprite.position.set(toss.bounce.point.x + 0.62, 0.16, toss.bounce.point.z);
    this.gToss.add(sprite);
  }

  setPlayhead(t: number | null): void {
    if (t != null && t < 0 && this.toss) {
      const st = stateAt(this.toss.path, this.toss.duration + t);
      this.ball.visible = !!st;
      if (st) this.ball.position.set(st.p.x, st.p.y, st.p.z);
      return;
    }
    if (t == null || !this.trajectory) {
      this.ball.visible = false;
      return;
    }
    const st = stateAt(this.trajectory, t);
    if (!st) {
      this.ball.visible = false;
      return;
    }
    this.ball.visible = true;
    this.ball.position.set(st.p.x, st.p.y, st.p.z);
  }

  setOrigin(p: Vec3 | null): void {
    this.originMarker.visible = p != null;
    if (p) this.originMarker.position.set(p.x, 0, p.z);
    if (p) {
      const contact = this.originMarker.getObjectByName('contact');
      if (contact) contact.position.y = p.y;
    }
  }

  setAim(p: Vec3 | null): void {
    this.aimMarker.visible = p != null;
    if (p) this.aimMarker.position.set(p.x, p.y, p.z + 0.015);
  }

  dispose(): void {
    disposeTree(this.group);
  }
}

const buildOriginMarker = (): THREE.Group => {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 32),
    new THREE.MeshBasicMaterial({
      color: PALETTE.player,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.014;
  group.add(ring);

  const contact = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 12),
    new THREE.MeshBasicMaterial({ color: PALETTE.player }),
  );
  contact.name = 'contact';
  group.add(contact);

  return group;
};

const buildAimMarker = (): THREE.Group => {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.11, 0.16, 28),
    new THREE.MeshBasicMaterial({
      color: PALETTE.aim,
      side: THREE.DoubleSide,
    }),
  );
  group.add(ring);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 18),
    new THREE.MeshBasicMaterial({ color: PALETTE.aim, side: THREE.DoubleSide }),
  );
  group.add(dot);
  return group;
};
