// Reddit (free "script" app: reddit.com/prefs/apps): recent posts in local subreddits.
import type { Signal } from "../../../src/intel/types";
import { failed, getJson, isRecent, skipped, type SourceContext, type SourceResult } from "./common";

const SOURCE = "Reddit";
const SUBREDDITS = ["NorthVancouver", "vancouver"];

interface Listing {
  data: { children: { data: { title: string; selftext: string; permalink: string; created_utc: number; subreddit: string } }[] };
}

async function appToken(id: string, secret: string): Promise<string> {
  const json = await getJson<{ access_token: string }>("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return json.access_token;
}

export async function fetchReddit({ env }: SourceContext): Promise<SourceResult> {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return skipped(SOURCE, "add REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET (free) to .env.local");
  try {
    const token = await appToken(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET);
    const listings = await Promise.all(
      SUBREDDITS.map((sub) => getJson<Listing>(`https://oauth.reddit.com/r/${sub}/new?limit=100`, { headers: { Authorization: `Bearer ${token}` } })),
    );
    const signals: Signal[] = [];
    for (const { data: post } of listings.flatMap((l) => l.data.children)) {
      const time = new Date(post.created_utc * 1000).toISOString();
      if (!isRecent(time)) continue;
      signals.push({ source: SOURCE, type: "post", title: `r/${post.subreddit}: ${post.title}`, text: post.selftext.slice(0, 1000), url: `https://www.reddit.com${post.permalink}`, time });
    }
    return { signals, step: { source: SOURCE, status: "ok", detail: `${signals.length} recent posts in r/${SUBREDDITS.join(", r/")}` } };
  } catch (err) {
    return failed(SOURCE, err);
  }
}
