// Area picker under the brand header: switch between ready-made areas or import a new one by
// typing a place name (the dev server geocodes it and builds the map).

import type { AreaInfo } from "../world/areas";

export interface AreaPickerCallbacks {
  onSelect(id: string): void;
  onImport(query: string): void;
}

export class AreaPicker {
  private readonly menu: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.menu.querySelector(sel) as T;

  constructor(button: HTMLElement, areas: AreaInfo[], currentId: string, private readonly cb: AreaPickerCallbacks) {
    const current = areas.find((a) => a.id === currentId);
    button.querySelector("[data-area-name]")!.textContent = current?.name ?? currentId;

    this.menu = document.createElement("div");
    this.menu.className = "area-menu card";
    this.menu.hidden = true;
    this.menu.innerHTML = `
      <h3>Areas</h3>
      <div class="area-list">
        ${areas
          .map((a) => `<button data-id="${a.id}" class="${a.id === currentId ? "on" : ""}">${escapeHtml(a.name)}</button>`)
          .join("")}
      </div>
      <h3>Import an area <em>needs internet</em></h3>
      <form class="area-import">
        <input type="text" placeholder="e.g. Metrotown, Burnaby" required />
        <button class="btn small primary" type="submit">Import</button>
      </form>
      <p class="area-status"></p>`;
    button.closest(".brand")!.appendChild(this.menu);

    button.addEventListener("click", () => (this.menu.hidden = !this.menu.hidden));
    this.q(".area-list").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (b && b.dataset.id !== currentId) this.cb.onSelect(b.dataset.id!);
    });
    this.q<HTMLFormElement>(".area-import").addEventListener("submit", (e) => {
      e.preventDefault();
      const query = this.q<HTMLInputElement>(".area-import input").value.trim();
      if (query) this.cb.onImport(query);
    });
  }

  setStatus(message: string, busy = false) {
    this.q(".area-status").textContent = message;
    this.q<HTMLButtonElement>(".area-import button").disabled = busy;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
