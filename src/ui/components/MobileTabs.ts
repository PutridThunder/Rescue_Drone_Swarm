// Phones: a bottom tab bar that switches between the map and the two panels (as bottom sheets).

import { delegate, h } from "../dom";
import "./MobileTabs.css";

const TABS: [sheet: string, label: string][] = [
  ["", "Map"],
  ["setup", "Setup"],
  ["live", "Live"],
];

export class MobileTabs {
  constructor(root: HTMLElement) {
    const el = h("nav", "mobile-tabs", TABS.map(([sheet, label], i) => `<button data-sheet="${sheet}" class="${i === 0 ? "on" : ""}">${label}</button>`).join(""));
    root.appendChild(el);
    delegate(el, "click", "button", (b) => {
      document.body.dataset.sheet = b.dataset.sheet ?? "";
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
  }
}
