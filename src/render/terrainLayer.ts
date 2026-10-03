import * as THREE from 'three';
import { Terrain, type KnowledgeView, type World } from '../types';
import { BUILDING_COLORS, COLORS, heatColor } from './palette';

const SKIRT = 3; // columns extend this far below y=0 so the diorama edge reads as a solid slab
const WATER_TOP = 0.06;
const STEP = 0.2; // vertical quantization for a terraced voxel look

export interface OverlayFlags {
  fog: boolean;
  frontier: boolean;
  hazard: boolean;
  population: boolean;
}

function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Instanced voxel columns for every cell plus knowledge/overlay colouring. */
export class TerrainLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly groundTop: Float32Array; // top of terrain (no building), world units
  readonly columnTop: Float32Array; // top of column incl. building
  readonly vScale: number; // world units per metre of elevation
  private readonly base: Float32Array;
  private readonly dim: Float32Array;
  private readonly fog: Float32Array;
  private readonly popNorm: Float32Array;
  private readonly colors: Float32Array;
  private readonly tmp = new THREE.Color();
  private readonly tmp2 = new THREE.Color();

  constructor(private readonly world: World) {
    const { width, height } = world.meta;
    const n = width * height;
    let maxElev = 1;
    for (let i = 0; i < n; i++) maxElev = Math.max(maxElev, world.elevation[i]);
    // Diorama: tallest terrain ~ 13% of map width, but never more than 1.6x true scale.
    this.vScale = Math.min((1.6 / world.meta.cellSizeM), (width * 0.13) / maxElev);

    this.groundTop = new Float32Array(n);
    this.columnTop = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.dim = new Float32Array(n * 3);
    this.fog = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.popNorm = this.normalizePopulation();

    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    const m = new THREE.Matrix4();
    const c = this.tmp;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const t = world.terrain[i];
        const r = hash(i);
        let top: number;
        if (t === Terrain.Water) top = WATER_TOP;
        else top = Math.max(STEP, Math.round(world.elevation[i] * this.vScale / STEP) * STEP);
        if (t === Terrain.Road) top -= 0.04;
        this.groundTop[i] = top;
        let colTop = top;
        if (t === Terrain.Building) {
          const bh = world.buildingHeight[i] || 8;
          colTop += Math.min(7, 0.45 + (bh / world.meta.cellSizeM) * 2.2);
        }
        this.columnTop[i] = colTop;
        m.makeScale(t === Terrain.Building ? 0.9 : 1, colTop + SKIRT, t === Terrain.Building ? 0.9 : 1);
        m.setPosition(x + 0.5 - width / 2, -SKIRT, y + 0.5 - height / 2);
        this.mesh.setMatrixAt(i, m);

        switch (t) {
          case Terrain.Water: c.copy(COLORS.water).lerp(COLORS.waterDeep, Math.min(1, world.coastDistance[i] / 12)); break;
          case Terrain.Road: c.copy(COLORS.road); break;
          case Terrain.Park: {
            const highland = Math.min(1, world.elevation[i] / 250);
            c.copy(COLORS.park).lerp(COLORS.forest, highland).offsetHSL(0, 0, (r - 0.5) * 0.06);
            break;
          }
          case Terrain.Building: {
            c.copy(BUILDING_COLORS[Math.floor(r * BUILDING_COLORS.length)]).offsetHSL(0, 0, (hash(i + 7) - 0.5) * 0.05);
            break;
          }
          default: c.copy(COLORS.ground).offsetHSL(0, 0, (r - 0.5) * 0.04 - Math.min(0.08, world.elevation[i] / 3000));
        }
        this.base.set([c.r, c.g, c.b], i * 3);
        const hsl = { h: 0, s: 0, l: 0 };
        this.tmp2.copy(c).getHSL(hsl);
        this.tmp2.setHSL(hsl.h, hsl.s * 0.3, hsl.l).multiplyScalar(0.42).lerp(COLORS.fog, 0.4);
        this.dim.set([this.tmp2.r, this.tmp2.g, this.tmp2.b], i * 3);
        this.tmp2.copy(COLORS.fog).lerp(COLORS.fogHigh, Math.min(1, colTop / 14) + (r - 0.5) * 0.15);
        this.fog.set([this.tmp2.r, this.tmp2.g, this.tmp2.b], i * 3);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.set(this.base);
  }

  private normalizePopulation(): Float32Array {
    const pop = this.world.population;
    const vals = Array.from(pop).filter((v) => v > 0.5).sort((a, b) => a - b);
    const p95 = vals.length ? vals[Math.floor(vals.length * 0.95)] : 1;
    const denom = Math.log1p(p95);
    return Float32Array.from(pop, (v) => Math.min(1, Math.log1p(v) / denom));
  }

  /** Recompute instance colour for the given cells (or all cells when `cells` is null). */
  recolor(k: KnowledgeView | null, flags: OverlayFlags, cells: ArrayLike<number> | null): void {
    const n = this.world.terrain.length;
    const count = cells ? cells.length : n;
    for (let j = 0; j < count; j++) {
      const i = cells ? cells[j] : j;
      if (i < 0 || i >= n) continue;
      this.colorCell(i, k, flags);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private colorCell(i: number, k: KnowledgeView | null, f: OverlayFlags): void {
    const o = i * 3;
    const B = this.base;
    let r = B[o], g = B[o + 1], b = B[o + 2];
    const isWater = this.world.terrain[i] === Terrain.Water;
    if (f.fog && k && !isWater) {
      const s = Math.min(1, Math.max(0, k.searched[i]));
      const F = k.known[i] ? this.dim : this.fog;
      // Ease so partially searched cells brighten quickly at first.
      const e = 1 - (1 - s) * (1 - s);
      r = F[o] + (r - F[o]) * e;
      g = F[o + 1] + (g - F[o + 1]) * e;
      b = F[o + 2] + (b - F[o + 2]) * e;
    }
    if (f.population && !isWater) {
      const p = this.popNorm[i];
      if (p > 0.02) {
        heatColor(p, this.tmp);
        const a = 0.25 + 0.6 * p;
        r += (this.tmp.r - r) * a; g += (this.tmp.g - g) * a; b += (this.tmp.b - b) * a;
      }
    }
    if (f.hazard && k?.hazard && !isWater) {
      const h = k.hazard[i] * 0.38;
      if (h > 0) {
        const H = COLORS.hazard;
        r += (H.r - r) * h; g += (H.g - g) * h; b += (H.b - b) * h;
      }
    }
    if (f.frontier && k && k.frontier[i]) {
      const C = COLORS.frontier;
      r += (C.r - r) * 0.45; g += (C.g - g) * 0.45; b += (C.b - b) * 0.45;
    }
    this.colors[o] = r;
    this.colors[o + 1] = g;
    this.colors[o + 2] = b;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
