import type { KnowledgeView } from '../types';

/** Precomputed sensor footprint: offsets within a circle and per-observation detection gain. */
export interface SensorDisc {
  dx: Int16Array;
  dy: Int16Array;
  gain: Float32Array;
}

/** Gain falls off from ~0.3 at the centre to ~0.07 at the edge; repeated observations accumulate. */
export function buildSensorDisc(range: number): SensorDisc {
  const r = Math.max(1, range);
  const ri = Math.ceil(r);
  const dx: number[] = [];
  const dy: number[] = [];
  const gain: number[] = [];
  for (let y = -ri; y <= ri; y++) {
    for (let x = -ri; x <= ri; x++) {
      const d = Math.hypot(x, y);
      if (d > r + 0.01) continue;
      const f = d / (r + 0.5);
      dx.push(x);
      dy.push(y);
      gain.push(0.3 * (1 - 0.75 * f * f));
    }
  }
  return { dx: Int16Array.from(dx), dy: Int16Array.from(dy), gain: Float32Array.from(gain) };
}

/** Fleet-wide shared map plus dirty-cell tracking for the renderer. */
export class Knowledge {
  readonly view: KnowledgeView;
  readonly known: Uint8Array;
  readonly searched: Float32Array;
  readonly frontier: Uint8Array;
  readonly hazardBuf: Float32Array;
  readonly lastObsT: Float32Array;
  readonly lastObsDrone: Int16Array;
  private dirtyMark: Uint8Array;
  private dirty: number[] = [];
  private allDirty = false;

  constructor(readonly size: number) {
    this.known = new Uint8Array(size);
    this.searched = new Float32Array(size);
    this.frontier = new Uint8Array(size);
    this.hazardBuf = new Float32Array(size);
    this.lastObsT = new Float32Array(size).fill(-1e9);
    this.lastObsDrone = new Int16Array(size).fill(-1);
    this.dirtyMark = new Uint8Array(size);
    this.view = { known: this.known, searched: this.searched, frontier: this.frontier, hazard: null };
  }

  markDirty(i: number) {
    if (this.dirtyMark[i]) return;
    this.dirtyMark[i] = 1;
    this.dirty.push(i);
  }

  markAllDirty() {
    this.allDirty = true;
  }

  drain(): number[] {
    let out: number[];
    if (this.allDirty) {
      out = new Array(this.size);
      for (let i = 0; i < this.size; i++) out[i] = i;
      this.allDirty = false;
    } else {
      out = this.dirty;
    }
    for (const i of this.dirty) this.dirtyMark[i] = 0;
    this.dirty = [];
    return out;
  }
}
