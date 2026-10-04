// Short confirmation message at the top of the screen.

import { h } from "../dom";
import "./Toast.css";

const VISIBLE_MS = 2200;

export class Toast {
  private readonly el: HTMLElement;
  private timer = 0;

  constructor(root: HTMLElement) {
    this.el = h("div", "toast");
    root.appendChild(this.el);
  }

  show(message: string) {
    this.el.textContent = message;
    this.el.classList.add("show");
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove("show"), VISIBLE_MS);
  }
}
