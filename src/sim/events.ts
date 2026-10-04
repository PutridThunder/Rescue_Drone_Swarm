import type { SimEvent, SimEventType } from "../types";

/** Collects simulation events (the decision feed) until the app drains them each frame. */
export class EventLog {
  private events: SimEvent[] = [];

  constructor(private readonly now: () => number) {}

  emit(type: SimEventType, message: string, droneId?: number, taskId?: number) {
    const e: SimEvent = { t: this.now(), type, message };
    if (droneId !== undefined) e.droneId = droneId;
    if (taskId !== undefined) e.taskId = taskId;
    this.events.push(e);
  }

  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
