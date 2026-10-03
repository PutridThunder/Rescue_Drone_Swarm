// "Crowd intel" section of the left panel: pick the disaster time, run the online search,
// and see where people are predicted to be (with reasons and sources).

import type { IntelReport, RegionalEvent } from "../intel/types";

export interface IntelPanelCallbacks {
  onTimeChange(at: Date): void;
  onSearchOnline(): void;
}

const LIST_SIZE = 6;
const ARRIVAL_PEAK_MIN = 75; // event shortcuts jump to 75 min before the start (fans travelling)

export class IntelPanel {
  private readonly el: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(
    root: HTMLElement,
    at: Date,
    regional: RegionalEvent[],
    private readonly cb: IntelPanelCallbacks,
  ) {
    this.el = document.createElement("section");
    this.el.className = "intel";
    this.el.innerHTML = `
      <h3>Crowd intel <em>where people are at that moment</em></h3>
      <label class="field"><span>Disaster time</span><input type="datetime-local" id="intel-at"></label>
      <div class="chips" id="intel-chips">
        <button data-at="now">Now</button>
        ${regional
          .filter((ev) => Date.parse(ev.start) > Date.now()) // upcoming only: we plan for the present
          .slice(0, 4)
          .map((ev) => `<button data-at="${new Date(Date.parse(ev.start) - ARRIVAL_PEAK_MIN * 60_000).toISOString()}" title="${escapeHtml(ev.name)} at ${escapeHtml(ev.venue)}">${escapeHtml(shortName(ev.name))}</button>`)
          .join("")}
      </div>
      <div class="row">
        <button class="btn small primary" id="intel-online">Search online</button>
        <span class="status" id="intel-status"></span>
      </div>
      <p class="summary" id="intel-summary"></p>
      <ul class="steps" id="intel-steps"></ul>
      <ol class="hotspots" id="intel-list"></ol>`;
    root.appendChild(this.el);
    this.setTime(at);

    this.q<HTMLInputElement>("#intel-at").addEventListener("change", (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (v) this.cb.onTimeChange(new Date(v));
    });
    this.q("#intel-chips").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const at = b.dataset.at === "now" ? new Date() : new Date(b.dataset.at!);
      this.setTime(at);
      this.cb.onTimeChange(at);
    });
    this.q("#intel-online").addEventListener("click", () => this.cb.onSearchOnline());
  }

  setTime(at: Date) {
    this.q<HTMLInputElement>("#intel-at").value = toLocalInput(at);
  }

  setBusy(message: string) {
    this.q<HTMLButtonElement>("#intel-online").disabled = true;
    this.q("#intel-status").textContent = message;
  }

  setError(message: string) {
    this.q<HTMLButtonElement>("#intel-online").disabled = false;
    this.q("#intel-status").textContent = message;
  }

  setReport(report: IntelReport) {
    this.q<HTMLButtonElement>("#intel-online").disabled = false;
    this.q("#intel-status").textContent = report.mode === "live" ? "Live results" : "Offline data";
    this.q("#intel-summary").textContent = report.summary;
    this.q("#intel-steps").innerHTML = report.steps
      .map((s) => `<li class="${s.status}"><b>${escapeHtml(s.source)}</b> ${escapeHtml(s.detail)}</li>`)
      .join("");
    this.q("#intel-list").innerHTML = report.hotspots
      .slice(0, LIST_SIZE)
      .map(
        (h) => `<li>
          <div class="top"><b>${escapeHtml(h.name)}</b><span>~${h.people.toLocaleString()}</span></div>
          <div class="conf" title="Confidence ${Math.round(h.confidence * 100)}%"><i style="width:${h.confidence * 100}%"></i></div>
          <small>${escapeHtml(h.why)}</small>
          <div class="links">${h.sources
            .slice(0, 2)
            .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title.split(":")[0])}</a>`)
            .join("")}</div>
        </li>`,
      )
      .join("");
  }
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
