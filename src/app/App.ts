// Application bootstrap: loads the chosen area, builds the 3D view, the HUD and the mission, and
// runs the frame loop.
//
//   world/ (data) -> sim/ (engine, no DOM) -> render/scene/ (3D) + ui/ (HUD) <- app/ (wiring)

import { applyPaletteToCss } from "../render/scene/palette";
import { QUALITY } from "../render/scene/quality";
import { Renderer } from "../render/scene/Renderer";
import { AreaPicker } from "../ui/components/AreaPicker";
import { Hud } from "../ui/Hud";
import { areaFile, currentAreaId, importArea, loadAreaIndex, openArea } from "../world/areas";
import { applyEarthObservation, loadEarthObservation } from "../world/earthObservation";
import { loadMap, loadWorld } from "../world/loadWorld";
import { hasCoastline, withScenario } from "./config";
import { CrowdIntelController } from "./CrowdIntelController";
import { DroneCamController } from "./DroneCamController";
import { MapTools } from "./MapTools";
import { MissionRunner } from "./MissionRunner";

const HUD_REFRESH_S = 0.15; // live numbers update a few times per second
const MAX_FRAME_S = 0.1; // a long pause (tab hidden) doesn't fast-forward the mission

export async function startApp() {
  applyPaletteToCss();
  const areaId = currentAreaId();
  const [mapWorld, map, areas] = await Promise.all([loadWorld(areaFile(areaId, "world.json")), loadMap(areaFile(areaId, "map.json")), loadAreaIndex()]);
  // Satellite layers (Python pipeline output) refine the map data when the area has them.
  const eo = await loadEarthObservation(areaId, mapWorld);
  const world = eo ? applyEarthObservation(mapWorld, eo) : mapWorld;
  const sceneRoot = document.getElementById("scene")!;
  const hudRoot = document.getElementById("hud")!;

  const renderer = new Renderer(sceneRoot, world, map);
  const runner = new MissionRunner(world);
  let resultsShown = false;

  const restart = () => {
    runner.restart();
    resultsShown = false;
    hud.hideResults();
    hud.clearLog();
    hud.setRunning(false, false);
    hud.setState(runner.sim.state);
  };

  const hud: Hud = new Hud(
    hudRoot,
    runner.config,
    { showPaths: true, showSensors: true, showLabels: true, showSatellite: false, revealHidden: false, showDroneCam: QUALITY.droneCamByDefault },
    {
      onStartPause() {
        runner.togglePause();
        hud.setRunning(runner.sim.state.running, runner.sim.state.time > 0);
      },
      onReset: restart,
      onSpeed: (m) => (runner.speed = m),
      onScenario(s) {
        runner.configure(withScenario(runner.config, s));
        hud.setConfig(runner.config);
        restart();
        hud.toast(s === "tsunami" ? "Tsunami warning: the wave hits the waterfront soon" : "Normal search and rescue");
      },
      onInfo(info) {
        runner.applyLive({ info: { ...runner.config.info, ...info } });
        hud.setConfig(runner.config);
      },
      onSetup(partial) {
        runner.configure(partial);
        hud.setConfig(runner.config);
        restart();
      },
      onWeights(w) {
        runner.applyLive({ weights: { ...runner.config.weights, ...w } });
      },
      onTool(tool) {
        tools.tool = tool;
        hud.hidePlace();
      },
      onFollow: (id) => tools.follow(id),
      onView(change) {
        if (change.showDroneCam !== undefined) droneCam.setOn(change.showDroneCam);
        renderer.setOptions(change);
      },
    },
  );
  hud.setTsunamiAvailable(hasCoastline(world));
  hud.setEarthObservation(world.eo);
  hud.setRunning(false, false);
  hud.setState(runner.sim.state);

  const droneCam = new DroneCamController(hud.el, renderer, hud, () => runner.sim.state);
  const tools = new MapTools(world, renderer, runner, hud, droneCam);

  const picker = new AreaPicker(hud.brand.areaButton, areas, areaId, {
    onSelect: openArea,
    async onImport(query) {
      picker.setStatus(`Finding "${query}" and building its map… (about a minute)`, true);
      try {
        openArea(await importArea(query));
      } catch (err) {
        picker.setStatus(`Import failed: ${(err as Error).message}`);
      }
    },
  });

  // Crowd intel: a new disaster time re-seeds the mission with predicted crowds.
  await CrowdIntelController.create(areaId, world, hud.intelSlot, (crowds) => {
    runner.setPredictedCrowds(crowds);
    restart();
  });

  // Frame loop: step the mission, then draw.
  let hudTimer = 0;
  const tick = (realDt: number) => {
    const wasRunning = runner.sim.state.running;
    runner.step(realDt);
    const st = runner.sim.state;
    if (wasRunning && !st.running) hud.setRunning(false, true);
    const events = runner.sim.drainEvents();
    if (events.length) hud.log(events);
    renderer.update(st, runner.sim.drainDirtyCells(), runner.sim.floodMask);
    hudTimer -= realDt;
    if (hudTimer <= 0 || events.length) {
      hudTimer = HUD_REFRESH_S;
      hud.setState(st);
      droneCam.refresh();
    }
    if (st.metrics.complete && !resultsShown) {
      resultsShown = true;
      hud.showResults(st.metrics, !!st.flood);
    }
    renderer.render();
  };
  let last = performance.now();
  const frame = (now: number) => {
    tick(Math.min((now - last) / 1000, MAX_FRAME_S));
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Debug hook for automated checks: drive frames without requestAnimationFrame (e.g. hidden tabs).
    Object.assign(window, {
      __app: {
        get sim() {
          return runner.sim;
        },
        renderer,
        advance(seconds: number, fps = 30) {
          for (let i = 0; i < seconds * fps; i++) tick(1 / fps);
        },
      },
    });
  }
}

/** Shown if the app can't start (e.g. map data missing). */
export function showStartupError(err: unknown) {
  console.error(err);
  const box = document.createElement("div");
  box.className = "startup-error card";
  box.innerHTML = `<h2>Couldn’t start the simulation</h2><p></p>`;
  box.querySelector("p")!.textContent = (err as Error)?.message ?? String(err);
  document.body.appendChild(box);
}
