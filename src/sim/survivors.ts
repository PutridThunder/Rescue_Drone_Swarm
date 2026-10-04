import type { SurvivorView } from "../types";
import type { SimContext } from "./context";

/** Ground-truth survivors (hidden from the fleet), indexed by cell for fast detection checks. */
export class SurvivorRegistry {
  private readonly occupied: Uint8Array;
  private readonly byCell = new Map<number, SurvivorView[]>();
  private nextId: number;

  constructor(
    private readonly ctx: SimContext,
    /** Shared with state.survivors (the renderer reads it). */
    readonly list: SurvivorView[],
  ) {
    this.occupied = new Uint8Array(ctx.N);
    this.nextId = list.length + 1;
    for (const s of list) this.index(s);
  }

  /** Survivors in cell `i`, or undefined if the cell is empty. */
  at(i: number): SurvivorView[] | undefined {
    return this.occupied[i] ? this.byCell.get(i) : undefined;
  }

  /** Plant a survivor the user (or a crowd) places. Null if the spot isn't searchable. */
  add(x: number, y: number): SurvivorView | null {
    const i = this.ctx.cellIndex(x, y);
    if (i < 0 || !this.ctx.isSearchable(i)) return null;
    if (this.ctx.state.flood?.impacted && this.ctx.tsunami.floodMask?.[i]) return null; // already under water
    const s: SurvivorView = { id: this.nextId++, x, y, found: false, foundBy: null, foundAt: null, lost: false, placed: true };
    this.list.push(s);
    this.index(s);
    this.ctx.state.metrics.survivorsTotal++;
    return s;
  }

  /** Remove user-placed survivors (not yet found) within sqrt(r2) cells. Returns how many. */
  removePlacedNear(x: number, y: number, r2: number): number {
    let removed = 0;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const s = this.list[k];
      if (!s.placed || s.found || s.lost || (s.x - x) ** 2 + (s.y - y) ** 2 > r2) continue;
      const i = this.ctx.cellIndex(s.x, s.y);
      const rest = this.byCell.get(i)!.filter((o) => o !== s);
      if (rest.length) this.byCell.set(i, rest);
      else {
        this.byCell.delete(i);
        this.occupied[i] = 0;
      }
      this.list.splice(k, 1);
      this.ctx.state.metrics.survivorsTotal--;
      removed++;
    }
    return removed;
  }

  private index(s: SurvivorView) {
    const i = Math.floor(s.y) * this.ctx.W + Math.floor(s.x);
    this.occupied[i] = 1;
    const list = this.byCell.get(i);
    if (list) list.push(s);
    else this.byCell.set(i, [s]);
  }
}
