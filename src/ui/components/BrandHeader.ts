// Title card with the current area; the area name opens the area picker.

import { $, h } from "../dom";
import { icon } from "../icons";
import "./BrandHeader.css";

export class BrandHeader {
  readonly el: HTMLElement;
  /** The clickable area name (the area picker attaches to it). */
  readonly areaButton: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.el = h(
      "header",
      "brand card",
      `<div class="brand-logo">${icon("bolt", 16)}</div>
       <div><h1>Rescue Drone Swarm</h1><button class="brand-area" title="Change area"><span data-area-name></span> ▾</button></div>`,
    );
    root.appendChild(this.el);
    this.areaButton = $(this.el, ".brand-area");
  }
}
