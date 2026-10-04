// "What the drones are deciding": the newest simulation events, in plain language.

import type { SimEvent } from "../../types";
import { droneColorCss } from "../../render/scene/palette";
import { h } from "../dom";
import { formatClock } from "../format";
import "./DecisionFeed.css";

/** Routine events (replans, finished blocks, recharges) are left out to keep the feed readable. */
const SHOWN: ReadonlySet<SimEvent["type"]> = new Set(["assign", "reassign", "survivor", "failure", "lowBattery", "truck", "impact", "complete", "placed"]);
const MAX_ROWS = 60;

export class DecisionFeed {
  private readonly list: HTMLElement;

  constructor(root: HTMLElement) {
    const section = h("section", "feed-section", `<h3>What the drones are deciding</h3>`);
    this.list = h("div", "feed");
    section.appendChild(this.list);
    root.appendChild(section);
  }

  add(events: SimEvent[]) {
    for (const e of events) {
      if (!SHOWN.has(e.type)) continue;
      const row = h("div", `feed-row feed-${e.type}`);
      const dot = h("i", "dot");
      if (e.droneId) dot.style.background = droneColorCss(e.droneId);
      const text = h("div", "", `<p></p><time>${formatClock(e.t)}</time>`);
      text.querySelector("p")!.textContent = e.message;
      row.append(dot, text);
      this.list.prepend(row);
    }
    while (this.list.children.length > MAX_ROWS) this.list.lastElementChild!.remove();
  }

  clear() {
    this.list.innerHTML = "";
  }
}
