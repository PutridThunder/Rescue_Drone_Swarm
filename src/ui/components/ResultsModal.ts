// End-of-mission summary.

import type { Metrics } from "../../types";
import { $, h } from "../dom";
import { formatClock, percent } from "../format";
import { icon } from "../icons";
import "./ResultsModal.css";

export class ResultsModal {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement, onRunAgain: () => void) {
    this.el = h(
      "div",
      "modal",
      `<div class="card">
         <h2>Search complete</h2>
         <div class="results-grid"></div>
         <div class="results-actions">
           <button class="btn" data-action="close">Keep looking</button>
           <button class="btn primary" data-action="again">${icon("reset", 16)} Run again</button>
         </div>
       </div>`,
    );
    this.el.hidden = true;
    root.appendChild(this.el);
    $(this.el, '[data-action="close"]').addEventListener("click", () => this.hide());
    $(this.el, '[data-action="again"]').addEventListener("click", onRunAgain);
  }

  show(m: Metrics, tsunami: boolean) {
    const rows: [string, string][] = [
      ["Area searched", percent(m.areaSearchedFrac)],
      ["Survivors found", `${m.survivorsFound} / ${m.survivorsTotal}`],
      ...(tsunami ? ([["Lost to the wave", String(m.survivorsLost)]] as [string, string][]) : []),
      ["Mission time", formatClock(m.time)],
      ["Drone failures", String(m.droneFailures)],
      ["Duplicate search", percent(m.redundancyFrac)],
    ];
    $(this.el, ".results-grid").innerHTML = rows.map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join("");
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }
}
