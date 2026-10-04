// Street names floating over the map (HTML labels), one per street on its longest segment.

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { MapJSON } from "../../../types";
import type { HeightField } from "./HeightField";

const MIN_SEGMENT = 8; // cells; shorter streets get no label
const LIFT = 0.4;

export class StreetLabels {
  readonly group = new THREE.Group();
  private readonly labels: CSS2DObject[] = [];
  private visible = true;

  constructor(map: MapJSON, heights: HeightField) {
    const longest = new Map<number, { len: number; x: number; y: number }>();
    for (const road of map.roads) {
      if (road.n < 0) continue;
      for (let i = 0; i + 3 < road.p.length; i += 2) {
        const len = Math.hypot(road.p[i + 2] - road.p[i], road.p[i + 3] - road.p[i + 1]);
        const best = longest.get(road.n);
        if (!best || len > best.len) longest.set(road.n, { len, x: (road.p[i] + road.p[i + 2]) / 2, y: (road.p[i + 1] + road.p[i + 3]) / 2 });
      }
    }
    for (const [nameIndex, seg] of longest) {
      if (seg.len < MIN_SEGMENT) continue;
      const el = document.createElement("div");
      el.className = "street-label";
      el.textContent = map.roadNames[nameIndex];
      const label = new CSS2DObject(el);
      label.position.set(seg.x, heights.groundAt(seg.x, seg.y) + LIFT, seg.y);
      this.group.add(label);
      this.labels.push(label);
    }
  }

  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const l of this.labels) l.visible = visible;
  }
}
