/**
 * FASE 5 — Raycast sobre la cancha 3D.
 *
 * Solo se pican dos superficies: el piso (para colocarse) y la pared
 * frontal (para apuntar). Las demas no tienen un significado util al
 * hacer clic y meterlas solo produciria clics accidentales.
 */

import * as THREE from 'three';

import { clampToCourt } from '../core/court.js';
import type { Vec3 } from '../core/types.js';
import type { Scene3D } from './scene.js';

export type PickedSurface = 'floor' | 'front';

export interface Pick {
  surface: PickedSurface;
  point: Vec3;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export const pickCourt = (
  scene: Scene3D,
  event: { clientX: number; clientY: number },
): Pick | null => {
  const canvas = scene.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(ndc, scene.camera);

  const targets = scene.court.pickTargets;
  const hits = raycaster.intersectObjects([targets.floor, targets.front], false);
  const hit = hits[0];
  if (!hit) return null;

  const surface: PickedSurface =
    hit.object === targets.front ? 'front' : 'floor';
  const p = hit.point;
  return { surface, point: clampToCourt({ x: p.x, y: p.y, z: p.z }) };
};

/**
 * Un bote de piso (1, 2 o 3) bajo el puntero, para arrastrarlo. Se prueban
 * su numero flotante y su marca en el suelo.
 */
export const pickFloorBounce = (
  scene: Scene3D,
  event: { clientX: number; clientY: number },
): number | null => {
  const canvas = scene.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, scene.camera);
  const hit = raycaster.intersectObjects(scene.trajectory.floorBounceTargets(), false)[0];
  const k = hit?.object.userData.floorBounce;
  return typeof k === 'number' ? k : null;
};

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const onFloor = new THREE.Vector3();

/**
 * Donde corta el rayo del puntero el PLANO del piso, aunque el puntero
 * este sobre una pared: al arrastrar un bote no se quiere saltar a la
 * pared que hay detras.
 */
export const pickFloorPlane = (
  scene: Scene3D,
  event: { clientX: number; clientY: number },
): Vec3 | null => {
  const canvas = scene.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, scene.camera);
  if (!raycaster.ray.intersectPlane(floorPlane, onFloor)) return null;
  return clampToCourt({ x: onFloor.x, y: 0, z: onFloor.z });
};
