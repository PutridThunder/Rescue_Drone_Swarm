// A crowd: a translucent disc with little people; orange if reported by the user, purple (with a
// label) if predicted by crowd intel.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { CrowdView } from "../../../types";
import { SCENE } from "../palette";
import { disposeObject, GEOMETRY, overlayMaterial, type ActorContext } from "./shared";

const PEOPLE = 6;
const LABEL_HEIGHT = 2.2;

export class CrowdMarker {
  readonly group = new THREE.Group();
  private shown = true;

  constructor(
    readonly crowd: CrowdView,
    ctx: ActorContext,
  ) {
    const color = crowd.source === "intel" ? SCENE.intel : SCENE.crowd;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(crowd.radius, 40).rotateX(-Math.PI / 2), overlayMaterial(color, 0.18));
    const edge = new THREE.Mesh(new THREE.RingGeometry(crowd.radius - 0.12, crowd.radius, 48).rotateX(-Math.PI / 2), overlayMaterial(color, 0.7));
    disc.renderOrder = edge.renderOrder = 3;
    this.group.add(disc, edge);

    const body = new THREE.MeshLambertMaterial({ color });
    for (let k = 0; k < PEOPLE; k++) {
      const a = (k / PEOPLE) * Math.PI * 2;
      const r = k === 0 ? 0 : crowd.radius * 0.45;
      const person = new THREE.Mesh(GEOMETRY.person, body);
      person.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
      this.group.add(person);
    }
    if (crowd.label) {
      const el = document.createElement("div");
      el.className = `crowd-label ${crowd.source}`;
      el.textContent = crowd.label;
      const label = new CSS2DObject(el);
      label.position.set(0, LABEL_HEIGHT, 0);
      this.group.add(label);
    }
    this.group.position.set(crowd.x, ctx.heights.groundAt(crowd.x, crowd.y) + 0.1, crowd.y);
  }

  /** Show or hide (including the HTML label, which ignores parent visibility). */
  setShown(shown: boolean) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.group.traverse((o) => (o.visible = shown));
  }

  dispose() {
    disposeObject(this.group);
  }
}
