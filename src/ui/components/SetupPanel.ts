// Mission setup (left panel): scenario, what the drones know, crowd intel, fleet size, advanced.
// Reflects the app's config; every change goes back through callbacks (the app owns the config).

import type { InfoModes, Scenario, SimConfig, Weights } from "../../types";
import { $, delegate, h } from "../dom";
import "./SetupPanel.css";

export interface SetupCallbacks {
  onScenario(s: Scenario): void;
  onInfo(info: Partial<InfoModes>): void;
  /** Fleet and advanced settings: these restart the mission. */
  onSetup(partial: Partial<SimConfig>): void;
  onWeights(w: Partial<Weights>): void;
}

type NumericKey = "droneCount" | "truckCount" | "survivorCount" | "flightAltitudeM" | "sensorRange" | "batteryCapacity";

const SWITCHES: [keyof InfoModes, string, string][] = [
  ["geography", "Street map", "Buildings and streets known in advance"],
  ["population", "Population", "Where people live, plus crowds you report"],
  ["disaster", "Hazard warning", "Tsunami flood zone and countdown"],
  ["crowds", "Crowd intel", "Busy places and scheduled events"],
];

const STEPPERS: [NumericKey, string, number, number, number][] = [
  ["droneCount", "Drones", 1, 12, 1],
  ["truckCount", "Charging trucks", 1, 4, 1],
  ["survivorCount", "Random survivors", 0, 60, 5],
];

const SLIDERS: [NumericKey, string, number, number, number, (v: number) => string][] = [
  ["flightAltitudeM", "Flight altitude", 10, 60, 5, (v) => `${v} m`],
  ["sensorRange", "Camera range", 2, 8, 1, (v) => `${v * 10} m`],
  ["batteryCapacity", "Battery", 500, 3000, 100, (v) => `${(v / 100).toFixed(0)} km`],
];

const WEIGHTS: [keyof Weights, string][] = [
  ["population", "Population"],
  ["hazard", "Hazard"],
  ["urgency", "Urgency"],
  ["information", "Unsearched area"],
  ["distance", "Distance cost"],
  ["battery", "Battery cost"],
  ["redundancy", "Avoid overlap"],
];

export class SetupPanel {
  /** Where the crowd intel section is mounted. */
  readonly intelSlot: HTMLElement;
  private config: SimConfig;

  constructor(
    private readonly root: HTMLElement,
    config: SimConfig,
    private readonly cb: SetupCallbacks,
  ) {
    this.config = config;
    root.append(
      h(
        "section",
        "",
        `<h3>Scenario</h3>
         <div class="seg wide setup-scenario">
           <button data-scenario="none">Search &amp; rescue</button>
           <button data-scenario="tsunami">Tsunami warning</button>
         </div>`,
      ),
      h(
        "section",
        "",
        `<h3>What the drones know</h3>${SWITCHES.map(
          ([k, label, desc]) => `<label class="switch" data-info="${k}"><input type="checkbox"><i></i><div><b>${label}</b><span>${desc}</span></div></label>`,
        ).join("")}`,
      ),
    );
    this.intelSlot = h("div", "setup-intel");
    root.append(
      this.intelSlot,
      h(
        "section",
        "",
        `<h3>Fleet <em>changes restart the mission</em></h3>${STEPPERS.map(
          ([k, label]) => `<div class="stepper" data-key="${k}"><span>${label}</span><button data-d="-1">−</button><output></output><button data-d="1">+</button></div>`,
        ).join("")}`,
      ),
      h(
        "details",
        "",
        `<summary>Advanced</summary>
         ${SLIDERS.map(
           ([k, label, min, max, step]) =>
             `<label class="slider"><span>${label}</span><input type="range" data-setting="${k}" min="${min}" max="${max}" step="${step}"><output></output></label>`,
         ).join("")}
         <h4>Priority weights</h4>
         ${WEIGHTS.map(
           ([k, label]) => `<label class="slider"><span>${label}</span><input type="range" data-weight="${k}" min="0" max="3" step="0.1"><output></output></label>`,
         ).join("")}`,
      ),
    );
    this.bind();
    this.setConfig(config);
  }

  /** Reflect the app's current config in every control. */
  setConfig(config: SimConfig) {
    this.config = config;
    const r = this.root;
    r.querySelectorAll<HTMLButtonElement>(".setup-scenario button").forEach((b) => b.classList.toggle("on", b.dataset.scenario === config.scenario));
    r.querySelectorAll<HTMLElement>(".switch[data-info]").forEach((sw) => {
      const key = sw.dataset.info as keyof InfoModes;
      const input = $<HTMLInputElement>(sw, "input");
      const disabled = key === "disaster" && config.scenario === "none";
      input.checked = config.info[key];
      input.disabled = disabled;
      sw.classList.toggle("disabled", disabled);
    });
    r.querySelectorAll<HTMLElement>(".stepper").forEach((st) => ($(st, "output").textContent = String(config[st.dataset.key as NumericKey])));
    for (const [k, , , , , fmt] of SLIDERS) {
      const input = $<HTMLInputElement>(r, `[data-setting="${k}"]`);
      input.value = String(config[k]);
      $(input.parentElement!, "output").textContent = fmt(config[k]);
    }
    for (const [k] of WEIGHTS) {
      const input = $<HTMLInputElement>(r, `[data-weight="${k}"]`);
      input.value = String(config.weights[k]);
      $(input.parentElement!, "output").textContent = config.weights[k].toFixed(1);
    }
  }

  /** Tsunami needs a coastline; inland areas get the scenario disabled. */
  setTsunamiAvailable(available: boolean) {
    const b = $<HTMLButtonElement>(this.root, '[data-scenario="tsunami"]');
    b.disabled = !available;
    b.title = available ? "" : "No coastline in this area";
  }

  private bind() {
    const r = this.root;
    delegate(r, "click", ".setup-scenario button", (b) => {
      const s = b.dataset.scenario as Scenario;
      if (s !== this.config.scenario) this.cb.onScenario(s);
    });
    delegate<HTMLInputElement>(r, "change", ".switch[data-info] input", (input) => {
      const key = (input.closest(".switch") as HTMLElement).dataset.info as keyof InfoModes;
      const patch: Partial<InfoModes> = { [key]: input.checked };
      if (key === "disaster") patch.elevation = input.checked; // hazard estimates need elevation
      this.cb.onInfo(patch);
    });
    delegate(r, "click", ".stepper button", (b) => {
      const key = (b.closest(".stepper") as HTMLElement).dataset.key as NumericKey;
      const [, , min, max, step] = STEPPERS.find(([k]) => k === key)!;
      const value = Math.min(max, Math.max(min, this.config[key] + Number(b.dataset.d) * step));
      if (value !== this.config[key]) this.cb.onSetup({ [key]: value });
    });
    delegate<HTMLInputElement>(r, "input", "[data-setting]", (input) => {
      const [, , , , , fmt] = SLIDERS.find(([k]) => k === input.dataset.setting)!;
      $(input.parentElement!, "output").textContent = fmt(Number(input.value));
    });
    delegate<HTMLInputElement>(r, "change", "[data-setting]", (input) => this.cb.onSetup({ [input.dataset.setting as NumericKey]: Number(input.value) }));
    delegate<HTMLInputElement>(r, "input", "[data-weight]", (input) => {
      $(input.parentElement!, "output").textContent = Number(input.value).toFixed(1);
      this.cb.onWeights({ [input.dataset.weight as keyof Weights]: Number(input.value) });
    });
  }
}
