// Shared shape and helpers for online intel sources. Each source lives in its own file and
// exports one async function: (ctx) => SourceResult. It must never throw - report errors in `step`.
import type { IntelStep, RegionalEvent, Signal } from "../../../src/intel/types";

export interface IntelEnv {
  TICKETMASTER_API_KEY?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  BLUESKY_HANDLE?: string;
  BLUESKY_APP_PASSWORD?: string;
}

export interface SourceContext {
  at: Date; // disaster time
  bbox: [number, number, number, number];
  env: IntelEnv;
}

export interface SourceResult {
  signals: Signal[];
  regional?: RegionalEvent[]; // big events outside the map whose crowds ripple in
  step: IntelStep;
}

export const USER_AGENT = "rescue-drone-swarm/0.1 (hackathon simulation)";
export const RECENT_DAYS = 14; // social posts older than this are ignored

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function isRecent(iso: string | undefined, now = Date.now()): boolean {
  return !!iso && now - Date.parse(iso) < RECENT_DAYS * 86_400_000;
}

export const skipped = (source: string, detail: string): SourceResult => ({ signals: [], step: { source, status: "skipped", detail } });
export const failed = (source: string, err: unknown): SourceResult => ({
  signals: [],
  step: { source, status: "error", detail: (err as Error).message ?? String(err) },
});
