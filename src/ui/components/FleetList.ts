// One row per drone: colour, what it's doing, battery. Click a row to follow that drone.

import type { DroneView, SimState } from "../../types";
import { droneColorCss } from "../../render/scene/palette";
import { delegate, h } from "../dom";
import "./FleetList.css";

const STATUS: Record<DroneView["status"], string> = {
  IDLE: "Ready",
  TRAVELLING: "Flying to",
  SEARCHING: "Searching",
  RETURNING: "Returning to truck",
  LOW_BATTERY: "Low battery → truck",
  CHARGING: "Charging",
  MANUAL: "Piloted by you",
  DISABLED: "Down",
};
const LOW_BATTERY_PCT = 25;

export class FleetList {
  private readonly list: HTMLElement;
  private following: number | null = null;
  private renderedKey = "";

  constructor(root: HTMLElement, onSelect: (droneId: number) => void) {
    const section = h("section", "", `<h3>Fleet <em>click to follow</em></h3>`);
    this.list = h("div", "fleet");
    section.appendChild(this.list);
    root.appendChild(section);
    delegate(this.list, "click", "[data-drone]", (row) => onSelect(Number(row.dataset.drone)));
  }

  setFollowing(id: number | null) {
    this.following = id;
    this.renderedKey = "";
  }

  update(state: SimState) {
    const labels = new Map(state.tasks.map((t) => [t.id, t.label]));
    const rows = state.drones.map((d) => ({ d, text: describe(d, labels), battery: Math.round(d.battery * 100) }));
    // Re-render only when something visible changed (battery in 5% steps).
    const key = rows.map((r) => `${r.d.id}${r.text}${Math.round(r.battery / 5)}`).join("|") + this.following;
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.list.innerHTML = rows
      .map(({ d, battery }) => {
        const cls = d.status === "DISABLED" ? "down" : battery < LOW_BATTERY_PCT ? "low" : "";
        return `<button class="fleet-row ${cls} ${this.following === d.id ? "following" : ""}" data-drone="${d.id}">
          <i class="dot" style="background:${droneColorCss(d.id)}"></i><b>D${d.id}</b><span class="fleet-status"></span>
          <span class="fleet-battery"><i style="width:${battery}%"></i></span>
        </button>`;
      })
      .join("");
    this.list.querySelectorAll(".fleet-status").forEach((el, i) => (el.textContent = rows[i].text));
  }
}

function describe(d: DroneView, labels: Map<number, string>): string {
  const target = d.taskId != null ? (labels.get(d.taskId) ?? "") : "";
  if (d.dockedTruck !== null && d.status !== "CHARGING") return `On Truck ${d.dockedTruck}${target ? ` · next: ${target}` : ""}`;
  if (d.status === "SEARCHING" || d.status === "TRAVELLING") return `${STATUS[d.status]} ${target}`.trim();
  if (d.status === "CHARGING" && d.dockedTruck !== null) return `Charging on Truck ${d.dockedTruck}`;
  return STATUS[d.status];
}
