// Road ribbons draped over the terrain, from OSM street centre lines.

import * as THREE from "three";
import type { MapJSON } from "../../../types";
import { SCENE } from "../palette";
import type { HeightField } from "./HeightField";

const LIFT = 0.06; // above the ground to avoid z-fighting
const SAMPLE_STEP = 2; // cells between height samples along a road

export function buildRoads(map: MapJSON, heights: HeightField): THREE.Mesh {
  const positions: number[] = [];
  for (const road of map.roads) {
    const half = heights.units(road.w) / 2;
    const pts = resample(road.p);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * half;
      const ny = ((bx - ax) / len) * half;
      // Extend each segment slightly so joints don't show gaps.
      const ex = ((bx - ax) / len) * half * 0.5;
      const ey = ((by - ay) / len) * half * 0.5;
      const ha = heights.groundAt(ax, ay) + LIFT;
      const hb = heights.groundAt(bx, by) + LIFT;
      const a1 = [ax + nx - ex, ha, ay + ny - ey];
      const a2 = [ax - nx - ex, ha, ay - ny - ey];
      const b1 = [bx + nx + ex, hb, by + ny + ey];
      const b2 = [bx - nx + ex, hb, by - ny + ey];
      positions.push(...a1, ...b1, ...a2, ...a2, ...b1, ...b2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: SCENE.road, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}

/** Split a flat [x0, y0, x1, y1, ...] polyline into points at most SAMPLE_STEP apart. */
function resample(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  const n = flat.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay, bx, by] = [flat[i * 2], flat[i * 2 + 1], flat[i * 2 + 2], flat[i * 2 + 3]];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_STEP));
    for (let s = 0; s < steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  if (n > 0) out.push([flat[flat.length - 2], flat[flat.length - 1]]);
  return out;
}
