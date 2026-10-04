// Area picker under the brand header: switch between the areas that ship with the website.

import type { AreaInfo } from "../../world/areas";
import { delegate, escapeHtml, h } from "../dom";
import "./AreaPicker.css";

export class AreaPicker {
  private readonly menu: HTMLElement;

  constructor(
    private readonly button: HTMLElement,
    areas: AreaInfo[],
    currentId: string,
    onSelect: (id: string) => void,
  ) {
    button.querySelector("[data-area-name]")!.textContent = areas.find((a) => a.id === currentId)?.name ?? currentId;
    this.menu = h(
      "div",
      "area-menu card",
      `<h3>Areas</h3>
       <div class="area-list">${areas
         .map((a) => `<button data-id="${escapeHtml(a.id)}" class="${a.id === currentId ? "on" : ""}">${escapeHtml(a.name)}</button>`)
         .join("")}</div>`,
    );
    this.menu.hidden = true;
    button.closest(".brand")!.appendChild(this.menu);

    button.addEventListener("click", () => (this.menu.hidden = !this.menu.hidden));
    delegate(this.menu, "click", "button[data-id]", (b) => {
      if (b.dataset.id !== currentId) onSelect(b.dataset.id!);
    });
    // Close on outside click or Escape.
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.button.contains(e.target as Node)) this.menu.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.menu.hidden = true;
    });
  }
}
