// DeepSearch section (mission setup): describe the situation, ask Gemini (via our server) how to
// weight the search, and see the weights it chose, why, and the web sources it used.

import { FACTOR_LABEL, type DeepSearchResult } from "../../intel/deepSearch";
import { $, escapeHtml, h, safeUrl } from "../dom";
import "./DeepSearchPanel.css";

export interface DeepSearchCallbacks {
  onRun(description: string, webSearch: boolean): void;
  onReset(): void;
}

export class DeepSearchPanel {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement, cb: DeepSearchCallbacks) {
    this.el = h(
      "section",
      "deepsearch",
      `<h3>DeepSearch <em>Gemini sets the priorities</em></h3>
       <textarea rows="2" maxlength="300" placeholder="Optional: what happened? e.g. earthquake at 6 pm, concert at the arena, smoke on the waterfront"></textarea>
       <label class="check deepsearch-web"><input type="checkbox"> Search the web for live events <em>(uses more free quota)</em></label>
       <div class="deepsearch-actions">
         <button class="btn primary" data-action="run">Run DeepSearch</button>
         <button class="btn" data-action="reset" hidden>Default weights</button>
       </div>
       <p class="deepsearch-status" hidden></p>
       <div class="deepsearch-result" hidden></div>`,
    );
    root.appendChild(this.el);
    $(this.el, '[data-action="run"]').addEventListener("click", () =>
      cb.onRun($<HTMLTextAreaElement>(this.el, "textarea").value, $<HTMLInputElement>(this.el, ".deepsearch-web input").checked),
    );
    $(this.el, '[data-action="reset"]').addEventListener("click", () => cb.onReset());
  }

  setBusy(busy: boolean) {
    const run = $<HTMLButtonElement>(this.el, '[data-action="run"]');
    run.disabled = busy;
    run.textContent = busy ? "Asking Gemini…" : "Run DeepSearch";
    if (busy) this.status(null);
  }

  /** A message under the buttons (errors in red); null hides it. */
  status(message: string | null, error = false) {
    const p = $(this.el, ".deepsearch-status");
    p.hidden = message === null;
    p.textContent = message ?? "";
    p.classList.toggle("error", error);
  }

  showResult(r: DeepSearchResult) {
    const box = $(this.el, ".deepsearch-result");
    box.hidden = false;
    box.innerHTML = `${r.summary ? `<p class="deepsearch-summary">${escapeHtml(r.summary)}</p>` : ""}
      <ul class="deepsearch-weights">${(Object.keys(FACTOR_LABEL) as (keyof typeof FACTOR_LABEL)[])
        .map((k) => {
          const v = r.weights[k];
          const why = r.reasons[k] ? ` title="${escapeHtml(r.reasons[k]!)}"` : "";
          return `<li${why}><span>${FACTOR_LABEL[k]}</span><i><b style="width:${v * 100}%"></b></i><output>${v.toFixed(1)}</output></li>`;
        })
        .join("")}</ul>
      ${
        r.sources.length
          ? `<div class="deepsearch-sources">${r.sources.map((s) => `<a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`).join("")}</div>`
          : ""
      }`;
    $(this.el, '[data-action="reset"]').hidden = false;
  }

  clearResult() {
    $(this.el, ".deepsearch-result").hidden = true;
    $(this.el, '[data-action="reset"]').hidden = true;
  }
}
