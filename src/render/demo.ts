// Render/UI harness driven by mock state. Open /render-demo.html (?t=30 to start at a given time, ?procedural=1).
import type { SimEvent, SimEventType } from '../types';
import { generateProceduralWorld, loadWorld } from '../world/loadWorld';
import { createMockState, drainMockDirty, MOCK_CONFIG, resetMockState } from './mockState';
import { Renderer } from './Renderer';
import { UI } from './UI';

const params = new URLSearchParams(location.search);
const world = params.has('procedural') ? generateProceduralWorld(Number(params.get('procedural')) || 1) : await loadWorld();
console.info(`world: ${world.meta.name} ${world.meta.width}x${world.meta.height} (${world.meta.source})`);

const renderer = new Renderer(document.getElementById('scene')!, world);
let running = true;
let speed = 1;
let t = Number(params.get('t') ?? 0);
let lastEventT = 0;

const ui = new UI(document.getElementById('hud')!, MOCK_CONFIG, {
  onStartPause: () => { running = !running; ui.setRunning(running); },
  onReset: () => { t = 0; lastEventT = 0; resetMockState(); },
  onDisableDrone: () => ui.log([{ t, type: 'failure', droneId: 4, message: 'Drone lost contact (manual)' }]),
  onConfigChange: (p) => console.info('config change', p),
  onSpeedChange: (m) => { speed = m; },
  onOverlayChange: (name, on) => renderer.setOverlay(name, on),
});
ui.setRunning(running);

const FAKE: [SimEventType, string][] = [
  ['assign', 'Assigned to sector #3 (pop 0.82, hazard 0.64)'],
  ['replan', 'Path blocked by tall building; rerouted (+3 cells)'],
  ['survivor', 'Survivor detected near Lonsdale Quay'],
  ['reassign', 'Took over sector #5 from D4'],
  ['taskComplete', 'Sector #2 searched (96%)'],
  ['lowBattery', 'Battery 22%, returning to base'],
  ['recharged', 'Recharged at base'],
];

let last = performance.now();
let shownResults = false;
function tick(dt: number, fixed: boolean) {
  if (running) t += dt * speed;
  const state = createMockState(world, t);
  renderer.update(state, drainMockDirty(), fixed ? dt : undefined);
  renderer.render();
  ui.setMetrics(state.metrics, state.flood);
  ui.setDrones(state.drones);
  if (running && t - lastEventT > 1.8) {
    lastEventT = t;
    const [type, message] = FAKE[Math.floor(t) % FAKE.length];
    const ev: SimEvent = { t, type, droneId: Math.floor(t) % state.drones.length, message };
    ui.log([ev]);
  }
  if (!shownResults && state.metrics.areaSearchedFrac > 0.6) {
    shownResults = true;
    ui.showResults(state.metrics);
  }
}
function frame(now: number) {
  tick(Math.min(0.1, (now - last) / 1000), false);
  last = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook for headless/background tabs where rAF is paused: advance N seconds at a fixed step.
// Returns the average CPU ms per frame (update + render submit).
(window as unknown as Record<string, unknown>).__advance = (seconds: number, fps = 30) => {
  const frames = Math.round(seconds * fps);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) tick(1 / fps, true);
  return (performance.now() - t0) / Math.max(1, frames);
};
