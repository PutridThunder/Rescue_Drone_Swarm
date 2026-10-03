// Mastodon public hashtag timelines (free, no key): recent local posts.
import type { Signal } from "../../../src/intel/types";
import { failed, getJson, isRecent, stripHtml, type SourceContext, type SourceResult } from "./common";

const SOURCE = "Mastodon";
const INSTANCE = "https://mastodon.social";
const TAGS = ["northvancouver", "northvan", "lonsdale", "shipyards", "lonsdalequay"];

interface Status {
  url: string;
  created_at: string;
  content: string;
  account: { acct: string };
}

export async function fetchMastodon(_ctx: SourceContext): Promise<SourceResult> {
  try {
    const timelines = await Promise.all(
      TAGS.map((tag) => getJson<Status[]>(`${INSTANCE}/api/v1/timelines/tag/${tag}?limit=40`).catch(() => [] as Status[])),
    );
    const seen = new Set<string>();
    const signals: Signal[] = [];
    for (const status of timelines.flat()) {
      if (seen.has(status.url) || !isRecent(status.created_at)) continue;
      seen.add(status.url);
      const text = stripHtml(status.content);
      signals.push({ source: SOURCE, type: "post", title: `@${status.account.acct}: ${text.slice(0, 60)}`, text, url: status.url, time: status.created_at });
    }
    return { signals, step: { source: SOURCE, status: "ok", detail: `${signals.length} recent posts across #${TAGS.join(" #")}` } };
  } catch (err) {
    return failed(SOURCE, err);
  }
}
