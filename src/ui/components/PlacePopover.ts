// Popover for a clicked map spot: street name, coordinates, Google Maps and Street View links.

import { $, h } from "../dom";
import { icon } from "../icons";
import "./PlacePopover.css";

export interface PlaceInfo {
  street: string | null;
  lat: number;
  lon: number;
  clientX: number;
  clientY: number;
}

const EDGE = 12;

export class PlacePopover {
  private readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = h(
      "div",
      "place card",
      `<button class="place-close" title="Close">${icon("close", 14)}</button>
       <div class="place-pin">${icon("pin", 16)}</div>
       <h4></h4><small></small>
       <div class="place-links">
         <a class="btn small" data-link="maps" target="_blank" rel="noopener">${icon("map", 14)} Google Maps</a>
         <a class="btn small" data-link="streetview" target="_blank" rel="noopener">Street View</a>
       </div>`,
    );
    this.el.hidden = true;
    root.appendChild(this.el);
    $(this.el, ".place-close").addEventListener("click", () => this.hide());
  }

  show(p: PlaceInfo) {
    const ll = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    $(this.el, "h4").textContent = p.street ?? "Unnamed spot";
    $(this.el, "small").textContent = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    $<HTMLAnchorElement>(this.el, '[data-link="maps"]').href = `https://www.google.com/maps/search/?api=1&query=${ll}`;
    $<HTMLAnchorElement>(this.el, '[data-link="streetview"]').href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}`;
    this.el.hidden = false;
    // Place next to the click, kept on screen.
    const { offsetWidth: w, offsetHeight: hgt } = this.el;
    this.el.style.left = `${Math.min(window.innerWidth - w - EDGE, Math.max(EDGE, p.clientX + 14))}px`;
    this.el.style.top = `${Math.min(window.innerHeight - hgt - EDGE, Math.max(EDGE, p.clientY - 20))}px`;
  }

  hide() {
    this.el.hidden = true;
  }
}
