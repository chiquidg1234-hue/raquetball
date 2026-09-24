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
import { splitByBounce, stateAt } from '../core/trajectory-utils.js';
import type { Sample, Trajectory, Vec3 } from '../core/types.js';
import { length } from '../core/vec3.js';
import { PALETTE } from './palette.js';

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

const makeNumberSprite = (n: number): THREE.Sprite => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = '#090d13';
  ctx.fill();
  ctx.lineWidth = size * 0.06;
  ctx.strokeStyle = '#4dd4ac';
  ctx.stroke();

  ctx.fillStyle = '#e8edf4';
  ctx.font = `600 ${size * 0.42}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), size / 2, size / 2 + size * 0.02);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.scale.setScalar(0.42);
  sprite.renderOrder = 10;
  return sprite;
};

/** Tubo de un tramo, con color por vertice segun la velocidad. */
const buildSegmentTube = (
  samples: Sample[],
  ghost: boolean,
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
    new THREE.MeshBasicMaterial({ vertexColors: true }),
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
  private readonly ball: THREE.Mesh;
  private readonly originMarker: THREE.Group;
  private readonly aimMarker: THREE.Group;

  private trajectory: Trajectory | null = null;

  constructor() {
    this.group.name = 'trajectory';
    this.group.add(this.gGhosts, this.gPath, this.gMarkers);

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

    for (const segment of splitByBounce(trajectory)) {
      const tube = buildSegmentTube(segment, false);
      if (tube) this.gPath.add(tube);
    }

    const dot = new THREE.SphereGeometry(0.055, 14, 10);
    for (const bounce of trajectory.bounces) {
      const marker = new THREE.Mesh(
        dot.clone(),
        new THREE.MeshBasicMaterial({ color: PALETTE.bounce }),
      );
      marker.position.set(bounce.point.x, bounce.point.y, bounce.point.z);
      this.gMarkers.add(marker);

      const sprite = makeNumberSprite(bounce.index);
      sprite.position.set(
        bounce.point.x,
        bounce.point.y + 0.3,
        bounce.point.z,
      );
      this.gMarkers.add(sprite);
    }
    dot.dispose();
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

  setPlayhead(t: number | null): void {
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
