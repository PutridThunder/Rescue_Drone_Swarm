import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { MapJSON, SimState, World } from '../types';
import { SCENE } from './palette';

const WATER = 0;
const PARK = 3;
const SEARCHED = 0.8;

/** World units: 1 unit = 1 grid cell horizontally; heights use the same metres-per-unit (true scale). */
export class CityLayer {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  private readonly W: number;
  private readonly H: number;
  readonly mPerUnit: number;
  private readonly overlayData: Uint8Array;
  private readonly overlayTex: THREE.DataTexture;
  private buildingMesh: THREE.Mesh | null = null;
  private buildingColors: THREE.BufferAttribute | null = null;
  private buildingRanges: { start: number; count: number; heightM: number }[] = [];
  private floodMask: Uint8Array | null = null;
  private buildingCells: Int32Array[] = [];
  private cellBuildings = new Map<number, number[]>();
  private readonly dirtyBuildings = new Set<number>();
  private readonly labels: CSS2DObject[] = [];
  private floodBlend = 0;
  private knowledgeRef: unknown = null;
  private lastPopOn = false;
  private lastHazardOn = false;
  private lastImpacted = false;

  constructor(
    private readonly world: World,
    map: MapJSON | null,
  ) {
    this.W = world.meta.width;
    this.H = world.meta.height;
    this.mPerUnit = world.meta.cellSizeM;
    this.group.position.set(-this.W / 2, 0, -this.H / 2);

    const terrain = this.buildTerrain();
    this.group.add(terrain);
    this.pickables.push(terrain);

    this.overlayData = new Uint8Array(this.W * this.H * 4);
    this.overlayTex = new THREE.DataTexture(this.overlayData, this.W, this.H, THREE.RGBAFormat);
    this.overlayTex.magFilter = THREE.LinearFilter;
    this.overlayTex.minFilter = THREE.LinearFilter;
    this.overlayTex.flipY = false;
    const overlay = new THREE.Mesh(
      terrain.geometry,
      new THREE.MeshBasicMaterial({
        map: this.overlayTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    overlay.renderOrder = 2;
    this.group.add(overlay);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(this.W, this.H).rotateX(-Math.PI / 2).translate(this.W / 2, -0.05, this.H / 2),
      new THREE.MeshLambertMaterial({ color: SCENE.water }),
    );
    water.receiveShadow = true;
    this.group.add(water);
    // Surroundings beyond the mapped area: land to the north/east/west, the inlet to the south.
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(this.W * 6, this.H * 6).rotateX(-Math.PI / 2).translate(this.W / 2, -0.6, this.H / 2),
      new THREE.MeshLambertMaterial({ color: SCENE.ground }),
    );
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(this.W * 6, this.H * 3).rotateX(-Math.PI / 2).translate(this.W / 2, -0.55, this.H * 2.5 - 0.5),
      new THREE.MeshLambertMaterial({ color: SCENE.water }),
    );
    this.group.add(land, sea);

    this.group.add(this.buildTrees());
    if (map) {
      this.group.add(this.buildRoads(map));
      const buildings = this.buildBuildings(map);
      this.group.add(buildings);
      this.pickables.push(buildings);
      this.buildLabels(map);
    }
  }

  /** Terrain height in world units at fractional cell coords (bilinear over cell centres). */
  heightAt(x: number, y: number): number {
    const { W, H } = this;
    const fx = Math.min(W - 1, Math.max(0, x - 0.5));
    const fy = Math.min(H - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const ux = fx - x0;
    const uy = fy - y0;
    const e = this.world.elevation;
    const h =
      e[y0 * W + x0] * (1 - ux) * (1 - uy) + e[y0 * W + x1] * ux * (1 - uy) + e[y1 * W + x0] * (1 - ux) * uy + e[y1 * W + x1] * ux * uy;
    return h / this.mPerUnit;
  }

  /** Top of whatever is at this spot (roof or ground), in world units. */
  surfaceAt(x: number, y: number): number {
    const i = Math.floor(y) * this.W + Math.floor(x);
    return this.heightAt(x, y) + (this.world.buildingHeight[i] ?? 0) / this.mPerUnit;
  }

  update(state: SimState, dirty: number[], dt: number) {
    const k = state.knowledge;
    const popOn = state.config.info.population;
    const hazardOn = k.hazard !== null;
    const impacted = !!state.flood?.impacted;
    let all = false;
    if (k !== this.knowledgeRef || popOn !== this.lastPopOn || hazardOn !== this.lastHazardOn) {
      this.knowledgeRef = k;
      this.lastPopOn = popOn;
      this.lastHazardOn = hazardOn;
      all = true;
    }
    if (impacted !== this.lastImpacted) {
      this.lastImpacted = impacted;
      this.floodBlend = 0;
      all = true;
    }
    if (impacted && this.floodBlend < 1) {
      this.floodBlend = Math.min(1, this.floodBlend + dt / 2);
      all = true;
    }

    const n = this.W * this.H;
    if (all) {
      for (let i = 0; i < n; i++) this.paintCell(i, state);
      for (let b = 0; b < this.buildingRanges.length; b++) this.dirtyBuildings.add(b);
    } else if (dirty.length) {
      for (const i of dirty) {
        this.paintCell(i, state);
        const bs = this.cellBuildings.get(i);
        if (bs) for (const b of bs) this.dirtyBuildings.add(b);
      }
    }
    if (all || dirty.length) this.overlayTex.needsUpdate = true;
    if (this.dirtyBuildings.size) this.paintBuildings(state);
  }

  setFloodMask(mask: Uint8Array | null) {
    this.floodMask = mask;
  }

  setLabelsVisible(visible: boolean) {
    for (const l of this.labels) l.visible = visible;
  }

  // ---------------------------------------------------------------------------

  private buildTerrain(): THREE.Mesh {
    const { W, H } = this;
    const geo = new THREE.PlaneGeometry(W, H, W, H);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, H / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cGround = new THREE.Color(SCENE.ground);
    const cPark = new THREE.Color(SCENE.park);
    const cWater = new THREE.Color(SCENE.water);
    const tmp = new THREE.Color();
    const { terrain, elevation } = this.world;
    for (let v = 0; v < pos.count; v++) {
      const vx = Math.round(pos.getX(v));
      const vz = Math.round(pos.getZ(v));
      // Corner vertex: average the up-to-four touching cells.
      let h = 0;
      let cnt = 0;
      let water = 0;
      let park = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const cx = vx + dx;
          const cy = vz + dy;
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          const i = cy * W + cx;
          cnt++;
          if (terrain[i] === WATER) water++;
          else h += elevation[i];
          if (terrain[i] === PARK) park++;
        }
      }
      const land = cnt - water;
      const y = water === cnt ? -0.4 : land > 0 ? h / land / this.mPerUnit : 0;
      pos.setY(v, water > 0 && water >= land ? Math.min(y, -0.15) : y);
      tmp.copy(cGround).lerp(cPark, cnt ? park / cnt : 0).lerp(cWater, cnt ? water / cnt : 0);
      colors.set([tmp.r, tmp.g, tmp.b], v * 3);
    }
    // Plane UVs put v=1 at the north edge; flip so texel row y matches grid row y.
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let v = 0; v < uv.count; v++) uv.setY(v, 1 - uv.getY(v));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Scatter low-poly trees over park cells (deterministic), like a model-railway diorama. */
  private buildTrees(): THREE.InstancedMesh {
    const { W, H } = this;
    const { terrain, buildingHeight } = this.world;
    const spots: [number, number][] = [];
    let seed = 1234567;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (terrain[i] !== PARK || buildingHeight[i] > 0 || rand() > 0.45) continue;
        spots.push([x + 0.2 + rand() * 0.6, y + 0.2 + rand() * 0.6]);
      }
    }
    const geo = new THREE.IcosahedronGeometry(0.55, 0);
    geo.translate(0, 0.75, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: SCENE.tree, flatShading: true }), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach(([x, y], k) => {
      const s = 0.7 + rand() * 0.7;
      sc.set(s, s * (0.9 + rand() * 0.5), s);
      q.setFromAxisAngle(v.set(0, 1, 0), rand() * Math.PI);
      m.compose(new THREE.Vector3(x, this.heightAt(x, y), y), q, sc);
      mesh.setMatrixAt(k, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildRoads(map: MapJSON): THREE.Mesh {
    const pos: number[] = [];
    const lift = 0.06;
    for (const r of map.roads) {
      const half = r.w / this.mPerUnit / 2;
      const pts: [number, number][] = [];
      const n = r.p.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const ax = r.p[i * 2];
        const ay = r.p[i * 2 + 1];
        const bx = r.p[i * 2 + 2];
        const by = r.p[i * 2 + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
        for (let s = 0; s < steps; s++) pts.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
      }
      if (n > 0) pts.push([r.p[r.p.length - 2], r.p[r.p.length - 1]]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / len) * half;
        const ny = ((bx - ax) / len) * half;
        const ha = this.heightAt(ax, ay) + lift;
        const hb = this.heightAt(bx, by) + lift;
        // Extend slightly along the segment so joints don't show gaps.
        const ex = ((bx - ax) / len) * half * 0.5;
        const ey = ((by - ay) / len) * half * 0.5;
        const a1 = [ax + nx - ex, ha, ay + ny - ey];
        const a2 = [ax - nx - ex, ha, ay - ny - ey];
        const b1 = [bx + nx + ex, hb, by + ny + ey];
        const b2 = [bx - nx + ex, hb, by - ny + ey];
        pos.push(...a1, ...b1, ...a2, ...a2, ...b1, ...b2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: SCENE.road, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide }),
    );
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
  }

  private buildBuildings(map: MapJSON): THREE.Mesh {
    const pos: number[] = [];
    for (let b = 0; b < map.buildings.length; b++) {
      const { p, h } = map.buildings[b];
      const ring: THREE.Vector2[] = [];
      for (let i = 0; i < p.length; i += 2) ring.push(new THREE.Vector2(p[i], p[i + 1]));
      if (ring.length > 3 && ring[0].distanceTo(ring[ring.length - 1]) < 1e-3) ring.pop();
      if (ring.length < 3) continue;
      if (THREE.ShapeUtils.isClockWise(ring)) ring.reverse();
      let base = Infinity;
      for (const v of ring) base = Math.min(base, this.heightAt(v.x, v.y));
      base -= 0.2;
      const top = base + 0.2 + Math.max(2.5, h) / this.mPerUnit;
      const start = pos.length / 3;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const c = ring[(i + 1) % ring.length];
        pos.push(a.x, base, a.y, c.x, base, c.y, c.x, top, c.y, a.x, base, a.y, c.x, top, c.y, a.x, top, a.y);
      }
      for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(ring, [])) {
        // Shape is in (x, y=south); flip winding so roofs face up in our x/z frame.
        pos.push(ring[i0].x, top, ring[i0].y, ring[i2].x, top, ring[i2].y, ring[i1].x, top, ring[i1].y);
      }
      this.buildingRanges.push({ start, count: pos.length / 3 - start, heightM: h });
      this.buildingCells.push(this.footprintCells(ring));
    }
    this.buildingRanges.forEach((_, b) => {
      for (const i of this.buildingCells[b]) {
        const list = this.cellBuildings.get(i);
        if (list) list.push(b);
        else this.cellBuildings.set(i, [b]);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const colors = new Uint8Array(pos.length);
    this.buildingColors = new THREE.BufferAttribute(colors, 3, true);
    this.buildingColors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', this.buildingColors);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.buildingMesh = mesh;
    return mesh;
  }

  /** Grid cells whose centres fall inside the footprint (at least the centroid cell). */
  private footprintCells(ring: THREE.Vector2[]): Int32Array {
    const out: number[] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cy = 0;
    for (const v of ring) {
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      cx += v.x;
      cy += v.y;
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.H - 1, Math.ceil(maxY)); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x <= Math.min(this.W - 1, Math.floor(xs[i + 1] - 0.5)); x++) out.push(y * this.W + x);
      }
    }
    if (out.length === 0) {
      const x = Math.min(this.W - 1, Math.max(0, Math.floor(cx / ring.length)));
      const y = Math.min(this.H - 1, Math.max(0, Math.floor(cy / ring.length)));
      out.push(y * this.W + x);
    }
    return Int32Array.from(out);
  }

  private buildLabels(map: MapJSON) {
    // One label per street name, on its longest segment's midpoint.
    const best = new Map<number, { len: number; x: number; y: number; angle: number }>();
    for (const r of map.roads) {
      if (r.n < 0) continue;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const len = Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
        const cur = best.get(r.n);
        if (!cur || len > cur.len) {
          best.set(r.n, { len, x: (r.p[i] + r.p[i + 2]) / 2, y: (r.p[i + 1] + r.p[i + 3]) / 2, angle: 0 });
        }
      }
    }
    for (const [n, b] of best) {
      if (b.len < 8) continue;
      const el = document.createElement('div');
      el.className = 'street-label';
      el.textContent = map.roadNames[n];
      const obj = new CSS2DObject(el);
      obj.position.set(b.x, this.heightAt(b.x, b.y) + 0.4, b.y);
      this.group.add(obj);
      this.labels.push(obj);
    }
  }

  private paintCell(i: number, state: SimState) {
    const k = state.knowledge;
    const o = i * 4;
    const water = this.world.terrain[i] === WATER;
    let rgb = 0;
    let a = 0;
    const blend = (c: readonly [number, number], f = 1) => {
      const alpha = c[1] * f;
      if (alpha <= 0) return;
      const na = a + alpha * (1 - a);
      const t = alpha / na;
      const r = ((rgb >> 16) & 255) * (1 - t) + ((c[0] >> 16) & 255) * t;
      const g = ((rgb >> 8) & 255) * (1 - t) + ((c[0] >> 8) & 255) * t;
      const bl = (rgb & 255) * (1 - t) + (c[0] & 255) * t;
      rgb = (r << 16) | (g << 8) | bl;
      a = na;
    };
    if (!water) {
      const s = k.searched[i];
      const unsearched = Math.max(0, 1 - s / SEARCHED);
      if (!k.known[i]) blend(SCENE.fogUnknown);
      else blend(SCENE.fogUnsearched, unsearched);
      if (state.config.info.population) {
        const p = this.populationAt(i, state);
        if (p > 0) blend(SCENE.population, Math.min(1, p / 4) * (0.35 + 0.65 * unsearched));
      }
      if (k.hazard && k.hazard[i] > 0.05) blend(SCENE.hazard, k.hazard[i] * (0.4 + 0.6 * unsearched));
      if (k.frontier[i]) blend(SCENE.frontier);
    }
    if (this.lastImpacted && this.floodBlend > 0 && state.flood && this.floodMaskAt(i, state)) blend(SCENE.flood, this.floodBlend);
    this.overlayData[o] = (rgb >> 16) & 255;
    this.overlayData[o + 1] = (rgb >> 8) & 255;
    this.overlayData[o + 2] = rgb & 255;
    this.overlayData[o + 3] = Math.round(a * 255);
  }

  private populationAt(i: number, state: SimState): number {
    let p = this.world.population[i];
    if (state.crowds.length) {
      const x = (i % this.W) + 0.5;
      const y = Math.floor(i / this.W) + 0.5;
      for (const c of state.crowds) if ((c.x - x) ** 2 + (c.y - y) ** 2 <= c.radius * c.radius) p += 2.5;
    }
    return p;
  }

  private floodMaskAt(i: number, state: SimState): boolean {
    return !!state.flood && !!this.floodMask && this.floodMask[i] === 1;
  }

  private paintBuildings(state: SimState) {
    if (!this.buildingColors) return;
    const k = state.knowledge;
    const arr = this.buildingColors.array as Uint8Array;
    const cUn = new THREE.Color(SCENE.buildingUnsearched);
    const cDone = new THREE.Color(SCENE.buildingSearched);
    const cTall = new THREE.Color(SCENE.buildingTall);
    const cHaz = new THREE.Color(SCENE.buildingHazard);
    const c = new THREE.Color();
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of this.dirtyBuildings) {
      const cells = this.buildingCells[b];
      let s = 0;
      let hz = 0;
      for (const i of cells) {
        s += Math.min(1, k.searched[i] / SEARCHED);
        if (k.hazard) hz = Math.max(hz, k.hazard[i]);
      }
      s /= cells.length;
      const r = this.buildingRanges[b];
      c.copy(r.heightM > state.config.flightAltitudeM ? cTall : cUn).lerp(cDone, s * s);
      if (hz > 0.05) c.lerp(cHaz, hz * (1 - s) * 0.8);
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
    this.dirtyBuildings.clear();
    this.buildingColors.clearUpdateRanges();
    this.buildingColors.addUpdateRange(lo * 3, (hi - lo) * 3);
    this.buildingColors.needsUpdate = true;
  }
}
