const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

class MinHeap {
  items = new Int32Array(1024);
  keys = new Float64Array(1024);
  size = 0;

  clear() {
    this.size = 0;
  }

  push(item: number, key: number) {
    if (this.size === this.items.length) {
      const items = new Int32Array(this.size * 2);
      const keys = new Float64Array(this.size * 2);
      items.set(this.items);
      keys.set(this.keys);
      this.items = items;
      this.keys = keys;
    }
    let i = this.size++;
    const { items, keys } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    const n = --this.size;
    if (n > 0) {
      const item = items[n];
      const key = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        items[i] = items[c];
        keys[i] = keys[c];
        i = c;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }
}

/** Reusable 8-connected grid A* with an octile heuristic. No corner cutting. */
export class AStar {
  private g: Float64Array;
  private parent: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap = new MinHeap();
  lastExpanded = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /**
   * Returns the cell indices from start to goal (inclusive), or null if unreachable.
   * `blocked[i] = 1` cells are impassable; `extraCost[i]` multiplies step cost by (1 + extra).
   */
  find(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    blocked: Uint8Array,
    extraCost: Float32Array | null = null,
  ): number[] | null {
    const w = this.width;
    const h = this.height;
    if (
      tx < 0 ||
      ty < 0 ||
      tx >= w ||
      ty >= h ||
      sx < 0 ||
      sy < 0 ||
      sx >= w ||
      sy >= h
    )
      return null;
    const start = sy * w + sx;
    const goal = ty * w + tx;
    if (blocked[goal]) return null;
    if (start === goal) return [start];

    if (++this.gen === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const { g, parent, seen, closed, heap } = this;
    heap.clear();
    g[start] = 0;
    seen[start] = gen;
    parent[start] = -1;
    heap.push(start, octile(sx, sy, tx, ty));
    let expanded = 0;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      expanded++;
      if (cur === goal) {
        this.lastExpanded = expanded;
        const path: number[] = [];
        for (let c = goal; c !== -1; c = parent[c]) path.push(c);
        return path.reverse();
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const gc = g[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (blocked[ni] || closed[ni] === gen) continue;
        const diag = k >= 4;
        if (diag && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;
        const step = diag ? SQRT2 : 1;
        const ng = gc + (extraCost ? step * (1 + extraCost[ni]) : step);
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          parent[ni] = cur;
          heap.push(ni, ng + octile(nx, ny, tx, ty));
        }
      }
    }
    this.lastExpanded = expanded;
    return null;
  }
}

function octile(x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/** True if the straight segment between two float points crosses no blocked cell. */
export function lineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blocked: Uint8Array,
  width: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const n = Math.ceil(Math.hypot(dx, dy) / 0.25);
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const i = Math.floor(ay + dy * t) * width + Math.floor(ax + dx * t);
    if (blocked[i]) return false;
  }
  return true;
}

/** String-pull a cell path into sparse waypoints (cell centres), excluding the start cell. */
export function smoothPath(
  cells: number[],
  blocked: Uint8Array,
  width: number,
): { x: number; y: number }[] {
  const pts = cells.map((c) => ({
    x: (c % width) + 0.5,
    y: Math.floor(c / width) + 0.5,
  }));
  if (pts.length <= 1) return [];
  const out: { x: number; y: number }[] = [];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = pts[anchor];
    if (!lineOfSight(a.x, a.y, pts[i].x, pts[i].y, blocked, width)) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
