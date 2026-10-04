// Area picker under the brand header: your areas (bundled + stored in Snowflake), and a search
// for any place in the world that suggests places while you type. Small places open directly;
// big ones (a city like Tokyo) show a map of fixed parts with the centre part pre-selected.
// A part that doesn't exist yet is built on demand (once; then it's instant for everyone).

import type { Part } from "../../../scripts/lib/worldGrid.mjs";
import type { AreaInfo, PlaceResult } from "../../world/areas";
import { $, delegate, escapeHtml, h } from "../dom";
import { PartsMap } from "./PartsMap";
import "./AreaPicker.css";

export interface AreaPickerCallbacks {
  onSelect(id: string): void;
  search(query: string): Promise<PlaceResult[]>;
  /** Open a map part, building it first if needed. */
  openPart(part: Part): Promise<void>;
}

const LIST_LIMIT = 12;
const TYPE_PAUSE_MS = 220; // wait this long after a keystroke before asking the server

export class AreaPicker {
  private readonly menu: HTMLElement;
  private readonly parts: PartsMap;
  private results: PlaceResult[] = [];
  private busy = false;
  private areas: AreaInfo[];
  private readonly cache = new Map<string, PlaceResult[]>();
  private typing = 0;
  private latest = "";
  private centrePart: Part | null = null;

  constructor(
    private readonly button: HTMLElement,
    areas: AreaInfo[],
    private readonly currentId: string,
    private readonly cb: AreaPickerCallbacks,
  ) {
    this.areas = areas;
    button.querySelector("[data-area-name]")!.textContent = areas.find((a) => a.id === currentId)?.name ?? currentId;
    this.menu = h(
      "div",
      "area-menu card",
      `<h3>Areas <em data-count></em></h3>
       <div class="area-list"></div>
       <h3>Search the world <em>any city or neighbourhood</em></h3>
       <form class="area-search"><input type="search" placeholder="Start typing: Tokyo, Shibuya, Paris…" autocomplete="off" spellcheck="false" required /><button class="btn small primary" type="submit">Go</button></form>
       <div class="area-results"></div>
       <div class="area-parts" hidden>
         <p class="area-parts-title"></p>
         <button class="btn small primary area-parts-centre" type="button">Deploy at the centre</button>
         <div class="area-parts-map"></div>
         <p class="area-parts-hint">Each square is one 2.5 × 2.1 km map. <i class="ready"></i> ready <i></i> built when you pick it</p>
       </div>
       <p class="area-status"></p>`,
    );
    this.menu.hidden = true;
    button.closest(".brand")!.appendChild(this.menu);
    this.parts = new PartsMap($(this.menu, ".area-parts-map"), new Set(areas.map((a) => a.id)), (p) => void this.pick(p));
    this.renderList();

    button.addEventListener("click", () => (this.menu.hidden = !this.menu.hidden));
    delegate(this.menu, "click", "button[data-id]", (b) => {
      if (b.dataset.id !== currentId) cb.onSelect(b.dataset.id!);
    });
    const input = $<HTMLInputElement>(this.menu, ".area-search input");
    // Suggest while typing: local matches at once, places from the server after a short pause.
    input.addEventListener("input", () => {
      clearTimeout(this.typing);
      const query = input.value.trim();
      this.showLocal(query);
      if (query.length >= 2) this.typing = window.setTimeout(() => void this.search(query), TYPE_PAUSE_MS);
    });
    // Enter (or Go): take the top suggestion.
    $(this.menu, ".area-search").addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      clearTimeout(this.typing);
      const local = this.localMatches(query)[0];
      if (local) return cb.onSelect(local.id);
      const results = this.latest === query && this.results.length ? this.results : await this.search(query);
      if (results[0]) this.choose(results[0]);
    });
    $(this.menu, ".area-parts-centre").addEventListener("click", () => this.centrePart && void this.pick(this.centrePart));
    delegate(this.menu, "click", "button[data-result]", (b) => this.choose(this.results[Number(b.dataset.result)]));
    // Close on outside click or Escape (not while a map is being built).
    document.addEventListener("pointerdown", (e) => {
      if (!this.busy && !this.menu.hidden && !this.menu.contains(e.target as Node) && !this.button.contains(e.target as Node)) this.menu.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.busy) this.menu.hidden = true;
    });
  }

  /** Called when Snowflake's list arrives (after the page is already usable). */
  setAreas(areas: AreaInfo[]) {
    this.areas = areas;
    this.parts.setReady(new Set(areas.map((a) => a.id)));
    this.renderList();
  }

  private renderList() {
    $(this.menu, "[data-count]").textContent = String(this.areas.length);
    $(this.menu, ".area-list").innerHTML = this.areas
      .slice(0, LIST_LIMIT)
      .map((a) => `<button data-id="${escapeHtml(a.id)}" class="${a.id === this.currentId ? "on" : ""}">${escapeHtml(a.name)}${a.stored ? "" : " <small>built in</small>"}</button>`)
      .join("");
  }

  private localMatches(query: string): AreaInfo[] {
    const q = query.toLowerCase();
    return q.length < 2 ? [] : this.areas.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 4);
  }

  /** Areas you already have that match: no network, shown on every keystroke. */
  private showLocal(query: string) {
    const local = this.localMatches(query);
    $(this.menu, ".area-results").innerHTML = local
      .map((a) => `<button data-id="${escapeHtml(a.id)}"><b>${escapeHtml(a.name)}</b><span>ready · opens instantly</span></button>`)
      .join("");
  }

  private async search(query: string): Promise<PlaceResult[]> {
    this.latest = query;
    $(this.menu, ".area-parts").hidden = true;
    const cached = this.cache.get(query.toLowerCase());
    if (!cached) this.status("Searching…");
    try {
      const results = cached ?? (await this.cb.search(query));
      this.cache.set(query.toLowerCase(), results);
      if (this.latest !== query) return results; // a newer keystroke won
      this.results = results;
      const local = this.localMatches(query)
        .map((a) => `<button data-id="${escapeHtml(a.id)}"><b>${escapeHtml(a.name)}</b><span>ready · opens instantly</span></button>`)
        .join("");
      $(this.menu, ".area-results").innerHTML = local + (this.results.length
        ? this.results
            .map((r, i) => {
              const n = r.parts.length * (r.parts[0]?.length ?? 0);
              return `<button data-result="${i}"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.label)} · ${escapeHtml(r.type)} · ${n === 1 ? "1 map" : `${n} maps`}</span></button>`;
            })
            .join("")
        : "");
      this.status(this.results.length || local ? "" : `Nothing found for "${query}".`);
      return results;
    } catch (err) {
      if (this.latest === query) this.status((err as Error).message, true);
      return [];
    }
  }

  /** One part: open it. Several: show them on a map to choose from. */
  private choose(place: PlaceResult) {
    const all = place.parts.flat();
    if (all.length === 1) return void this.pick(all[0]);
    $(this.menu, ".area-parts-title").textContent = `${place.name} is ${all.length} maps. Pick the part to search, or:`;
    $(this.menu, ".area-parts").hidden = false;
    // The part containing the place's centre point.
    this.centrePart = all.find((p) => place.lat >= p.bbox[0] && place.lat < p.bbox[2] && place.lon >= p.bbox[1] && place.lon < p.bbox[3]) ?? all[Math.floor(all.length / 2)];
    this.parts.show(place.parts, this.centrePart.id);
    this.status("");
  }

  private async pick(part: Part) {
    if (this.busy) return;
    const ready = this.areas.some((a) => a.id === part.id);
    this.busy = true;
    this.menu.classList.add("is-busy");
    this.status(ready ? "Opening…" : "Building this map from OpenStreetMap (about 20–40 s)…");
    try {
      await this.cb.openPart(part);
    } catch (err) {
      this.status((err as Error).message, true);
      this.busy = false;
      this.menu.classList.remove("is-busy");
    }
  }

  private status(message: string, error = false) {
    const p = $(this.menu, ".area-status");
    p.textContent = message;
    p.classList.toggle("error", error);
  }
}
