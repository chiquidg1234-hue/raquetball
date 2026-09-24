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
