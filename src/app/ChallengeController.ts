// Challenge mode: one drone flown by the player (WASD / arrow keys / touch pad) against the
// algorithm's swarm of six. Every drone has the same speed, camera and battery, and they share
// the trucks and survivors; most survivors found in the time limit wins (area searched breaks a
// tie). Runs full screen, third person.

import type { SimConfig } from "../types";
import { challengeWinner, ChallengeHud, type ChallengeScore } from "../ui/components/ChallengeHud";
import type { Hud } from "../ui/Hud";
import type { DroneCamController } from "./DroneCamController";
import type { MissionRunner } from "./MissionRunner";

const MATCH_S = 150;
const SWARM = 6; // the algorithm's drones (ids 1-6)
const HUMAN_DRONE = SWARM + 1; // the player's drone
const SETUP: Partial<SimConfig> = { droneCount: SWARM + 1, truckCount: 2, survivorCount: 20, scenario: "none" };
const COUNTDOWN = ["3", "2", "1", "GO"];
const KEYS: Record<string, "w" | "a" | "s" | "d"> = { w: "w", a: "a", s: "s", d: "d", arrowup: "w", arrowleft: "a", arrowdown: "s", arrowright: "d" };

export class ChallengeController {
  private readonly ui: ChallengeHud;
  private readonly held = new Set<"w" | "a" | "s" | "d">();
  private active = false;
  private over = false;
  private saved: { config: SimConfig; speed: number } | null = null;
  private timers: number[] = [];

  constructor(
    private readonly runner: MissionRunner,
    private readonly cam: DroneCamController,
    private readonly hud: Hud,
    /** Show or hide intel on the map (population, crowds): the swarm uses it, the player doesn't see it. */
    private readonly setIntelVisible: (visible: boolean) => void,
    /** Restart the mission with the runner's current config (resets the HUD too). */
    private readonly restart: () => void,
    /** A match ran to the end (not quit): the final score. */
    private readonly onFinish: (score: ChallengeScore, winner: "human" | "algorithm" | "tie", survivorsTotal: number, durationS: number) => void = () => {},
  ) {
    this.ui = new ChallengeHud(hud.el, {
      onAgain: () => this.start(),
      onExit: () => this.exit(),
      onTouch: (k, down) => (down ? this.held.add(k) : this.held.delete(k)),
    });
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    window.addEventListener("blur", () => this.held.clear());
  }

  get isActive(): boolean {
    return this.active;
  }

  start() {
    this.clearTimers();
    if (!this.saved) this.saved = { config: structuredClone(this.runner.config), speed: this.runner.speed };
    this.active = true;
    this.over = false;
    this.held.clear();
    // The swarm uses every intel layer (population map, crowd intel, hazards); the player
    // doesn't see them: the intel is part of the algorithm.
    this.runner.configure({ ...SETUP, info: { geography: true, population: true, crowds: true, disaster: true, elevation: true }, seed: Math.floor(Math.random() * 1e9) });
    this.runner.speed = 1;
    this.restart();
    this.setIntelVisible(false); // intel is for the swarm only
    this.runner.sim.takeManualControl(HUMAN_DRONE);

    this.cam.onFullChange = (full) => {
      if (!full && this.active) this.exit(); // Esc / ✕ quits the game
    };
    this.cam.show(HUMAN_DRONE);
    this.cam.setView("chase");
    this.cam.setFull(true);
    this.ui.show(true);
    this.ui.update(this.score());
    COUNTDOWN.forEach((text, k) => this.timers.push(window.setTimeout(() => this.ui.countdown(text), k * 800)));
    this.timers.push(
      window.setTimeout(() => {
        this.ui.countdown(null);
        if (this.active && !this.over) {
          this.runner.sim.start();
          this.hud.setRunning(true, true);
        }
      }, COUNTDOWN.length * 800),
    );
  }

  /** Per frame: feed the stick, update the scoreboard, end the match on time. */
  tick() {
    if (!this.active || this.over) return;
    const thrust = (this.held.has("w") ? 1 : 0) - (this.held.has("s") ? 1 : 0);
    const turn = (this.held.has("d") ? 1 : 0) - (this.held.has("a") ? 1 : 0);
    this.runner.sim.setStick(HUMAN_DRONE, thrust, turn);
    const score = this.score();
    this.ui.update(score);
    if (score.timeLeft <= 0 || score.survivorsLeft === 0) this.finish(score);
  }

  private finish(score: ChallengeScore) {
    this.over = true;
    this.runner.sim.pause();
    this.runner.sim.setStick(HUMAN_DRONE, 0, 0);
    this.hud.setRunning(false, true);
    this.ui.showResult(score);
    this.onFinish(score, challengeWinner(score), this.runner.sim.state.survivors.length, Math.min(MATCH_S, this.runner.sim.state.time));
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.clearTimers();
    this.ui.countdown(null);
    this.ui.show(false);
    this.cam.onFullChange = null;
    this.cam.setFull(false);
    if (this.saved) {
      this.runner.configure(this.saved.config);
      this.runner.speed = this.saved.speed;
      this.saved = null;
    }
    this.setIntelVisible(true);
    this.restart();
  }

  private score(): ChallengeScore {
    const st = this.runner.sim.state;
    const cellHa = this.cellAreaHa();
    const human = (id: number | null) => id === HUMAN_DRONE;
    const found = (mine: (id: number | null) => boolean) => st.survivors.filter((s) => s.found && mine(s.foundBy)).length;
    const area = (mine: (id: number | null) => boolean) => st.drones.filter((d) => mine(d.id)).reduce((sum, d) => sum + d.cellsSearched, 0) * cellHa;
    const swarm = (id: number | null) => id !== null && !human(id);
    return {
      human: { found: found(human), hectares: area(human) },
      ai: { found: found(swarm), hectares: area(swarm) },
      timeLeft: MATCH_S - st.time,
      survivorsLeft: st.survivors.filter((s) => !s.found && !s.lost).length,
    };
  }

  private cellAreaHa(): number {
    const m = this.runner.cellSizeM;
    return (m * m) / 10_000;
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = KEYS[e.key.toLowerCase()];
    if (!k || !this.active) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
    e.preventDefault(); // arrow keys would scroll
    if (down) this.held.add(k);
    else this.held.delete(k);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
