// Area picker under the brand header: switch between bundled areas, or import a new one by
// place name (dev server only: it downloads map data and builds the area).

import type { AreaInfo } from "../../world/areas";
import { $, delegate, escapeHtml, h } from "../dom";
import "./AreaPicker.css";

export interface AreaPickerCallbacks {
  onSelect(id: string): void;
  onImport(query: string): void;
}

export class AreaPicker {
  private readonly menu: HTMLElement;

  constructor(
    private readonly button: HTMLElement,
    areas: AreaInfo[],
    currentId: string,
    cb: AreaPickerCallbacks,
  ) {
    button.querySelector("[data-area-name]")!.textContent = areas.find((a) => a.id === currentId)?.name ?? currentId;
    this.menu = h(
      "div",
      "area-menu card",
      `<h3>Areas</h3>
       <div class="area-list">${areas
         .map((a) => `<button data-id="${escapeHtml(a.id)}" class="${a.id === currentId ? "on" : ""}">${escapeHtml(a.name)}</button>`)
         .join("")}</div>
       <h3>Import an area <em>needs internet</em></h3>
       <form class="area-import"><input type="text" placeholder="e.g. Kitsilano, Vancouver" required /><button class="btn small primary" type="submit">Import</button></form>
       <p class="area-status"></p>`,
    );
    this.menu.hidden = true;
    button.closest(".brand")!.appendChild(this.menu);

    button.addEventListener("click", () => (this.menu.hidden = !this.menu.hidden));
    delegate(this.menu, "click", "button[data-id]", (b) => {
      if (b.dataset.id !== currentId) cb.onSelect(b.dataset.id!);
    });
    $(this.menu, ".area-import").addEventListener("submit", (e) => {
      e.preventDefault();
      const query = $<HTMLInputElement>(this.menu, ".area-import input").value.trim();
      if (query) cb.onImport(query);
    });
    // Close on outside click or Escape.
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.button.contains(e.target as Node)) this.menu.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.menu.hidden = true;
    });
  }

  setStatus(message: string, busy = false) {
    $(this.menu, ".area-status").textContent = message;
    $<HTMLButtonElement>(this.menu, ".area-import button").disabled = busy;
  }
}
