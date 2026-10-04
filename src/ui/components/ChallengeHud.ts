// Challenge mode overlay: scoreboard (you vs the algorithm), clock, controls, touch buttons for
// phones, the countdown, and the result card.

import { $, h } from "../dom";
import { formatClock } from "../format";
import "./ChallengeHud.css";

export interface ChallengeScore {
  human: { found: number; hectares: number };
  ai: { found: number; hectares: number };
  timeLeft: number;
  survivorsLeft: number;
}

/** Most survivors found wins; area searched breaks a tie. */
export function challengeWinner({ human, ai }: ChallengeScore): "human" | "algorithm" | "tie" {
  if (human.found !== ai.found) return human.found > ai.found ? "human" : "algorithm";
  if (Math.abs(human.hectares - ai.hectares) < 0.05) return "tie";
  return human.hectares > ai.hectares ? "human" : "algorithm";
}

export interface ChallengeHudCallbacks {
  onAgain(): void;
  onExit(): void;
  /** Touch controls: which direction keys are held. */
  onTouch(key: "w" | "a" | "s" | "d", down: boolean): void;
}

export class ChallengeHud {
  private readonly el: HTMLElement;
  private readonly result: HTMLElement;

  constructor(root: HTMLElement, cb: ChallengeHudCallbacks) {
    this.el = h(
      "div",
      "challenge immersive-keep",
      `<div class="challenge-board">
         <div class="challenge-side human"><span>You</span><b data-score="human">0</b><small data-area="human"></small></div>
         <div class="challenge-clock"><b data-clock>2:30</b><small data-left></small></div>
         <div class="challenge-side ai"><span>Algorithm</span><b data-score="ai">0</b><small data-area="ai"></small></div>
       </div>
       <div class="challenge-help"><kbd>W</kbd><kbd>S</kbd> fly · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>V</kbd> camera · <kbd>Esc</kbd> quit · hover over the truck to recharge</div>
       <div class="challenge-count" hidden></div>
       <div class="challenge-pad">${(["w", "a", "s", "d"] as const).map((k) => `<button data-key="${k}">${{ w: "▲", a: "◀", s: "▼", d: "▶" }[k]}</button>`).join("")}</div>`,
    );
    this.result = h("div", "challenge-result card immersive-keep");
    this.result.hidden = true;
    this.el.hidden = true;
    root.append(this.el, this.result);

    this.el.querySelectorAll<HTMLElement>("[data-key]").forEach((b) => {
      const key = b.dataset.key as "w" | "a" | "s" | "d";
      b.addEventListener("pointerdown", (e) => {
        b.setPointerCapture(e.pointerId);
        cb.onTouch(key, true);
      });
      for (const ev of ["pointerup", "pointercancel"]) b.addEventListener(ev, () => cb.onTouch(key, false));
    });
    this.result.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "again") cb.onAgain();
      if (action === "exit") cb.onExit();
    });
  }

  show(visible: boolean) {
    this.el.hidden = !visible;
    if (!visible) this.result.hidden = true;
  }

  /** Big centre text for the countdown ("3", "2", "1", "GO"); null hides it. */
  countdown(text: string | null) {
    const c = $(this.el, ".challenge-count");
    c.hidden = text === null;
    c.textContent = text ?? "";
  }

  update(s: ChallengeScore) {
    for (const side of ["human", "ai"] as const) {
      $(this.el, `[data-score="${side}"]`).textContent = String(s[side].found);
      $(this.el, `[data-area="${side}"]`).textContent = `${s[side].hectares.toFixed(1)} ha searched`;
    }
    $(this.el, "[data-clock]").textContent = formatClock(Math.max(0, s.timeLeft));
    $(this.el, "[data-left]").textContent = `${s.survivorsLeft} survivors left`;
    this.el.classList.toggle("hurry", s.timeLeft < 15);
  }

  showResult(s: ChallengeScore) {
    const { human, ai } = s;
    const winner = challengeWinner(s);
    const humanWins = winner === "human";
    const tie = winner === "tie";
    const title = tie ? "It's a tie" : humanWins ? "You beat the algorithm!" : "The algorithm wins";
    const why = humanWins
      ? "Nice flying. Now imagine six of you, never tired, coordinating every second."
      : "It never wastes a pass: lanes sized to its camera, finishing each block before moving on, and a planner that always knows what is left.";
    this.result.innerHTML = `<h2>${title}</h2>
      <table>
        <tr><th></th><th>You</th><th>Algorithm</th></tr>
        <tr><td>Survivors found</td><td>${human.found}</td><td>${ai.found}</td></tr>
        <tr><td>Area searched</td><td>${human.hectares.toFixed(1)} ha</td><td>${ai.hectares.toFixed(1)} ha</td></tr>
      </table>
      <p>${why}</p>
      <div class="challenge-actions"><button class="btn primary" data-action="again">Play again</button><button class="btn" data-action="exit">Back to the mission</button></div>`;
    this.result.hidden = false;
  }
}
