// A side panel that slides out of view (collapse button) and back in (edge tab).
// On phones the same panel is shown as a bottom sheet chosen from the tab bar instead.

import { $, h, prefs } from "../dom";
import { icon } from "../icons";
import "./SidePanel.css";

export type Side = "left" | "right";

export class SidePanel {
  readonly el: HTMLElement;
  /** Put the panel's sections here. */
  readonly body: HTMLElement;
  private readonly tab: HTMLButtonElement;
  private readonly prefKey: string;

  constructor(root: HTMLElement, side: Side, title: string, mobileSheet: string) {
    this.prefKey = `panel-${side}-collapsed`;
    const inward = side === "left" ? "chevronLeft" : "chevronRight";
    const outward = side === "left" ? "chevronRight" : "chevronLeft";

    this.el = h("aside", `panel panel-${side} card`);
    this.el.dataset.sheet = mobileSheet;
    this.el.innerHTML = `
      <button class="panel-collapse" title="Hide panel" aria-label="Hide ${title} panel">${icon(inward, 16)}</button>
      <div class="panel-body"></div>`;
    this.body = $(this.el, ".panel-body");

    this.tab = h("button", `panel-tab panel-tab-${side} card`, `${icon(outward, 16)}<span>${title}</span>`);
    this.tab.title = `Show ${title}`;

    root.append(this.el, this.tab);
    $(this.el, ".panel-collapse").addEventListener("click", () => this.setCollapsed(true));
    this.tab.addEventListener("click", () => this.setCollapsed(false));
    this.setCollapsed(prefs.get(this.prefKey, false), false);
  }

  setCollapsed(collapsed: boolean, remember = true) {
    this.el.classList.toggle("collapsed", collapsed);
    this.tab.classList.toggle("shown", collapsed);
    this.el.setAttribute("aria-hidden", String(collapsed));
    if (remember) prefs.set(this.prefKey, collapsed);
  }
}
