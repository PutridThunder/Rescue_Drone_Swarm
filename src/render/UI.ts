import type {
  DroneView,
  InfoModes,
  Metrics,
  Scenario,
  SimConfig,
  SimEvent,
  SimState,
  Weights,
} from "../types";
import { droneColorCss } from "./palette";
import type { RenderOptions } from "./Renderer";
import "./style.css";

export type Tool = "move" | "survivor" | "crowd" | "erase" | "fail";

export interface UICallbacks {
  onStartPause(): void;
  onReset(): void;
  onSpeed(multiplier: number): void;
  onScenario(s: Scenario): void;
  onInfo(info: Partial<InfoModes>): void;
  onSetup(partial: Partial<SimConfig>): void; // restarts the mission
  onWeights(w: Partial<Weights>): void;
  onTool(t: Tool): void;
  onFollow(id: number | null): void;
  onView(o: Partial<RenderOptions>): void;
}

export interface PlaceInfo {
  street: string | null;
  lat: number;
  lon: number;
  clientX: number;
  clientY: number;
}

const ICON = {
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>',
  reset:
    '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  survivor:
    '<circle cx="12" cy="6" r="3"/><path d="M7 21v-6l-2-1 2-5h10l2 5-2 1v6h-3v-5h-4v5z"/>',
  crowd:
    '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M3 19v-4l1.5-4h7L13 15v4zM11 19v-4l1.5-4h7L21 15v4z"/>',
  erase:
    '<path d="M5 15l8-8 6 6-6 6H8zM10 19h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  fail: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  street:
    '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
  close:
    '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
const svg = (name: keyof typeof ICON, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`;

const TOOLS: {
  id: Tool;
  label: string;
  icon: keyof typeof ICON;
  hint: string;
}[] = [
  {
    id: "move",
    label: "Explore",
    icon: "move",
    hint: "Drag to pan, scroll to zoom. Click a street to see it on Google Maps, or click a drone to follow it.",
  },
  {
    id: "survivor",
    label: "Survivor",
    icon: "survivor",
    hint: "Click to hide a survivor. The drones don’t know where they are and have to find them.",
  },
  {
    id: "crowd",
    label: "Crowd",
    icon: "crowd",
    hint: "Click to report a crowd. With Population intel on, drones prioritise it; a few people are really there.",
  },
  {
    id: "erase",
    label: "Erase",
    icon: "erase",
    hint: "Click near a survivor or crowd you placed to remove it.",
  },
  {
    id: "fail",
    label: "Fail drone",
    icon: "fail",
    hint: "Click a flying drone to knock it out. Watch the fleet take over its block.",
  },
];

const STATUS_TEXT: Record<DroneView["status"], string> = {
  IDLE: "Ready",
  TRAVELLING: "Flying to",
  SEARCHING: "Searching",
  RETURNING: "Returning to truck",
  LOW_BATTERY: "Low battery → truck",
  CHARGING: "Charging",
  DISABLED: "Down",
};

const FEED_TYPES = new Set([
  "assign",
  "reassign",
  "survivor",
  "failure",
  "lowBattery",
  "truck",
  "impact",
  "complete",
  "placed",
]);

export class UI {
  private readonly el: HTMLElement;
  private readonly q = <T extends HTMLElement>(sel: string) =>
    this.el.querySelector(sel) as T;
  private config: SimConfig;
  private tool: Tool = "move";
  private follow: number | null = null;
  private fleetKey = "";

  constructor(
    root: HTMLElement,
    initial: SimConfig,
    private readonly cb: UICallbacks,
  ) {
    this.config = structuredClone(initial);
    this.el = document.createElement("div");
    this.el.className = "hud";
    this.el.innerHTML = this.template();
    root.appendChild(this.el);
    this.bind();
    this.syncSetup();
    this.setTool("move");
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Container where main.ts mounts the crowd intel panel. */
  get intelSlot(): HTMLElement {
    return this.q("#intel-slot");
  }

  setRunning(running: boolean, started: boolean) {
    const b = this.q<HTMLButtonElement>("#play");
    b.innerHTML = running
      ? `${svg("pause")}<span>Pause</span>`
      : `${svg("play")}<span>${started ? "Resume" : "Start mission"}</span>`;
    b.classList.toggle("is-running", running);
  }

  setState(state: SimState) {
    const m = state.metrics;
    this.q("#m-area").textContent = `${Math.round(m.areaSearchedFrac * 100)}%`;
    this.q<HTMLElement>("#m-area-bar").style.width =
      `${m.areaSearchedFrac * 100}%`;
    this.q("#m-found").textContent = `${m.survivorsFound}`;
    this.q("#m-total").textContent = `/ ${m.survivorsTotal}`;
    this.q("#m-lost").textContent = `${m.survivorsLost}`;
    this.q("#m-time").textContent = fmtTime(state.time);
    this.q("#clock").textContent = fmtTime(state.time);

    const chip = this.q<HTMLElement>("#tsunami");
    if (state.flood) {
      chip.hidden = false;
      chip.classList.toggle("hit", state.flood.impacted);
      chip.textContent = state.flood.impacted
        ? `Wave hit · ${m.survivorsLost} lost`
        : `Tsunami in ${fmtTime(Math.max(0, state.flood.timeToImpact))}`;
    } else chip.hidden = true;
    this.q<HTMLElement>("#lost-tile").hidden = !state.flood;

    this.renderFleet(state);
  }

  log(events: SimEvent[]) {
    const feed = this.q("#feed");
    for (const e of events) {
      if (!FEED_TYPES.has(e.type)) continue;
      const row = document.createElement("div");
      row.className = `ev ev-${e.type}`;
      const dot = e.droneId
        ? `<i class="dot" style="background:${droneColorCss(e.droneId)}"></i>`
        : `<i class="dot"></i>`;
      row.innerHTML = `${dot}<div><p></p><time>${fmtTime(e.t)}</time></div>`;
      row.querySelector("p")!.textContent = e.message;
      feed.prepend(row);
    }
    while (feed.children.length > 60) feed.lastElementChild!.remove();
  }

  clearLog() {
    this.q("#feed").innerHTML = "";
  }

  showResults(m: Metrics, tsunami: boolean) {
    const r = this.q("#results");
    r.querySelector(".r-grid")!.innerHTML = [
      ["Area searched", `${Math.round(m.areaSearchedFrac * 100)}%`],
      ["Survivors found", `${m.survivorsFound} / ${m.survivorsTotal}`],
      ...(tsunami ? [["Lost to the wave", `${m.survivorsLost}`]] : []),
      ["Mission time", fmtTime(m.time)],
      ["Drone failures", `${m.droneFailures}`],
      ["Duplicate search", `${Math.round(m.redundancyFrac * 100)}%`],
    ]
      .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`)
      .join("");
    r.hidden = false;
  }

  hideResults() {
    this.q("#results").hidden = true;
  }

  showPlace(p: PlaceInfo) {
    const pop = this.q<HTMLElement>("#place");
    pop.querySelector("h4")!.textContent = p.street ?? "Unnamed spot";
    pop.querySelector("small")!.textContent =
      `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    const ll = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    (pop.querySelector("#gmaps") as HTMLAnchorElement).href =
      `https://www.google.com/maps/search/?api=1&query=${ll}`;
    (pop.querySelector("#gsv") as HTMLAnchorElement).href =
      `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}`;
    const x = Math.min(window.innerWidth - 260, Math.max(12, p.clientX + 14));
    const y = Math.min(window.innerHeight - 140, Math.max(12, p.clientY - 20));
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    pop.hidden = false;
  }

  hidePlace() {
    this.q("#place").hidden = true;
  }

  toast(msg: string) {
    const t = this.q("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout((t as unknown as { _h: number })._h);
    (t as unknown as { _h: number })._h = window.setTimeout(
      () => t.classList.remove("show"),
      2200,
    );
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.el
      .querySelectorAll<HTMLButtonElement>(".tool")
      .forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    this.q("#hint").textContent = TOOLS.find((t) => t.id === tool)!.hint;
    document.body.dataset.tool = tool;
  }

  setFollow(id: number | null) {
    this.follow = id;
    this.fleetKey = "";
  }

  // ---------------------------------------------------------------------------

  private template(): string {
    const c = this.config;
    const w = c.weights;
    const weight = (k: keyof Weights, label: string) =>
      `<label class="slider"><span>${label}</span><input type="range" min="0" max="3" step="0.1" value="${w[k]}" data-weight="${k}"><output>${w[k].toFixed(1)}</output></label>`;
    return `
      <header class="brand card">
        <div class="logo">${svg("fail", 16)}</div>
        <div><h1>Rescue Drone Swarm</h1><p>Lonsdale · North Vancouver</p></div>
      </header>

      <div class="transport card">
        <button id="play" class="btn primary"></button>
        <div class="seg" id="speed">${[1, 2, 4, 8].map((s) => `<button data-speed="${s}" class="${s === 1 ? "on" : ""}">${s}×</button>`).join("")}</div>
        <button id="reset" class="btn icon" title="Restart mission">${svg("reset")}</button>
        <span class="clock" id="clock">00:00</span>
        <span class="chip danger" id="tsunami" hidden></span>
      </div>

      <aside class="panel left card">
        <section>
          <h3>Scenario</h3>
          <div class="seg wide" id="scenario">
            <button data-scenario="none" class="on">Search &amp; rescue</button>
            <button data-scenario="tsunami">Tsunami warning</button>
          </div>
        </section>
        <section>
          <h3>What the drones know</h3>
          ${this.toggle("geography", "Street map", "Buildings and streets known in advance")}
          ${this.toggle("population", "Population", "Where people live, plus crowds you report")}
          ${this.toggle("disaster", "Hazard warning", "Tsunami flood zone and countdown")}
          ${this.toggle("crowds", "Crowd intel", "Events, busy places and social media")}
        </section>
        <div id="intel-slot"></div>
        <section>
          <h3>Fleet <em>changes restart the mission</em></h3>
          ${this.stepper("droneCount", "Drones", 1, 12)}
          ${this.stepper("truckCount", "Charging trucks", 1, 4)}
          ${this.stepper("survivorCount", "Random survivors", 0, 60, 5)}
        </section>
        <details>
          <summary>Advanced</summary>
          <label class="slider"><span>Flight altitude</span><input type="range" id="alt" min="10" max="60" step="5" value="${c.flightAltitudeM}"><output>${c.flightAltitudeM} m</output></label>
          <label class="slider"><span>Camera range</span><input type="range" id="sensor" min="2" max="8" step="1" value="${c.sensorRange}"><output>${c.sensorRange * 10} m</output></label>
          <label class="slider"><span>Battery</span><input type="range" id="battery" min="500" max="3000" step="100" value="${c.batteryCapacity}"><output>${(c.batteryCapacity / 100).toFixed(0)} km</output></label>
          <h4>Priority weights</h4>
          ${weight("population", "Population")}
          ${weight("hazard", "Hazard")}
          ${weight("urgency", "Urgency")}
          ${weight("information", "Unsearched area")}
          ${weight("distance", "Distance cost")}
          ${weight("battery", "Battery cost")}
          ${weight("redundancy", "Avoid overlap")}
        </details>
      </aside>

      <aside class="panel right card">
        <section class="stats">
          <div class="stat wide"><span>Area searched</span><b id="m-area">0%</b><div class="bar"><i id="m-area-bar"></i></div></div>
          <div class="stat"><span>Survivors found</span><b><span id="m-found">0</span><small id="m-total">/ 0</small></b></div>
          <div class="stat" id="lost-tile" hidden><span>Lost to wave</span><b id="m-lost">0</b></div>
          <div class="stat"><span>Mission time</span><b id="m-time">00:00</b></div>
        </section>
        <section>
          <h3>Fleet <em>click to follow</em></h3>
          <div id="fleet"></div>
        </section>
        <section class="grow">
          <h3>What the drones are deciding</h3>
          <div id="feed"></div>
        </section>
      </aside>

      <div class="toolbar card">
        ${TOOLS.map((t) => `<button class="tool" data-tool="${t.id}" title="${t.label}">${svg(t.icon, 20)}<span>${t.label}</span></button>`).join("")}
      </div>
      <div class="hint" id="hint"></div>

      <div class="legend card">
        <div class="keys">
          <span><i class="k k-unsearched"></i>Not searched</span>
          <span><i class="k k-searched"></i>Searched</span>
          <span><i class="k k-frontier"></i>Frontier</span>
          <span><i class="k k-tall"></i>Too tall to overfly</span>
          <span><i class="k k-survivor"></i>Survivor found</span>
          <span><i class="k k-truck"></i>Charging truck</span>
        </div>
        <div class="views">
          ${this.view("showPaths", "Flight paths", true)}
          ${this.view("showSensors", "Camera view", true)}
          ${this.view("showLabels", "Street names", true)}
          ${this.view("revealHidden", "Reveal hidden survivors", false)}
          ${this.view("showDroneCam", "Drone cam", true)}
        </div>
      </div>

      <div class="place card" id="place" hidden>
        <button class="x" id="place-close">${svg("close", 14)}</button>
        <div class="pin">${svg("street", 16)}</div>
        <h4></h4><small></small>
        <div class="row">
          <a id="gmaps" class="btn small" target="_blank" rel="noopener">${svg("map", 14)} Google Maps</a>
          <a id="gsv" class="btn small" target="_blank" rel="noopener">Street View</a>
        </div>
      </div>

      <div class="modal" id="results" hidden>
        <div class="card">
          <h2>Search complete</h2>
          <div class="r-grid"></div>
          <div class="row">
            <button class="btn" id="r-close">Keep looking</button>
            <button class="btn primary" id="r-again">${svg("reset", 16)} Run again</button>
          </div>
        </div>
      </div>
      <div class="toast" id="toast"></div>`;
  }

  private toggle(key: keyof InfoModes, label: string, desc: string): string {
    return `<label class="switch" data-info="${key}"><input type="checkbox"><i></i><div><b>${label}</b><span>${desc}</span></div></label>`;
  }

  private stepper(
    key: keyof SimConfig,
    label: string,
    min: number,
    max: number,
    step = 1,
  ): string {
    return `<div class="stepper" data-key="${key}" data-min="${min}" data-max="${max}" data-step="${step}"><span>${label}</span><button data-d="-1">−</button><output></output><button data-d="1">+</button></div>`;
  }

  private view(key: keyof RenderOptions, label: string, on: boolean): string {
    return `<label class="check"><input type="checkbox" data-view="${key}" ${on ? "checked" : ""}>${label}</label>`;
  }

  private bind() {
    this.q("#play").addEventListener("click", () => this.cb.onStartPause());
    this.q("#reset").addEventListener("click", () => this.cb.onReset());
    this.q("#r-again").addEventListener("click", () => this.cb.onReset());
    this.q("#r-close").addEventListener("click", () => this.hideResults());
    this.q("#place-close").addEventListener("click", () => this.hidePlace());

    this.q("#speed").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      this.q("#speed")
        .querySelectorAll("button")
        .forEach((x) => x.classList.toggle("on", x === b));
      this.cb.onSpeed(Number(b.dataset.speed));
    });
    this.q("#scenario").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const s = b.dataset.scenario as Scenario;
      if (s === this.config.scenario) return;
      this.config.scenario = s;
      if (s === "tsunami")
        this.config.info = {
          ...this.config.info,
          disaster: true,
          elevation: true,
        };
      else
        this.config.info = {
          ...this.config.info,
          disaster: false,
          elevation: false,
        };
      this.syncSetup();
      this.cb.onScenario(s);
    });
    this.el.querySelectorAll<HTMLLabelElement>(".switch").forEach((sw) => {
      const input = sw.querySelector("input")!;
      input.addEventListener("change", () => {
        const key = sw.dataset.info as keyof InfoModes;
        const patch: Partial<InfoModes> = { [key]: input.checked };
        if (key === "disaster") patch.elevation = input.checked;
        this.config.info = { ...this.config.info, ...patch };
        this.cb.onInfo(patch);
      });
    });
    this.el.querySelectorAll<HTMLElement>(".stepper").forEach((st) => {
      st.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest("button");
        if (!b) return;
        const key = st.dataset.key as keyof SimConfig;
        const v = Math.min(
          Number(st.dataset.max),
          Math.max(
            Number(st.dataset.min),
            (this.config[key] as number) +
              Number(b.dataset.d) * Number(st.dataset.step),
          ),
        );
        if (v === this.config[key]) return;
        (this.config as unknown as Record<string, number>)[key] = v;
        this.syncSetup();
        this.cb.onSetup({ [key]: v });
      });
    });
    const slider = (
      id: string,
      key: keyof SimConfig,
      fmt: (v: number) => string,
    ) => {
      const input = this.q<HTMLInputElement>(`#${id}`);
      const out = input.nextElementSibling as HTMLOutputElement;
      input.addEventListener(
        "input",
        () => (out.textContent = fmt(Number(input.value))),
      );
      input.addEventListener("change", () => {
        (this.config as unknown as Record<string, number>)[key] = Number(
          input.value,
        );
        this.cb.onSetup({ [key]: Number(input.value) });
      });
    };
    slider("alt", "flightAltitudeM", (v) => `${v} m`);
    slider("sensor", "sensorRange", (v) => `${v * 10} m`);
    slider("battery", "batteryCapacity", (v) => `${(v / 100).toFixed(0)} km`);
    this.el
      .querySelectorAll<HTMLInputElement>("[data-weight]")
      .forEach((input) => {
        const out = input.nextElementSibling as HTMLOutputElement;
        input.addEventListener("input", () => {
          out.textContent = Number(input.value).toFixed(1);
          const k = input.dataset.weight as keyof Weights;
          this.config.weights = {
            ...this.config.weights,
            [k]: Number(input.value),
          };
          this.cb.onWeights({ [k]: Number(input.value) });
        });
      });
    this.el.querySelectorAll<HTMLButtonElement>(".tool").forEach((b) =>
      b.addEventListener("click", () => {
        this.setTool(b.dataset.tool as Tool);
        this.cb.onTool(this.tool);
      }),
    );
    this.el.querySelectorAll<HTMLInputElement>("[data-view]").forEach((input) =>
      input.addEventListener("change", () =>
        this.cb.onView({
          [input.dataset.view as keyof RenderOptions]: input.checked,
        }),
      ),
    );
    this.q("#fleet").addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-drone]",
      );
      if (!row) return;
      const id = Number(row.dataset.drone);
      this.setFollow(this.follow === id ? null : id);
      this.cb.onFollow(this.follow);
    });
  }

  private syncSetup() {
    const c = this.config;
    this.q("#scenario")
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) =>
        b.classList.toggle("on", b.dataset.scenario === c.scenario),
      );
    this.el.querySelectorAll<HTMLLabelElement>(".switch").forEach((sw) => {
      const key = sw.dataset.info as keyof InfoModes;
      const input = sw.querySelector("input")!;
      input.checked = c.info[key];
      const disabled = key === "disaster" && c.scenario === "none";
      input.disabled = disabled;
      sw.classList.toggle("disabled", disabled);
    });
    this.el.querySelectorAll<HTMLElement>(".stepper").forEach((st) => {
      st.querySelector("output")!.textContent = String(
        c[st.dataset.key as keyof SimConfig],
      );
    });
  }

  private renderFleet(state: SimState) {
    const labels = new Map(state.tasks.map((t) => [t.id, t.label]));
    const rows = state.drones.map((d) => {
      let text = STATUS_TEXT[d.status];
      if (d.dockedTruck !== null && d.status !== "CHARGING") {
        text = `On Truck ${d.dockedTruck}`;
        if (d.taskId != null) text += ` · next: ${labels.get(d.taskId) ?? ""}`;
      } else if (
        (d.status === "SEARCHING" || d.status === "TRAVELLING") &&
        d.taskId != null
      )
        text += ` ${labels.get(d.taskId) ?? ""}`;
      else if (d.status === "CHARGING" && d.dockedTruck !== null)
        text += ` on Truck ${d.dockedTruck}`;
      return { d, text: text.trim(), batt: Math.round(d.battery * 100) };
    });
    const key =
      rows.map((r) => `${r.d.id}${r.text}${Math.round(r.batt / 5)}`).join("|") +
      this.follow;
    if (key === this.fleetKey) return;
    this.fleetKey = key;
    this.q("#fleet").innerHTML = rows
      .map(({ d, text, batt }) => {
        const cls = d.status === "DISABLED" ? "down" : batt < 25 ? "low" : "";
        return `<button class="drone ${cls} ${this.follow === d.id ? "following" : ""}" data-drone="${d.id}">
          <i class="dot" style="background:${droneColorCss(d.id)}"></i>
          <b>D${d.id}</b><span class="st"></span>
          <span class="batt"><i style="width:${batt}%"></i></span>
        </button>`;
      })
      .join("");
    this.q("#fleet")
      .querySelectorAll(".st")
      .forEach((el, i) => (el.textContent = rows[i].text));
  }
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
