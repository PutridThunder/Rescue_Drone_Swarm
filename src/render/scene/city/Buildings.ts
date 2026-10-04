// Buildings extruded from real OSM footprints. Each building is recoloured as the fleet searches
// the cells under it: grey (not searched) -> green (searched), tinted in hazard zones. Windows,
// shading and outlines come from buildingMaterial.ts and a merged outline mesh.

import * as THREE from "three";
import type { MapJSON, SimState } from "../../../types";
import { SCENE } from "../palette";
import { createBuildingMaterial } from "./buildingMaterial";
import type { HeightField } from "./HeightField";

const SEARCHED = 0.8; // same threshold as the simulation
const MIN_HEIGHT_M = 2.5;
const BASE_SINK = 0.2; // sink the base slightly into sloped ground
const HAZARD_TINT = 0.05;

interface BuildingRange {
  start: number; // first vertex
  count: number;
  heightM: number;
  cells: Int32Array; // grid cells under the footprint
}

export class Buildings {
  readonly mesh: THREE.Mesh;
  /** Roof outlines (one draw call for the whole city). */
  readonly outlines: THREE.LineSegments;
  private readonly ranges: BuildingRange[] = [];
  private readonly byCell = new Map<number, number[]>();
  private readonly colors: THREE.BufferAttribute;
  private readonly dirty = new Set<number>();
  /** Cells inside the search circle (null: no circle); buildings outside are drawn dimmed. */
  areaMask: Uint8Array | null = null;

  constructor(map: MapJSON, heights: HeightField) {
    const positions: number[] = [];
    const facade: number[] = []; // per vertex: metres along the wall, metres above the base (-1 on roofs)
    const tint: number[] = []; // per vertex: building brightness variation
    const lines: number[] = [];
    const m = heights.metresPerUnit;
    for (const { p, h } of map.buildings) {
      const ring = toRing(p);
      if (!ring) continue;
      let base = Infinity;
      for (const v of ring) base = Math.min(base, heights.groundAt(v.x, v.y));
      base -= BASE_SINK;
      const top = base + BASE_SINK + heights.units(Math.max(MIN_HEIGHT_M, h));
      const start = positions.length / 3;
      const wallTop = (top - base - BASE_SINK) * m; // metres
      const sink = -BASE_SINK * m;
      let along = 0; // metres along the perimeter
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const c = ring[(i + 1) % ring.length];
        const len = a.distanceTo(c) * m;
        // Wound so the wall faces outward (the ring is counter-clockwise in x/south).
        positions.push(a.x, base, a.y, c.x, top, c.y, c.x, base, c.y, a.x, base, a.y, a.x, top, a.y, c.x, top, c.y);
        facade.push(along, sink, along + len, wallTop, along + len, sink, along, sink, along, wallTop, along + len, wallTop);
        along += len;
        lines.push(a.x, top, a.y, c.x, top, c.y); // roof edge
      }
      for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(ring, [])) {
        // The ring is in (x, y = south); flip the winding so roofs face up in x/z.
        positions.push(ring[i0].x, top, ring[i0].y, ring[i2].x, top, ring[i2].y, ring[i1].x, top, ring[i1].y);
        facade.push(-1, -1, -1, -1, -1, -1);
      }
      const variation = 0.94 + 0.12 * hash(ring[0].x, ring[0].y);
      for (let v = start; v < positions.length / 3; v++) tint.push(variation);
      const b = this.ranges.length;
      const cells = footprintCells(ring, heights.W, heights.H);
      this.ranges.push({ start, count: positions.length / 3 - start, heightM: h, cells });
      for (const i of cells) {
        const list = this.byCell.get(i);
        if (list) list.push(b);
        else this.byCell.set(i, [b]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.colors = new THREE.BufferAttribute(new Uint8Array(positions.length), 3, true);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("color", this.colors);
    geo.setAttribute("facade", new THREE.Float32BufferAttribute(facade, 2));
    geo.setAttribute("tint", new THREE.Float32BufferAttribute(tint, 1));
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, createBuildingMaterial());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.outlines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: SCENE.buildingEdge, transparent: true, opacity: 0.45 }));
  }

  /** Mark the buildings over a changed cell for repainting. */
  invalidateCell(i: number) {
    const list = this.byCell.get(i);
    if (list) for (const b of list) this.dirty.add(b);
  }

  invalidateAll() {
    for (let b = 0; b < this.ranges.length; b++) this.dirty.add(b);
  }

  /** Repaint the buildings marked dirty, uploading only the changed vertex range. */
  repaint(state: SimState) {
    if (this.dirty.size === 0) return;
    const { searched, hazard } = state.knowledge;
    const arr = this.colors.array as Uint8Array;
    const unsearched = new THREE.Color(SCENE.buildingUnsearched);
    const done = new THREE.Color(SCENE.buildingSearched);
    const tall = new THREE.Color(SCENE.buildingTall);
    const danger = new THREE.Color(SCENE.buildingHazard);
    const outside = new THREE.Color(SCENE.buildingOutsideArea);
    const c = new THREE.Color();
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of this.dirty) {
      const r = this.ranges[b];
      let progress = 0;
      let hz = 0;
      for (const i of r.cells) {
        progress += Math.min(1, searched[i] / SEARCHED);
        if (hazard) hz = Math.max(hz, hazard[i]);
      }
      progress /= r.cells.length;
      c.copy(r.heightM > state.config.flightAltitudeM ? tall : unsearched).lerp(done, progress * progress);
      if (hz > HAZARD_TINT) c.lerp(danger, hz * (1 - progress) * 0.8);
      if (this.areaMask && !this.areaMask[r.cells[0]]) c.copy(outside);
      const R = Math.round(c.r * 255);
      const G = Math.round(c.g * 255);
      const B = Math.round(c.b * 255);
      for (let v = r.start; v < r.start + r.count; v++) {
        arr[v * 3] = R;
        arr[v * 3 + 1] = G;
        arr[v * 3 + 2] = B;
      }
      lo = Math.min(lo, r.start);
      hi = Math.max(hi, r.start + r.count);
    }
    this.dirty.clear();
    this.colors.clearUpdateRanges();
    this.colors.addUpdateRange(lo * 3, (hi - lo) * 3);
    this.colors.needsUpdate = true;
  }
}

/** Footprint as a counter-clockwise ring of points, or null if degenerate. */
function toRing(flat: number[]): THREE.Vector2[] | null {
  const ring: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push(new THREE.Vector2(flat[i], flat[i + 1]));
  if (ring.length > 3 && ring[0].distanceTo(ring[ring.length - 1]) < 1e-3) ring.pop();
  if (ring.length < 3) return null;
  if (THREE.ShapeUtils.isClockWise(ring)) ring.reverse();
  return ring;
}

/** Grid cells whose centres fall inside the footprint (at least the centroid cell). */
function footprintCells(ring: THREE.Vector2[], W: number, H: number): Int32Array {
  const out: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const v of ring) {
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    sx += v.x;
    sy += v.y;
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[i + 1] - 0.5)); x++) out.push(y * W + x);
    }
  }
  if (out.length === 0) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(sx / ring.length)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(sy / ring.length)));
    out.push(y * W + x);
  }
  return Int32Array.from(out);
}

/** Deterministic 0..1 value from a position (stable per-building variation). */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
