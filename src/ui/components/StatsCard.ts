// Headline numbers: area searched, survivors found, lost to the wave, mission time.

import type { SimState } from "../../types";
import { $, h } from "../dom";
import { formatClock, percent } from "../format";
import "./StatsCard.css";

export class StatsCard {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = h(
      "section",
      "stats",
      `<div class="stat wide"><span>Area searched</span><b data-area>0%</b><div class="bar"><i data-area-bar></i></div></div>
       <div class="stat"><span>Survivors found</span><b><span data-found>0</span><small data-total>/ 0</small></b></div>
       <div class="stat stat-lost" hidden><span>Lost to wave</span><b data-lost>0</b></div>
       <div class="stat"><span>Mission time</span><b data-time>00:00</b></div>`,
    );
    root.appendChild(this.el);
  }

  update(state: SimState) {
    const m = state.metrics;
    $(this.el, "[data-area]").textContent = percent(m.areaSearchedFrac);
    $(this.el, "[data-area-bar]").style.width = `${m.areaSearchedFrac * 100}%`;
    $(this.el, "[data-found]").textContent = String(m.survivorsFound);
    $(this.el, "[data-total]").textContent = `/ ${m.survivorsTotal}`;
    $(this.el, "[data-lost]").textContent = String(m.survivorsLost);
    $(this.el, "[data-time]").textContent = formatClock(state.time);
    $(this.el, ".stat-lost").hidden = !state.flood;
  }
}
