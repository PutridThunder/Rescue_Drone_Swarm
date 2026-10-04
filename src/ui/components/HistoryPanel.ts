// "Results history" section (left panel): what Snowflake has stored: how the algorithm fares
// against people in the challenge, mission averages per area, and the latest runs. Hidden until
// Snowflake answers, so it never shows on a deployment without it.

import type { History } from "../../data/records";
import { escapeHtml, h } from "../dom";
import { formatClock } from "../format";
import "./HistoryPanel.css";

export class HistoryPanel {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = h("section", "history");
    this.el.hidden = true;
    root.appendChild(this.el);
  }

  /** null hides the section (Snowflake not set up or offline). */
  show(data: History | null) {
    this.el.hidden = data === null;
    if (!data) return;
    const { games, missions } = data;
    const decided = games.algorithmWins + games.humanWins;
    this.el.innerHTML = `<h3>Results history <em>stored in Snowflake</em></h3>
      ${
        games.count
          ? `<div class="history-score"><b>${games.algorithmWins}</b><span>algorithm wins</span><i>vs</i><b class="human">${games.humanWins}</b><span>human wins</span></div>
             <p class="history-note">${games.count} challenge games${decided ? ` · algorithm won ${Math.round((games.algorithmWins / decided) * 100)}% of decided games` : ""} · found ${games.aiFound} survivors vs ${games.humanFound}</p>`
          : `<p class="history-note">No challenge games yet. Press Challenge and fly against the algorithm.</p>`
      }
      ${
        missions.count
          ? `<p class="history-note">${missions.count} missions · average ${formatClock(missions.avgDurationS)} · ${Math.round(missions.avgAreaSearched * 100)}% searched · ${missions.survivorsFound}/${missions.survivorsTotal} survivors found</p>
             <ul class="history-areas">${data.byArea.map((a) => `<li><span>${escapeHtml(a.area)}</span><b>${formatClock(a.avgDurationS)}</b><small>${a.count}× · ${Math.round(a.avgFoundShare * 100)}% found</small></li>`).join("")}</ul>`
          : ""
      }
      ${data.recent.length ? `<ul class="history-recent">${data.recent.map((r) => `<li><span>${r.kind === "game" ? "🎮" : "🛸"} ${escapeHtml(r.area)}</span><small>${escapeHtml(r.summary)}</small></li>`).join("")}</ul>` : ""}`;
  }
}
