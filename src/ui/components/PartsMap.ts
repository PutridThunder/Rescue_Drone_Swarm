// A small map (OpenStreetMap tiles) with a city's map parts drawn as a clickable grid. Parts
// that already exist are tinted. Web Mercator maths only, no map library.

import type { Part } from "../../../scripts/lib/worldGrid.mjs";
import { h } from "../dom";
import "./PartsMap.css";

const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const mercX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const mercY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

export class PartsMap {
  constructor(
    private readonly root: HTMLElement,
    private ready: Set<string>,
    private readonly onPick: (part: Part) => void,
  ) {}

  setReady(ready: Set<string>) {
    this.ready = ready;
  }

  /** Draw the grid; `highlight` marks the suggested part (the place's centre). */
  show(rows: Part[][], highlight?: string) {
    const all = rows.flat();
    const S = Math.min(...all.map((p) => p.bbox[0]));
    const W = Math.min(...all.map((p) => p.bbox[1]));
    const N = Math.max(...all.map((p) => p.bbox[2]));
    const E = Math.max(...all.map((p) => p.bbox[3]));
    const width = this.root.clientWidth || 280;
    // Deepest zoom at which the whole grid fits the box's width.
    let z = 17;
    while (z > 1 && mercX(E, z) - mercX(W, z) > width) z--;
    const x0 = mercX(W, z);
    const y0 = mercY(N, z);
    const height = Math.ceil(mercY(S, z) - y0);
    this.root.style.height = `${height}px`;
    this.root.innerHTML = "";

    // Tiles behind the grid.
    const layer = h("div", "parts-tiles");
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + height) / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + width) / TILE); tx++) {
        const img = document.createElement("img");
        img.src = TILE_URL(z, tx, ty);
        img.alt = "";
        img.style.left = `${tx * TILE - x0}px`;
        img.style.top = `${ty * TILE - y0}px`;
        layer.appendChild(img);
      }
    }
    this.root.appendChild(layer);

    rows.forEach((row, r) =>
      row.forEach((part, c) => {
        const [s, w, n, e] = part.bbox;
        const label = `${LETTERS[c] ?? c + 1}${r + 1}`;
        const cell = h("button", `parts-cell${this.ready.has(part.id) ? " ready" : ""}${part.id === highlight ? " centre" : ""}`, `<span>${label}</span>`);
        cell.title = `Part ${label}${this.ready.has(part.id) ? " (ready)" : ""}`;
        Object.assign(cell.style, {
          left: `${mercX(w, z) - x0}px`,
          top: `${mercY(n, z) - y0}px`,
          width: `${mercX(e, z) - mercX(w, z)}px`,
          height: `${mercY(s, z) - mercY(n, z)}px`,
        });
        cell.addEventListener("click", () => this.onPick(part));
        this.root.appendChild(cell);
      }),
    );
    this.root.appendChild(h("small", "parts-credit", "© OpenStreetMap contributors"));
  }
}
