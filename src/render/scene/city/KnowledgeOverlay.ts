// A transparent texture over the terrain (one texel per cell) showing what the fleet knows:
// fog where nothing is known, a grey veil where unsearched, blue frontier, red hazard, orange
// population (when that intel is on), and the flood after a tsunami.

import * as THREE from "three";
import { Terrain } from "../../../shared/terrain";
import type { CrowdView, SimState, World } from "../../../types";
import { SCENE } from "../palette";

const SEARCHED = 0.8; // same threshold as the simulation
const FLOOD_FADE_S = 2; // the flood spreads over this many seconds after impact
const POPULATION_FULL = 4; // people per cell for full population tint
const CROWD_BOOST = 2.5; // extra people per cell drawn for a reported crowd

type Tint = readonly [color: number, alpha: number];

export class KnowledgeOverlay {
  readonly mesh: THREE.Mesh;
  private readonly data: Uint8Array;
  private readonly texture: THREE.DataTexture;
  private readonly N: number;
  private readonly crowdBoost: Float32Array;
  private floodMask: Uint8Array | null = null;
  private floodBlend = 0;
  // Last-seen settings; a change means every cell must be repainted.
  private knowledgeRef: unknown = null;
  private populationOn = false;
  private hazardOn = false;
  private impacted = false;
  private crowdsKey = "";
  private readonly texel = { r: 0, g: 0, b: 0, a: 0 };

  constructor(
    private readonly world: World,
    terrainGeometry: THREE.BufferGeometry,
  ) {
    const { width: W, height: H } = world.meta;
    this.N = W * H;
    this.crowdBoost = new Float32Array(this.N);
    this.data = new Uint8Array(this.N * 4);
    this.texture = new THREE.DataTexture(this.data, W, H, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.flipY = false;
    this.mesh = new THREE.Mesh(
      terrainGeometry,
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    this.mesh.renderOrder = 2;
  }

  setFloodMask(mask: Uint8Array | null) {
    this.floodMask = mask;
  }

  /** Repaint changed cells. Returns true if everything was repainted (so buildings should too). */
  update(state: SimState, dirty: number[], dt: number): boolean {
    let all = this.syncSettings(state);
    if (state.flood?.impacted && this.floodBlend < 1) {
      this.floodBlend = Math.min(1, this.floodBlend + dt / FLOOD_FADE_S);
      all = true;
    }
    if (all) for (let i = 0; i < this.N; i++) this.paint(i, state);
    else for (const i of dirty) this.paint(i, state);
    if (all || dirty.length) this.texture.needsUpdate = true;
    return all;
  }

  /** Detect setting changes that require a full repaint. */
  private syncSettings(state: SimState): boolean {
    const k = state.knowledge;
    const populationOn = state.config.info.population;
    const hazardOn = k.hazard !== null;
    const impacted = !!state.flood?.impacted;
    const crowdsKey = state.crowds.map((c) => c.id).join(",");
    let changed = false;
    if (k !== this.knowledgeRef || populationOn !== this.populationOn || hazardOn !== this.hazardOn) changed = true;
    if (impacted !== this.impacted) {
      this.floodBlend = 0;
      changed = true;
    }
    if (crowdsKey !== this.crowdsKey) {
      this.rebuildCrowdBoost(state.crowds);
      changed = true;
    }
    this.knowledgeRef = k;
    this.populationOn = populationOn;
    this.hazardOn = hazardOn;
    this.impacted = impacted;
    this.crowdsKey = crowdsKey;
    return changed;
  }

  private rebuildCrowdBoost(crowds: CrowdView[]) {
    const { width: W, height: H } = this.world.meta;
    this.crowdBoost.fill(0);
    for (const c of crowds) {
      for (let y = Math.max(0, Math.floor(c.y - c.radius)); y <= Math.min(H - 1, Math.floor(c.y + c.radius)); y++) {
        for (let x = Math.max(0, Math.floor(c.x - c.radius)); x <= Math.min(W - 1, Math.floor(c.x + c.radius)); x++) {
          if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 <= c.radius * c.radius) this.crowdBoost[y * W + x] += CROWD_BOOST;
        }
      }
    }
  }

  /** Blend the tints that apply to cell i into one RGBA texel (allocation-free: runs per cell). */
  private paint(i: number, state: SimState) {
    const k = state.knowledge;
    this.texel.r = this.texel.g = this.texel.b = this.texel.a = 0;
    if (this.world.terrain[i] !== Terrain.Water) {
      const unsearched = Math.max(0, 1 - k.searched[i] / SEARCHED);
      if (!k.known[i]) this.blend(SCENE.fogUnknown, 1);
      else this.blend(SCENE.fogUnsearched, unsearched);
      if (this.populationOn) {
        const people = this.world.population[i] + this.crowdBoost[i];
        if (people > 0) this.blend(SCENE.population, Math.min(1, people / POPULATION_FULL) * (0.35 + 0.65 * unsearched));
      }
      if (k.hazard && k.hazard[i] > 0.05) this.blend(SCENE.hazard, k.hazard[i] * (0.4 + 0.6 * unsearched));
      if (k.frontier[i]) this.blend(SCENE.frontier, 1);
    }
    if (this.impacted && this.floodBlend > 0 && this.floodMask?.[i]) this.blend(SCENE.flood, this.floodBlend);
    const o = i * 4;
    this.data[o] = this.texel.r;
    this.data[o + 1] = this.texel.g;
    this.data[o + 2] = this.texel.b;
    this.data[o + 3] = Math.round(this.texel.a * 255);
  }

  /** Composite one tint over the current texel ("over" operator). */
  private blend([color, alpha]: Tint, strength: number) {
    const t = alpha * strength;
    if (t <= 0) return;
    const px = this.texel;
    const next = px.a + t * (1 - px.a);
    const w = t / next;
    px.r = px.r * (1 - w) + ((color >> 16) & 255) * w;
    px.g = px.g * (1 - w) + ((color >> 8) & 255) * w;
    px.b = px.b * (1 - w) + (color & 255) * w;
    px.a = next;
  }
}
