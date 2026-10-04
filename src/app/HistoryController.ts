// Stores finished missions and challenge games in Snowflake and keeps the History panel fresh.
// Everything here is best effort: with no Snowflake the app behaves exactly as before.

import { MissionRecorder } from "../data/MissionRecorder";
import { loadHistory, saveRecord } from "../data/records";
import type { SimState, World } from "../types";
import type { ChallengeScore } from "../ui/components/ChallengeHud";
import type { Hud } from "../ui/Hud";

export class HistoryController {
  private readonly recorder = new MissionRecorder();

  constructor(
    private readonly world: World,
    private readonly hud: Hud,
  ) {
    void this.refresh();
  }

  /** A new mission started (restart): begin a fresh timeline. */
  reset() {
    this.recorder.reset();
  }

  /** Every frame while a mission may be running. */
  sample(state: SimState) {
    if (state.running && !state.metrics.complete) this.recorder.sample(state);
  }

  async missionDone(state: SimState) {
    const record = this.recorder.finish(state, this.world.meta.name, this.world.meta.cellSizeM);
    if (await saveRecord("mission", record)) await this.refresh();
  }

  async gameDone(score: ChallengeScore, winner: "human" | "algorithm" | "tie", survivorsTotal: number, durationS: number) {
    const saved = await saveRecord("game", {
      area: this.world.meta.name,
      survivorsTotal,
      humanFound: score.human.found,
      humanHectares: Math.round(score.human.hectares * 100) / 100,
      aiFound: score.ai.found,
      aiHectares: Math.round(score.ai.hectares * 100) / 100,
      winner,
      durationS: Math.round(durationS * 10) / 10,
    });
    if (saved) await this.refresh();
  }

  async refresh() {
    this.hud.setHistory(await loadHistory());
  }
}
