/**
 * FASE 2 — La cancha en 3D.
 *
 * Frontal, laterales y techo semitransparentes (opacidad ~0.12) para poder
 * ver la trayectoria desde fuera. Piso opaco con las lineas reglamentarias
 * como geometria de lineas, no como textura: asi se leen igual a cualquier
 * distancia y no cuestan un atlas.
 *
 * La pared trasera se modela con su altura real de 12 ft, con el hueco de
 * arriba marcado en punteado. Que se vea el hueco es la mitad de la leccion.
 */

import * as THREE from 'three';

import { COURT, SERVICE_ZONE } from '../core/constants.js';
import { PALETTE } from './palette.js';

const W = COURT.width;
const H = COURT.height;
const L = COURT.length;
const LINE_Y = 0.012; // despegado del piso para no pelearse en el z-buffer

const wallMaterial = (color: number, opacity: number): THREE.Material =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

const addPlane = (
  group: THREE.Group,
  width: number,
  height: number,
  position: [number, number, number],
  rotation: [number, number, number],
  material: THREE.Material,
  name: string,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.name = name;
  group.add(mesh);
  return mesh;
};

const lineSegments = (
  points: number[],
  color: number,
  opacity = 1,
): THREE.LineSegments => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3),
  );
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
};

const dashedSegments = (
  points: number[],
  color: number,
  dashSize = 0.14,
  gapSize = 0.12,
): THREE.LineSegments => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3),
  );
  const line = new THREE.LineSegments(
    geometry,
    new THREE.LineDashedMaterial({ color, dashSize, gapSize }),
  );
  line.computeLineDistances();
  return line;
};

export interface CourtMeshes {
  group: THREE.Group;
  /** Superficies con las que puede interactuar el raycast (fase 5). */
  pickTargets: Record<'floor' | 'front', THREE.Mesh>;
  setWallOpacity(value: number): void;
}

export const buildCourt = (): CourtMeshes => {
  const group = new THREE.Group();
  group.name = 'court';

  const walls = wallMaterial(PALETTE.wall, 0.12);
  const backWall = wallMaterial(PALETTE.wallBack, 0.16);
  const floorMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.floor,
    side: THREE.DoubleSide,
  });

  const floor = addPlane(
    group,
    W,
    L,
    [W / 2, 0, L / 2],
    [-Math.PI / 2, 0, 0],
    floorMaterial,
    'floor',
  );
  addPlane(
    group,
    W,
    L,
    [W / 2, H, L / 2],
    [Math.PI / 2, 0, 0],
    walls,
    'ceiling',
  );
  const frontMaterial = wallMaterial(PALETTE.wall, 0.19);
  const front = addPlane(
    group,
    W,
    H,
    [W / 2, H / 2, 0],
    [0, 0, 0],
    frontMaterial,
    'front',
  );
  addPlane(
    group,
    W,
    COURT.backWallHeight,
    [W / 2, COURT.backWallHeight / 2, L],
    [0, Math.PI, 0],
    backWall,
    'back',
  );
  addPlane(group, L, H, [0, H / 2, L / 2], [0, Math.PI / 2, 0], walls, 'left');
  addPlane(group, L, H, [W, H / 2, L / 2], [0, -Math.PI / 2, 0], walls, 'right');

  // --- zona de saque, sombreada sobre el piso ---
  const zone = new THREE.Mesh(
    new THREE.PlaneGeometry(W, SERVICE_ZONE.depth),
    new THREE.MeshBasicMaterial({
      color: PALETTE.serviceZone,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  zone.rotation.x = -Math.PI / 2;
  zone.position.set(W / 2, LINE_Y * 0.5, (SERVICE_ZONE.zMin + SERVICE_ZONE.zMax) / 2);
  group.add(zone);

  // --- lineas reglamentarias del piso ---
  const solid: number[] = [];
  const pushFloorLine = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
  ): void => {
    solid.push(x1, LINE_Y, z1, x2, LINE_Y, z2);
  };

  pushFloorLine(0, COURT.serviceLine, W, COURT.serviceLine);
  pushFloorLine(0, COURT.shortLine, W, COURT.shortLine);
  for (const x of [
    COURT.driveServeLineOffset,
    W - COURT.driveServeLineOffset,
  ]) {
    pushFloorLine(x, SERVICE_ZONE.zMin, x, SERVICE_ZONE.zMax);
  }
  for (const x0 of [0, W - COURT.doublesBoxWidth]) {
    const x1 = x0 + COURT.doublesBoxWidth;
    pushFloorLine(x0, SERVICE_ZONE.zMin, x1, SERVICE_ZONE.zMin);
    pushFloorLine(x0, SERVICE_ZONE.zMax, x1, SERVICE_ZONE.zMax);
    pushFloorLine(x1, SERVICE_ZONE.zMin, x1, SERVICE_ZONE.zMax);
  }
  group.add(lineSegments(solid, PALETTE.line, 1));

  group.add(
    dashedSegments(
      [0, LINE_Y, COURT.receivingLine, W, LINE_Y, COURT.receivingLine],
      PALETTE.lineSoft,
    ),
  );

  // --- borde superior de la pared trasera y el hueco de aire de arriba ---
  const edgeY = COURT.backWallHeight;
  group.add(
    lineSegments([0, edgeY, L, W, edgeY, L], PALETTE.backWallEdge, 0.9),
  );
  group.add(
    dashedSegments(
      [
        0, edgeY, L, 0, H, L, //         montante izquierdo
        W, edgeY, L, W, H, L, //         montante derecho
        0, H, L, W, H, L, //             dintel
      ],
      PALETTE.backWallEdge,
      0.2,
      0.2,
    ),
  );

  // --- aristas de la caja, para que se lea el volumen ---
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, L)),
    new THREE.LineBasicMaterial({
      color: PALETTE.wall,
      transparent: true,
      opacity: 0.4,
    }),
  );
  box.position.set(W / 2, H / 2, L / 2);
  group.add(box);

  return {
    group,
    pickTargets: { floor, front },
    setWallOpacity(value: number) {
      (walls as THREE.MeshBasicMaterial).opacity = value;
      (frontMaterial as THREE.MeshBasicMaterial).opacity = Math.min(1, value * 1.6);
      (backWall as THREE.MeshBasicMaterial).opacity = Math.min(1, value * 1.35);
    },
  };
};
