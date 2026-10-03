import { loadWorld } from './world/loadWorld';
import { Renderer } from './render/Renderer';
import { UI } from './render/UI';
import { Simulation } from './sim/Simulation';
import { DEFAULT_CONFIG } from './sim/defaults';
import type { SimConfig } from './types';

const MAX_STEP = 0.5; // simulated seconds per step() call

async function boot() {
  const world = await loadWorld();
  const renderer = new Renderer(document.getElementById('scene')!, world);
  let config: SimConfig = structuredClone(DEFAULT_CONFIG);
  let sim = new Simulation(world, config);
  let speed = 1;
  let resultsShown = false;

  const ui = new UI(document.getElementById('hud')!, config, {
    onStartPause() {
      if (sim.state.running) sim.pause();
      else if (!sim.state.metrics.complete) sim.start();
      ui.setRunning(sim.state.running);
    },
    onReset(next) {
      config = structuredClone(next);
      sim = new Simulation(world, config);
      resultsShown = false;
      ui.hideResults();
      ui.setRunning(false);
    },
    onDisableDrone() {
      sim.disableDrone();
    },
    onConfigChange(partial) {
      config = { ...config, ...partial };
      sim.updateConfig(partial);
    },
    onSpeedChange(multiplier) {
      speed = multiplier;
    },
    onOverlayChange(name, on) {
      renderer.setOverlay(name, on);
    },
  });


  // Advances the sim by realDt seconds of wall time (scaled by speed) and redraws.
  const tick = (realDt: number, dtOverride?: number) => {
    if (sim.state.running) {
      let remaining = realDt * speed;
      while (remaining > 1e-6) {
        const dt = Math.min(remaining, MAX_STEP);
        sim.step(dt);
        remaining -= dt;
      }
    }

    const events = sim.drainEvents();
    if (events.length) ui.log(events);
    renderer.update(sim.state, sim.drainDirtyCells(), dtOverride);
    ui.setMetrics(sim.state.metrics, sim.state.flood);
    ui.setDrones(sim.state.drones);

    if (sim.state.metrics.complete && !resultsShown) {
      resultsShown = true;
      ui.setRunning(false);
      ui.showResults(sim.state.metrics);
    }

    renderer.render();
  };

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
        get sim() { return sim; },
        renderer,
        advance(seconds: number, fps = 30) {
          for (let i = 0; i < seconds * fps; i++) tick(1 / fps, 1 / fps);
        },
      },
    });
  }
}

boot();
