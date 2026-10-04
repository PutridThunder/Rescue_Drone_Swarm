// Outline of the drawn search circle: a thin tube draped over the terrain. Also used as a live
// preview while the user drags out a new circle.

import * as THREE from "three";
import type { SearchArea } from "../../../shared/searchArea";
import { SCENE } from "../palette";
import type { HeightField } from "./HeightField";

const SEGMENTS = 160;
const LIFT = 0.3; // world units above the ground
const THICKNESS = 0.22; // tube radius, world units (1 unit = 1 cell = 10 m)

export class SearchAreaRing {
  readonly mesh: THREE.Mesh;
  private key = "";

  constructor(private readonly heights: HeightField) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: SCENE.searchArea, transparent: true, depthTest: false }));
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  set(area: SearchArea | null, preview = false) {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = preview ? 0.6 : 0.95;
    this.mesh.visible = !!area;
    const key = area ? `${area.x},${area.y},${area.r}` : "";
    if (!area || key === this.key) return;
    this.key = key;
    const points = Array.from({ length: SEGMENTS }, (_, k) => {
      const a = (k / SEGMENTS) * Math.PI * 2;
      const x = area.x + Math.cos(a) * area.r;
      const y = area.y + Math.sin(a) * area.r;
      return new THREE.Vector3(x, this.heights.groundAt(x, y) + LIFT, y);
    });
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), SEGMENTS, THICKNESS, 5, true);
  }
}
