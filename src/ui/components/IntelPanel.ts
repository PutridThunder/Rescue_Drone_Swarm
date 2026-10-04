// Crowd intel section: pick the disaster time and see where people are predicted to be,
// with the reasoning and source for each hotspot. Fully offline.

import type { IntelReport, RegionalEvent } from "../../intel/types";
import { $, delegate, escapeHtml, h, safeUrl } from "../dom";
import { toDateTimeLocal } from "../format";
import "./IntelPanel.css";

const LIST_SIZE = 6;
const ARRIVAL_PEAK_MIN = 75; // event shortcuts jump to 75 min before the start (fans travelling)
const SHORTCUTS = 4;

export class IntelPanel {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement, at: Date, events: RegionalEvent[], onTimeChange: (at: Date) => void) {
    const upcoming = events.filter((ev) => Date.parse(ev.start) > Date.now()).slice(0, SHORTCUTS);
    this.el = h(
      "section",
      "intel",
      `<h3>Crowd intel <em>where people are at that moment</em></h3>
       <label class="intel-time"><span>Disaster time</span><input type="datetime-local"></label>
       <div class="intel-shortcuts">
         <button data-at="now">Now</button>
         ${upcoming
           .map((ev) => {
             const at = new Date(Date.parse(ev.start) - ARRIVAL_PEAK_MIN * 60_000).toISOString();
             const name = ev.name.length > 28 ? `${ev.name.slice(0, 27)}…` : ev.name;
             return `<button data-at="${at}" title="${escapeHtml(ev.name)} at ${escapeHtml(ev.venue)}">${escapeHtml(name)}</button>`;
           })
           .join("")}
       </div>
       <p class="intel-summary"></p>
       <ol class="intel-hotspots"></ol>`,
    );
    root.appendChild(this.el);
    this.setTime(at);

    $<HTMLInputElement>(this.el, "input").addEventListener("change", (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (v) onTimeChange(new Date(v));
    });
    delegate(this.el, "click", ".intel-shortcuts button", (b) => {
      const at = b.dataset.at === "now" ? new Date() : new Date(b.dataset.at!);
      this.setTime(at);
      onTimeChange(at);
    });
  }

  setTime(at: Date) {
    $<HTMLInputElement>(this.el, "input").value = toDateTimeLocal(at);
  }

  setReport(report: IntelReport) {
    $(this.el, ".intel-summary").textContent = report.summary;
    $(this.el, ".intel-hotspots").innerHTML = report.hotspots
      .slice(0, LIST_SIZE)
      .map(
        (spot) => `<li>
          <div class="intel-row"><b>${escapeHtml(spot.name)}</b><span>~${spot.people.toLocaleString()}</span></div>
          <div class="intel-confidence" title="Confidence ${Math.round(spot.confidence * 100)}%"><i style="width:${spot.confidence * 100}%"></i></div>
          <small>${escapeHtml(spot.why)}</small>
          <div class="intel-links">${spot.sources
            .slice(0, 2)
            .map((s) => `<a href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener">${escapeHtml(s.title.split(":")[0])}</a>`)
            .join("")}</div>
        </li>`,
      )
      .join("");
  }
}
