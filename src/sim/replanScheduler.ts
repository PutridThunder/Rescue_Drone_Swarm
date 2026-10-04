import { REPLAN_INTERVAL } from "./constants";

/**
 * Decides when the fleet replans: on a fixed cadence, as soon as possible after routine events
 * (a block finished, a drone landed), or immediately with a logged reason after significant ones
 * (survivor found, drone lost, settings changed).
 */
export class ReplanScheduler {
  private timer = 0;
  private reasons: string[] = [];
  private announce = false;

  /** Replan with a reason shown in the decision feed; `announce` logs it even if nothing changes. */
  request(reason: string, announce = false) {
    this.reasons.push(reason);
    if (announce) this.announce = true;
  }

  /** Replan within `delay` seconds without a logged reason. */
  soon(delay = 0) {
    this.timer = Math.min(this.timer, delay);
  }

  /** Advance the clock; true when a replan is due. */
  tick(dt: number): boolean {
    this.timer -= dt;
    return this.reasons.length > 0 || this.timer <= 0;
  }

  /** Start a replan: returns (and clears) the pending reasons and resets the cadence. */
  take(): { reasons: string[]; announce: boolean } {
    const pending = { reasons: [...new Set(this.reasons)], announce: this.announce };
    this.reasons = [];
    this.announce = false;
    this.timer = REPLAN_INTERVAL;
    return pending;
  }
}
