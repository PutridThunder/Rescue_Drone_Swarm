// "Satellite data" section: which open Earth-observation datasets this area was built from,
// with licence and image date. Hidden when the area has no eo.json.

import type { EarthObservation } from "../../types";
import { escapeHtml, h, safeUrl } from "../dom";
import "./DataSources.css";

export class DataSources {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = h("section", "data-sources");
    this.el.hidden = true;
    root.appendChild(this.el);
  }

  show(sources: EarthObservation["sources"]) {
    this.el.hidden = sources.length === 0;
    this.el.innerHTML = `<h3>Satellite data <em>built offline by the Python pipeline</em></h3>
      <ul>${sources
        .map((s) => {
          const detail = [s.license, s.date && `image ${s.date}`, s.cloudCover != null && `${s.cloudCover.toFixed(1)}% cloud`].filter(Boolean).join(" · ");
          return `<li><a href="${safeUrl(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a><small>${escapeHtml(detail)}</small></li>`;
        })
        .join("")}</ul>`;
  }
}
