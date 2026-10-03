import { IntelController } from "./intel/IntelController";
import type { CrowdPlacement } from "./intel/toCrowds";
import { loadMap, loadWorld } from "./world/loadWorld";
import { Renderer } from "./render/Renderer";
import { UI, type Tool } from "./render/UI";
import { Simulation } from "./sim/Simulation";
import { DEFAULT_CONFIG } from "./sim/defaults";
import type { SimConfig, World } from "./types";

const MAX_STEP = 0.5; // simulated seconds per step() call
const UI_INTERVAL = 0.15; // s between HUD refreshes

interface Placement {
  kind: "survivor" | "crowd";
  x: number;
  y: number;
}

async function boot() {
  const [world, map] = await Promise.all([loadWorld(), loadMap()]);
  const renderer = new Renderer(document.getElementById("scene")!, world, map);
  let config: SimConfig = structuredClone(DEFAULT_CONFIG);
  const placements: Placement[] = [];
  let intelCrowds: CrowdPlacement[] = []; // predicted by crowd intel for the chosen disaster time
  let sim = createSim();
  let speed = 1;
  let tool: Tool = "move";
  let resultsShown = false;
  let uiTimer = 0;

  function createSim(): Simulation {
    const s = new Simulation(world, config);
    for (const c of intelCrowds) s.addCrowd(c.x, c.y, c.opts);
    for (const p of placements) {
      if (p.kind === "survivor") s.addSurvivor(p.x, p.y);
      else s.addCrowd(p.x, p.y);
    }
    s.drainEvents();
    return s;
  }

  function restart() {
    sim = createSim();
    resultsShown = false;
    ui.hideResults();
    ui.clearLog();
    ui.setRunning(false, false);
    ui.setState(sim.state);
  }

  const ui = new UI(document.getElementById("hud")!, config, {
    onStartPause() {
      if (sim.state.running) sim.pause();
      else if (!sim.state.metrics.complete) sim.start();
      ui.setRunning(sim.state.running, sim.state.time > 0);
    },
    onReset: restart,
    onSpeed(m) {
      speed = m;
    },
    onScenario(s) {
      config = {
        ...config,
        scenario: s,
        info: {
          ...config.info,
          disaster: s === "tsunami",
          elevation: s === "tsunami",
        },
      };
      restart();
      ui.toast(
        s === "tsunami"
          ? "Tsunami warning: the wave hits the waterfront soon"
          : "Normal search and rescue",
      );
    },
    onInfo(info) {
      config = { ...config, info: { ...config.info, ...info } };
      sim.updateConfig({ info: config.info });
    },
    onSetup(partial) {
      config = { ...config, ...partial };
      restart();
    },
    onWeights(w) {
      config = { ...config, weights: { ...config.weights, ...w } };
      sim.updateConfig({ weights: config.weights });
    },
    onTool(t) {
      tool = t;
      ui.hidePlace();
    },
    onFollow(id) {
      renderer.setFollow(id);
    },
    onView(o) {
      renderer.setOptions(o);
    },
  });
  ui.setRunning(false, false);
  ui.setState(sim.state);

  // Crowd intel: changing the disaster time or searching online re-seeds the mission.
  await IntelController.create(world, ui.intelSlot, (crowds, report) => {
    intelCrowds = crowds;
    restart();
    if (report.mode === "live") ui.toast(`Crowd intel updated: ${crowds.length} hotspots`);
  });

  // Distinguish clicks from camera drags.
  const canvas = renderer.canvas;
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener(
    "pointerdown",
    (e) => (down = { x: e.clientX, y: e.clientY }),
  );
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    down = null;
    onMapClick(e.clientX, e.clientY);
  });
  canvas.addEventListener("wheel", () => ui.hidePlace(), { passive: true });

  function onMapClick(cx: number, cy: number) {
    if (tool === "move" || tool === "fail") {
      const id = renderer.pickDrone(cx, cy);
      if (tool === "fail") {
        if (id === null) return ui.toast("Click directly on a drone");
        if (sim.disableDrone(id) === null)
          ui.toast(`Drone ${id} is already down`);
        return;
      }
      if (id !== null) {
        const next = renderer.following === id ? null : id;
        renderer.setFollow(next);
        ui.setFollow(next);
        ui.toast(next ? `Following Drone ${id}` : "Stopped following");
        return;
      }
    }
    const cell = renderer.pick(cx, cy);
    if (!cell) return;
    switch (tool) {
      case "move": {
        const { lat, lon } = toLatLon(world, cell.x, cell.y);
        ui.showPlace({
          street: streetNear(world, cell.x, cell.y),
          lat,
          lon,
          clientX: cx,
          clientY: cy,
        });
        break;
      }
      case "survivor":
        if (sim.addSurvivor(cell.x, cell.y)) {
          placements.push({ kind: "survivor", x: cell.x, y: cell.y });
          ui.toast("Survivor hidden — the drones don’t know where");
        } else ui.toast("Can’t place a survivor there");
        break;
      case "crowd":
        if (sim.addCrowd(cell.x, cell.y)) {
          placements.push({ kind: "crowd", x: cell.x, y: cell.y });
          if (!config.info.population)
            ui.toast("Crowd added — turn on Population intel so drones use it");
        } else ui.toast("Can’t place a crowd there");
        break;
      case "erase": {
        const n = sim.removeNear(cell.x, cell.y, 4);
        for (let k = placements.length - 1; k >= 0; k--) {
          if (
            (placements[k].x - cell.x) ** 2 + (placements[k].y - cell.y) ** 2 <=
            16
          )
            placements.splice(k, 1);
        }
        ui.toast(n ? `Removed ${n}` : "Nothing you placed is there");
        break;
      }
    }
  }

  function tick(realDt: number) {
    if (sim.state.running) {
      let remaining = realDt * speed;
      while (remaining > 1e-6) {
        const dt = Math.min(remaining, MAX_STEP);
        sim.step(dt);
        remaining -= dt;
      }
      if (!sim.state.running) ui.setRunning(false, true);
    }
    const events = sim.drainEvents();
    if (events.length) ui.log(events);
    renderer.update(sim.state, sim.drainDirtyCells(), sim.floodMask);
    uiTimer -= realDt;
    if (uiTimer <= 0 || events.length) {
      uiTimer = UI_INTERVAL;
      ui.setState(sim.state);
    }
    if (sim.state.metrics.complete && !resultsShown) {
      resultsShown = true;
      ui.showResults(sim.state.metrics, !!sim.state.flood);
    }
    renderer.render();
  }

  let last = performance.now();
  const frame = (now: number) => {
    tick(Math.min((now - last) / 1000, 0.1));
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Debug hook: drive the app without rAF (e.g. in a background tab).
    Object.assign(window, {
      __app: {
        get sim() {
          return sim;
        },
        renderer,
        advance(seconds: number, fps = 30) {
          for (let i = 0; i < seconds * fps; i++) tick(1 / fps);
        },
      },
    });
  }
}

function toLatLon(world: World, x: number, y: number) {
  const [S, W, N, E] = world.meta.bbox;
  return {
    lat: N - (y / world.meta.height) * (N - S),
    lon: W + (x / world.meta.width) * (E - W),
  };
}

function streetNear(world: World, x: number, y: number): string | null {
  const { width, height } = world.meta;
  let best: string | null = null;
  let bd = Infinity;
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const cx = Math.floor(x) + dx;
      const cy = Math.floor(y) + dy;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const n = world.roadName[cy * width + cx];
      const d = dx * dx + dy * dy;
      if (n >= 0 && d < bd) {
        bd = d;
        best = world.roadNames[n];
      }
    }
  }
  return best;
}

boot();
