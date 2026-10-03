import type { DroneStatus, DroneView, FloodState, InfoModes, Metrics, SimConfig, SimEvent, SimEventType, Weights } from '../types';
import { droneColorHex } from './palette';
import type { OverlayName } from './Renderer';
import './style.css';

export interface UICallbacks {
  onStartPause(): void;
  onReset(config: SimConfig): void;
  onDisableDrone(): void;
  onConfigChange(partial: Partial<SimConfig>): void;
  onSpeedChange(multiplier: number): void;
  onOverlayChange(name: OverlayName, on: boolean): void;
}

type Props = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') e.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k in e && typeof v !== 'string') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null) e.append(c);
  return e;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function fmtTime(s: number): string {
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${sign}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const pct = (f: number, digits = 0) => `${(Math.max(0, f) * 100).toFixed(digits)}%`;

const EVENT_STYLE: Record<SimEventType, { icon: string; cls: string }> = {
  assign: { icon: '➜', cls: 'ev-assign' },
  reassign: { icon: '⇄', cls: 'ev-reassign' },
  replan: { icon: '↻', cls: 'ev-replan' },
  survivor: { icon: '★', cls: 'ev-survivor' },
  failure: { icon: '✖', cls: 'ev-failure' },
  lowBattery: { icon: '▼', cls: 'ev-low' },
  recharged: { icon: '▲', cls: 'ev-recharged' },
  taskComplete: { icon: '✓', cls: 'ev-done' },
  impact: { icon: '≈', cls: 'ev-impact' },
  complete: { icon: '◆', cls: 'ev-complete' },
};

const STATUS_LABEL: Record<DroneStatus, string> = {
  IDLE: 'Idle',
  TRAVELLING: 'Transit',
  SEARCHING: 'Search',
  RETURNING: 'Return',
  LOW_BATTERY: 'Low batt',
  DISABLED: 'Down',
};

const WEIGHT_LABELS: [keyof Weights, string, string][] = [
  ['population', 'Population', 'Favour areas where people likely are'],
  ['hazard', 'Hazard', 'Favour areas at risk (flood zone)'],
  ['urgency', 'Urgency', 'Favour areas that will flood soonest'],
  ['information', 'Information', 'Favour unexplored territory'],
  ['distance', 'Distance', 'Penalise far-away tasks'],
  ['battery', 'Battery', 'Penalise tasks that strain battery'],
  ['redundancy', 'Redundancy', 'Penalise re-searching covered ground'],
];

const INFO_LABELS: [keyof InfoModes, string][] = [
  ['geography', 'Geography'],
  ['population', 'Population'],
  ['elevation', 'Elevation'],
  ['disaster', 'Disaster'],
];

const OVERLAY_LABELS: [OverlayName, string, boolean][] = [
  ['fog', 'Fog of war', true],
  ['frontier', 'Frontier', true],
  ['hazard', 'Hazard', true],
  ['population', 'Population', false],
  ['paths', 'Paths', true],
  ['tasks', 'Tasks', true],
  ['sensors', 'Sensors', true],
  ['groundTruth', 'Ground truth', false],
];

interface DroneRow {
  row: HTMLElement;
  status: HTMLElement;
  bar: HTMLElement;
  battTxt: HTMLElement;
  task: HTMLElement;
}

export class UI {
  private config: SimConfig;
  private readonly startBtn: HTMLButtonElement;
  private readonly pendingNote: HTMLElement;
  private readonly metricEls: Record<string, HTMLElement> = {};
  private readonly areaBar: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly roster: HTMLElement;
  private readonly droneRows = new Map<number, DroneRow>();
  private readonly logList: HTMLElement;
  private readonly results: HTMLElement;
  private pendingReset = false;

  constructor(private readonly root: HTMLElement, initial: SimConfig, private readonly cb: UICallbacks) {
    this.config = structuredClone(initial);
    root.classList.add('sar-ui');

    // ---------------- Left panel: mission control ----------------
    this.startBtn = el('button', { class: 'btn btn-primary btn-big', onclick: () => cb.onStartPause() }, '▶  Start');
    this.pendingNote = el('div', { class: 'pending hidden' }, 'Setup changed — press Reset to apply');
    const controls = el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => this.reset() }, '↺ Reset'),
      el('button', { class: 'btn btn-danger', onclick: () => cb.onDisableDrone() }, '✖ Disable drone'),
    );
    const speed = this.segmented([1, 2, 5, 10], 1, (v) => cb.onSpeedChange(v));

    const setup = el('div', { class: 'group' },
      this.slider('Drones', 1, 12, 1, this.config.droneCount, (v) => String(v), (v) => this.setupChange({ droneCount: v })),
      this.slider('Sensor range', 1, 12, 1, this.config.sensorRange, (v) => `${v} cells`, (v) => this.setupChange({ sensorRange: v })),
      this.slider('Battery', 100, 3000, 50, this.config.batteryCapacity, (v) => `${v}`, (v) => this.setupChange({ batteryCapacity: v })),
      this.select('Scenario', [['none', 'None'], ['tsunami', 'Earthquake + Tsunami']], this.config.scenario, (v) =>
        this.setupChange({ scenario: v as SimConfig['scenario'] }),
      ),
      this.pendingNote,
    );

    const info = el('div', { class: 'chips' },
      ...INFO_LABELS.map(([key, label]) =>
        this.chip(label, this.config.info[key], (on) => {
          this.config.info = { ...this.config.info, [key]: on };
          cb.onConfigChange({ info: { ...this.config.info } });
        }),
      ),
    );

    const weights = el('div', { class: 'group' },
      ...WEIGHT_LABELS.map(([key, label, hint]) =>
        this.slider(label, 0, 3, 0.05, this.config.weights[key], (v) => v.toFixed(2), (v) => {
          this.config.weights = { ...this.config.weights, [key]: v };
          cb.onConfigChange({ weights: { ...this.config.weights } });
        }, hint),
      ),
    );

    const overlays = el('div', { class: 'chips' },
      ...OVERLAY_LABELS.map(([name, label, on]) => this.chip(label, on, (v) => cb.onOverlayChange(name, v))),
    );

    const left = this.panel('left', 'Mission Control', [
      el('div', { class: 'section' }, this.startBtn, controls, el('div', { class: 'label' }, 'Sim speed'), speed),
      this.section('Fleet & scenario', setup),
      this.section('Intel available', info),
      this.section('Priority weights', weights, true),
      this.section('Map overlays', overlays),
    ]);

    // ---------------- Right panel: metrics, roster, log ----------------
    this.banner = el('div', { class: 'banner hidden' });
    const big = (key: string, label: string, accent = '') => {
      const v = el('div', { class: `big-val ${accent}` }, '–');
      this.metricEls[key] = v;
      return el('div', { class: 'big' }, v, el('div', { class: 'big-label' }, label));
    };
    const small = (key: string, label: string) => {
      const v = el('span', { class: 'small-val' }, '–');
      this.metricEls[key] = v;
      return el('div', { class: 'small' }, el('span', { class: 'small-label' }, label), v);
    };
    this.areaBar = el('div', { class: 'bar-fill' });
    const metrics = el('div', {},
      el('div', { class: 'big-grid' },
        big('area', 'Area searched', 'accent-cyan'),
        big('survivors', 'Survivors found', 'accent-pink'),
        big('time', 'Mission time'),
        big('redundancy', 'Redundancy'),
      ),
      el('div', { class: 'bar' }, this.areaBar),
      el('div', { class: 'small-grid' },
        small('pop', 'Population reached'),
        small('util', 'Fleet utilisation'),
        small('tasks', 'Tasks done / reassigned'),
        small('failures', 'Drone failures'),
        small('lost', 'Survivors lost'),
        small('dist', 'Distance flown'),
      ),
    );
    this.roster = el('div', { class: 'roster' });
    this.logList = el('div', { class: 'log' });

    const right = this.panel('right', 'Live Telemetry', [
      this.banner,
      el('div', { class: 'section' }, metrics),
      this.section('Fleet', this.roster),
      this.section('Decision log', this.logList),
    ]);

    this.results = el('div', { class: 'results hidden' });
    root.append(left, right, this.results);
  }

  // ---------------------------------------------------------------- public API

  setRunning(running: boolean): void {
    setText(this.startBtn, running ? '❚❚  Pause' : '▶  Start');
    this.startBtn.classList.toggle('running', running);
  }

  setMetrics(m: Metrics, flood: FloodState | null): void {
    const e = this.metricEls;
    setText(e.area, pct(m.areaSearchedFrac, 1));
    setText(e.survivors, `${m.survivorsFound}/${m.survivorsTotal}`);
    setText(e.time, fmtTime(m.time));
    setText(e.redundancy, pct(m.redundancyFrac));
    setText(e.pop, m.populationTotal > 0 ? `${pct(m.populationReached / m.populationTotal)} (${Math.round(m.populationReached).toLocaleString()})` : '–');
    setText(e.util, pct(m.droneUtilization));
    setText(e.tasks, `${m.tasksCompleted} / ${m.tasksReassigned}`);
    setText(e.failures, String(m.droneFailures));
    setText(e.lost, String(m.survivorsLost));
    setText(e.dist, `${(m.distanceTravelled * 0.03).toFixed(1)} km`);
    this.areaBar.style.width = pct(m.areaSearchedFrac, 2);

    if (flood && !flood.impacted) {
      this.banner.className = `banner warn${flood.timeToImpact < 30 ? ' urgent' : ''}`;
      setText(this.banner, `⚠ TSUNAMI IMPACT IN ${fmtTime(Math.max(0, flood.timeToImpact))}  ·  run-up ${flood.runupM.toFixed(0)} m`);
    } else if (flood && flood.impacted) {
      this.banner.className = 'banner impact';
      setText(this.banner, `≈ WAVE HAS HIT  ·  ${m.survivorsLost} survivor${m.survivorsLost === 1 ? '' : 's'} lost`);
    } else {
      this.banner.className = 'banner hidden';
    }
  }

  setDrones(drones: DroneView[]): void {
    const seen = new Set<number>();
    for (const d of drones) {
      seen.add(d.id);
      let r = this.droneRows.get(d.id);
      if (!r) {
        const status = el('span', { class: 'status' });
        const bar = el('div', { class: 'batt-fill' });
        const battTxt = el('span', { class: 'batt-txt' });
        const task = el('span', { class: 'task' });
        const row = el('div', { class: 'drone-row' },
          el('span', { class: 'swatch', style: `background:${droneColorHex(d.id)};box-shadow:0 0 10px ${droneColorHex(d.id)}` }),
          el('span', { class: 'drone-id' }, `D${d.id}`),
          status,
          el('div', { class: 'batt' }, bar),
          battTxt,
          task,
        );
        r = { row, status, bar, battTxt, task };
        this.droneRows.set(d.id, r);
        this.roster.append(row);
      }
      setText(r.status, STATUS_LABEL[d.status]);
      r.status.className = `status st-${d.status}`;
      r.row.classList.toggle('disabled', d.status === 'DISABLED');
      const b = Math.max(0, Math.min(1, d.battery));
      r.bar.style.width = pct(b);
      r.bar.style.background = `hsl(${Math.round(120 * b)}, 85%, 55%)`;
      setText(r.battTxt, pct(b));
      setText(r.task, d.taskId !== null ? `#${d.taskId}` : '—');
    }
    for (const [id, r] of this.droneRows) {
      if (seen.has(id)) continue;
      r.row.remove();
      this.droneRows.delete(id);
    }
  }

  log(events: SimEvent[]): void {
    for (const ev of events) {
      const style = EVENT_STYLE[ev.type] ?? { icon: '•', cls: '' };
      const who = ev.droneId !== undefined
        ? el('span', { class: 'ev-drone', style: `color:${droneColorHex(ev.droneId)}` }, `D${ev.droneId}`)
        : null;
      const item = el('div', { class: `ev ${style.cls}` },
        el('span', { class: 'ev-icon' }, style.icon),
        el('span', { class: 'ev-time' }, fmtTime(ev.t)),
        who,
        el('span', { class: 'ev-msg' }, ev.message),
      );
      this.logList.prepend(item);
    }
    while (this.logList.childElementCount > 100) this.logList.lastElementChild!.remove();
  }

  showResults(m: Metrics): void {
    const stat = (v: string, l: string, cls = '') => el('div', { class: 'res-stat' }, el('div', { class: `res-val ${cls}` }, v), el('div', { class: 'res-label' }, l));
    this.results.replaceChildren(
      el('div', { class: 'res-card' },
        el('div', { class: 'res-title' }, 'SEARCH COMPLETE'),
        el('div', { class: 'res-grid' },
          stat(pct(m.areaSearchedFrac, 1), 'Area searched', 'accent-cyan'),
          stat(`${m.survivorsFound}/${m.survivorsTotal}`, 'Survivors found', 'accent-pink'),
          stat(fmtTime(m.time), 'Mission time'),
          stat(String(m.droneFailures), 'Drone failures'),
          stat(pct(m.redundancyFrac), 'Redundancy'),
          stat(String(m.survivorsLost), 'Survivors lost'),
        ),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn', onclick: () => this.results.classList.add('hidden') }, 'Close'),
          el('button', { class: 'btn btn-primary', onclick: () => { this.results.classList.add('hidden'); this.reset(); } }, '↺ Run again'),
        ),
      ),
    );
    this.results.classList.remove('hidden');
  }

  hideResults(): void {
    this.results.classList.add('hidden');
  }

  // ---------------------------------------------------------------- internals

  private reset(): void {
    this.pendingReset = false;
    this.pendingNote.classList.add('hidden');
    this.results.classList.add('hidden');
    this.logList.replaceChildren();
    this.cb.onReset(structuredClone(this.config));
  }

  private setupChange(partial: Partial<SimConfig>): void {
    Object.assign(this.config, partial);
    if (!this.pendingReset) {
      this.pendingReset = true;
      this.pendingNote.classList.remove('hidden');
    }
  }

  private panel(side: 'left' | 'right', title: string, children: HTMLElement[]): HTMLElement {
    const body = el('div', { class: 'panel-body' }, ...children);
    const p = el('aside', { class: `panel panel-${side}` });
    const toggle = el('button', { class: 'collapse', title: 'Collapse', onclick: () => p.classList.toggle('collapsed') }, side === 'left' ? '❮' : '❯');
    p.append(el('header', { class: 'panel-head' }, el('span', { class: 'panel-title' }, title), toggle), body);
    return p;
  }

  private section(title: string, content: HTMLElement, collapsed = false): HTMLElement {
    const s = el('section', { class: `section${collapsed ? ' collapsed' : ''}` });
    s.append(el('h3', { class: 'section-head', onclick: () => s.classList.toggle('collapsed') }, title), el('div', { class: 'section-body' }, content));
    return s;
  }

  private slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void, hint?: string): HTMLElement {
    const out = el('span', { class: 'slider-val' }, fmt(value));
    const input = el('input', { type: 'range', min, max, step, value: String(value) }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setText(out, fmt(v));
      onInput(v);
    });
    return el('label', { class: 'slider', title: hint }, el('div', { class: 'slider-top' }, el('span', {}, label), out), input);
  }

  private select(label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
    const sel = el('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...options.map(([v, l]) => el('option', { value: v }, l)));
    sel.value = value;
    return el('label', { class: 'select' }, el('span', {}, label), sel);
  }

  private chip(label: string, on: boolean, onToggle: (on: boolean) => void): HTMLElement {
    const b = el('button', { class: `chip${on ? ' on' : ''}` }, label);
    b.addEventListener('click', () => {
      const v = !b.classList.contains('on');
      b.classList.toggle('on', v);
      onToggle(v);
    });
    return b;
  }

  private segmented(values: number[], initial: number, onPick: (v: number) => void): HTMLElement {
    const wrap = el('div', { class: 'segmented' });
    for (const v of values) {
      const b = el('button', { class: `seg${v === initial ? ' on' : ''}` }, `${v}×`);
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.seg').forEach((s) => s.classList.remove('on'));
        b.classList.add('on');
        onPick(v);
      });
      wrap.append(b);
    }
    return wrap;
  }

  dispose(): void {
    this.root.replaceChildren();
    this.root.classList.remove('sar-ui');
  }
}
