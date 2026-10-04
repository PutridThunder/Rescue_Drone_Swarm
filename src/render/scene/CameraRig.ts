// The map camera: orbit/pan/zoom controls, an initial view framed to the map, and an optional
// follow mode that keeps a drone centred.

import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

const FOV = 38;
const FOLLOW_ZOOM = 45; // distance when starting to follow a drone
const FOLLOW_EASE = 4; // higher = snappier follow

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  private readonly delta = new THREE.Vector3();

  constructor(canvas: HTMLElement, mapWidth: number, mapHeight: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 2000);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minDistance = 8;
    this.controls.maxDistance = Math.max(mapWidth, mapHeight) * 1.7;
    this.controls.screenSpacePanning = false;

    // Start looking at the lower half of the map (usually the busiest part) from the south-west.
    const size = Math.max(mapWidth, mapHeight);
    this.controls.target.set(-mapWidth * 0.06, 0, mapHeight * 0.16);
    this.camera.position.set(-mapWidth * 0.08, size * 0.37, mapHeight * 0.16 + size * 0.31);
    this.controls.update();
  }

  /** Distance from the camera to what it looks at (zoom level). */
  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Jump to look at `point` from the current direction, zoomed in. */
  focus(point: THREE.Vector3) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.min(this.distance, FOLLOW_ZOOM);
    this.controls.target.copy(point).setY(0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
  }

  /** Ease toward keeping `point` centred (follow mode). */
  track(point: THREE.Vector3, dt: number) {
    this.delta.copy(point).sub(this.controls.target).setY(0).multiplyScalar(Math.min(1, dt * FOLLOW_EASE));
    this.controls.target.add(this.delta);
    this.camera.position.add(this.delta);
  }

  update() {
    this.controls.update();
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.controls.dispose();
  }
}
