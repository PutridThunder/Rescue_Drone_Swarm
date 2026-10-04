// A survivor pin: faint while unfound (only shown if placed by the user or revealed), a pulsing
// beacon once found, dark grey if lost to the flood.

import * as THREE from "three";
import type { SurvivorView } from "../../../types";
import { SCENE } from "../palette";
import { disposeObject, GEOMETRY, MATERIAL, overlayMaterial, type ActorContext } from "./shared";

const LOST_COLOR = 0x4a5363;

export class SurvivorMarker {
  readonly group = new THREE.Group();
  private readonly pin: THREE.MeshLambertMaterial;
  private readonly ring: THREE.Mesh;
  private readonly beacon: THREE.Mesh;

  constructor(
    private readonly s: SurvivorView,
    ctx: ActorContext,
  ) {
    this.pin = new THREE.MeshLambertMaterial({ color: SCENE.survivorHidden, transparent: true });
    const head = new THREE.Mesh(GEOMETRY.pinHead, this.pin);
    head.position.y = 1.15;
    const cone = new THREE.Mesh(GEOMETRY.pinCone, this.pin);
    cone.position.y = 0.7;
    this.ring = new THREE.Mesh(GEOMETRY.pulseRing, overlayMaterial(SCENE.survivorFound, 0.6));
    this.ring.position.y = 0.05;
    this.beacon = new THREE.Mesh(GEOMETRY.beacon, MATERIAL.beacon);
    this.beacon.position.y = 3;
    this.group.add(head, cone, this.ring, this.beacon);
    this.group.position.set(s.x, ctx.heights.surfaceAt(s.x, s.y), s.y);
  }

  update(ctx: ActorContext, time: number) {
    const s = this.s;
    const visible = s.found || s.lost || s.placed || ctx.revealHidden;
    this.group.visible = visible;
    if (!visible) return;
    this.ring.visible = s.found;
    this.beacon.visible = s.found;
    this.group.scale.setScalar(s.found ? 1 : 0.8);
    if (s.found) {
      this.pin.color.setHex(SCENE.survivorFound);
      this.pin.opacity = 1;
      const p = (time * 0.8 + s.id * 0.37) % 1; // expanding pulse
      this.ring.scale.setScalar(1 + p * 1.8);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - p);
    } else {
      this.pin.color.setHex(s.lost ? LOST_COLOR : SCENE.survivorHidden);
      this.pin.opacity = s.lost ? 0.9 : 0.55;
    }
  }

  dispose() {
    disposeObject(this.group);
  }
}
