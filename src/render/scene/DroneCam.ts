// First-person "drone cam": a second camera riding on one drone, rendered picture-in-picture
// into a screen rectangle of the main canvas (scissor), so no extra WebGL context is needed.

import * as THREE from "three";

const FOV = 70;
const LOOK_AHEAD = 7; // world units in front of the drone
const LOOK_DOWN = 3.2; // camera tilts down toward the street (~25 degrees)
const HEADING_SMOOTHING = 4; // higher = snappier turns

export class DroneCam {
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 400);
  private yaw = 0;
  private hasPose = false;

  /** Move the camera to the drone, smoothing its heading so turns feel like a gimbal. */
  follow(pos: THREE.Vector3, yaw: number, dt: number) {
    if (!this.hasPose) {
      this.yaw = yaw;
      this.hasPose = true;
    }
    const diff = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    this.yaw += diff * Math.min(1, dt * HEADING_SMOOTHING);
    // Drone forward is +x in its local frame; group.rotation.y = -heading.
    const fx = Math.cos(this.yaw);
    const fz = Math.sin(this.yaw);
    // Gimbal camera under the drone's nose, so the drone itself never blocks the view.
    this.camera.position.set(pos.x + fx * 0.5, pos.y - 0.3, pos.z + fz * 0.5);
    this.camera.lookAt(pos.x + fx * LOOK_AHEAD, pos.y - LOOK_DOWN, pos.z + fz * LOOK_AHEAD);
  }

  reset() {
    this.hasPose = false;
  }

  /**
   * Render the drone's view and copy it into `target` (a 2D canvas in the drone cam window).
   * Call before the main render: it borrows the bottom-left corner of the main canvas, which the
   * main render then overwrites, so nothing else on screen can show through the window.
   */
  renderTo(renderer: THREE.WebGLRenderer, scene: THREE.Scene, target: HTMLCanvasElement) {
    const w = target.clientWidth;
    const h = target.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = renderer.getPixelRatio();
    if (target.width !== Math.round(w * dpr) || target.height !== Math.round(h * dpr)) {
      target.width = Math.round(w * dpr);
      target.height = Math.round(h * dpr);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const main = renderer.domElement;
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, w, h);
    renderer.setViewport(0, 0, w, h);
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, main.clientWidth, main.clientHeight);
    // The rendered corner is the bottom-left of the drawing buffer.
    target.getContext("2d")!.drawImage(main, 0, main.height - target.height, target.width, target.height, 0, 0, target.width, target.height);
  }
}
