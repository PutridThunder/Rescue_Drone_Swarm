// Map tools along the bottom, with a one-line hint for the active tool.

import { delegate, h } from "../dom";
import { icon, type IconName } from "../icons";
import "./Toolbar.css";

export type Tool = "move" | "survivor" | "crowd" | "erase" | "fail";

const TOOLS: { id: Tool; label: string; icon: IconName; hint: string }[] = [
  { id: "move", label: "Explore", icon: "move", hint: "Drag to pan, scroll to zoom. Click a street to see it on Google Maps, or click a drone to follow it." },
  { id: "survivor", label: "Survivor", icon: "survivor", hint: "Click to hide a survivor. The drones don’t know where they are and have to find them." },
  { id: "crowd", label: "Crowd", icon: "crowd", hint: "Click to report a crowd. With Population intel on, drones prioritise it; a few people are really there." },
  { id: "erase", label: "Erase", icon: "erase", hint: "Click near a survivor or crowd you placed to remove it." },
  { id: "fail", label: "Fail drone", icon: "bolt", hint: "Click a flying drone to knock it out. Watch the fleet take over its block." },
];

export class Toolbar {
  private readonly bar: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(root: HTMLElement, onTool: (tool: Tool) => void) {
    this.bar = h(
      "div",
      "toolbar card",
      TOOLS.map((t) => `<button class="tool" data-tool="${t.id}" title="${t.label}">${icon(t.icon, 20)}<span>${t.label}</span></button>`).join(""),
    );
    this.hint = h("div", "tool-hint");
    root.append(this.bar, this.hint);
    delegate(this.bar, "click", ".tool", (b) => {
      const tool = b.dataset.tool as Tool;
      this.setTool(tool);
      onTool(tool);
    });
  }

  setTool(tool: Tool) {
    this.bar.querySelectorAll<HTMLElement>(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    this.hint.textContent = TOOLS.find((t) => t.id === tool)!.hint;
    document.body.dataset.tool = tool; // map cursor per tool (see base.css)
  }
}
