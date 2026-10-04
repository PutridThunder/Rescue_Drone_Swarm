// Geometries and materials shared by every actor, created once (not per drone or per restart),
// plus the per-frame context actors read from.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { TruckView } from "../../../types";
import type { HeightField } from "../city/HeightField";
import { SCENE } from "../palette";

export const DARK = 0x2b3445;
export const TRUCK_ROOF = 0.42; // landing-pad height above the road (world units)

export const GEOMETRY = {
  droneHull: new THREE.BoxGeometry(0.9, 0.28, 0.9),
  droneCanopy: new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  droneArm: new THREE.BoxGeometry(1.5, 0.08, 0.12),
  droneRotor: new THREE.CylinderGeometry(0.42, 0.42, 0.03, 16),
  sensorDisc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
  altitudeStalk: new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
  truckBody: new THREE.BoxGeometry(1.5, 0.38, 0.72),
  truckCab: new THREE.BoxGeometry(0.42, 0.34, 0.68),
  truckStripe: new THREE.BoxGeometry(1.52, 0.07, 0.74),
  truckPad: new THREE.CylinderGeometry(0.32, 0.32, 0.02, 24),
  truckPadInner: new THREE.CylinderGeometry(0.24, 0.24, 0.025, 24),
  truckWheel: new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateX(Math.PI / 2),
  pinHead: new THREE.SphereGeometry(0.28, 14, 10),
  pinCone: new THREE.ConeGeometry(0.22, 0.7, 14).rotateX(Math.PI),
  pulseRing: new THREE.RingGeometry(0.5, 0.75, 32).rotateX(-Math.PI / 2),
  beacon: new THREE.CylinderGeometry(0.06, 0.06, 6, 8, 1, true),
  person: new THREE.CapsuleGeometry(0.14, 0.3, 4, 8),
};

export const MATERIAL = {
  white: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  dark: new THREE.MeshLambertMaterial({ color: DARK }),
  rotor: new THREE.MeshBasicMaterial({ color: DARK, transparent: true, opacity: 0.35 }),
  truckBody: new THREE.MeshLambertMaterial({ color: SCENE.truckBody }),
  truckCab: new THREE.MeshLambertMaterial({ color: SCENE.truckCab }),
  truckAccent: new THREE.MeshLambertMaterial({ color: SCENE.truckAccent }),
  truckRoute: new THREE.LineDashedMaterial({ color: SCENE.truckAccent, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.9 }),
  beacon: new THREE.MeshBasicMaterial({ color: SCENE.survivorFound, transparent: true, opacity: 0.35, depthWrite: false }),
};

/** A transparent, non-depth-writing overlay material (discs, rings). */
export function overlayMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

/** What every actor needs each frame. */
export interface ActorContext {
  heights: HeightField;
  flightUnits: number; // flight altitude in world units
  trucks: Map<number, TruckView>;
  showPaths: boolean;
  showSensors: boolean;
  revealHidden: boolean;
}

/** Remove an object from its parent and free what it owns (not the shared resources above). */
export function disposeObject(root: THREE.Object3D) {
  const shared = new Set<unknown>([...Object.values(GEOMETRY), ...Object.values(MATERIAL)]);
  root.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove(); // HTML labels outlive their parent otherwise
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !shared.has(mesh.geometry)) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) if (!shared.has(m)) m.dispose();
  });
  root.removeFromParent();
}

/**
 * Set a line's points. three.js can't grow an existing position buffer in place, so a longer
 * line gets a fresh geometry (with room to spare, so it isn't replaced on every step).
 */
export function setLinePoints(line: THREE.Line, points: THREE.Vector3[]) {
  const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!attr || attr.count < points.length) {
    line.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(8, Math.ceil(points.length * 1.5)) * 3), 3));
    line.geometry = geo;
  }
  const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  points.forEach((p, i) => pos.setXYZ(i, p.x, p.y, p.z));
  pos.needsUpdate = true;
  line.geometry.setDrawRange(0, points.length);
  line.geometry.computeBoundingSphere();
}
