/**
 * FASE 2 — Escena, camara y controles.
 *
 * La camara por defecto es "detras del jugador y arriba", que es como el
 * jugador ve de verdad la cancha; el resto de presets existen para leer un
 * angulo concreto sin tener que orbitar a mano.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { COURT } from '../core/constants.js';
import { buildCourt, type CourtMeshes } from './courtMesh.js';
import { PALETTE } from './palette.js';
import { TrajectoryLayer } from './trajectoryMesh.js';
import { RacquetLayer } from './racquet.js';
import type { Vec3 } from '../core/types.js';

const W = COURT.width;
const L = COURT.length;

export type CameraPresetId = 'behind' | 'overhead' | 'side' | 'corner';

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    id: 'behind',
    label: 'Detras',
    position: [W / 2, 6.4, L + 10.5],
    target: [W / 2, 1.9, 4.2],
  },
  {
    id: 'overhead',
    label: 'Cenital',
    position: [W / 2, 17.5, L / 2 + 0.01],
    target: [W / 2, 0, L / 2],
  },
  {
    id: 'side',
    label: 'Lateral',
    position: [W + 16.5, 5.6, L / 2],
    target: [W / 2, 2.1, L / 2],
  },
  {
    id: 'corner',
    label: 'Esquina',
    position: [W + 9, 9.6, L + 8.5],
    target: [W / 2, 1.6, 4.8],
  },
] as const;

export class Scene3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly court: CourtMeshes;
  readonly trajectory = new TrajectoryLayer();
  readonly racquet = new RacquetLayer();

  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private needsRender = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene.background = new THREE.Color(PALETTE.background);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      // Necesario para poder exportar el lienzo a PNG: sin esto,
      // toDataURL devuelve una imagen en blanco fuera del frame del
      // render.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 70;
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });

    this.court = buildCourt();
    this.scene.add(this.court.group);
    this.scene.add(this.trajectory.group);
    this.scene.add(this.racquet.group);

    // Materiales basicos: el color del tubo es el dato, no hay que
    // dejar que una luz lo lave. Una ambiental basta para las esferas.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    this.applyCameraPreset('behind');

    this.resizeObserver = new ResizeObserver(() => this.resize());
    const host = canvas.parentElement ?? canvas;
    this.resizeObserver.observe(host);
    this.resize();
  }

  applyCameraPreset(id: CameraPresetId): void {
    const preset = CAMERA_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.target);
    this.controls.update();
    this.needsRender = true;
  }

  /**
   * Camara "Golpe": de cerca, detras de la pelota y hacia el lado contrario
   * al cuerpo, para ver a la vez el cordaje, la mano y los pies.
   */
  frameContact(contact: Vec3, direction: Vec3, handleDir: Vec3): void {
    const flatLen = Math.hypot(direction.x, direction.z) || 1;
    const fx = direction.x / flatLen;
    const fz = direction.z / flatLen;
    this.camera.position.set(
      contact.x - fx * 1.7 - handleDir.x * 1.2,
      contact.y + 1.05,
      contact.z - fz * 1.7 - handleDir.z * 1.2,
    );
    this.controls.target.set(
      contact.x + handleDir.x * 0.3,
      Math.max(0.2, contact.y - 0.25),
      contact.z + handleDir.z * 0.3,
    );
    this.controls.update();
    this.needsRender = true;
  }

  resize(): void {
    const host = this.canvas.parentElement;
    const width = Math.max(1, host?.clientWidth ?? this.canvas.clientWidth);
    const height = Math.max(1, host?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  invalidate(): void {
    this.needsRender = true;
  }

  /** Llamado desde el rAF de la app. Solo dibuja si algo cambio. */
  render(): void {
    const moved = this.controls.update();
    if (!moved && !this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.trajectory.dispose();
    this.racquet.dispose();
    this.renderer.dispose();
  }
}
