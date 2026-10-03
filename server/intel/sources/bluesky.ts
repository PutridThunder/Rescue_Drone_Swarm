// Bluesky (free account + app password: bsky.app → Settings → App passwords): post search.
import type { Signal } from "../../../src/intel/types";
import { failed, getJson, isRecent, skipped, type SourceContext, type SourceResult } from "./common";

const SOURCE = "Bluesky";
const PDS = "https://bsky.social/xrpc";
const QUERIES = ['"North Vancouver"', "Lonsdale Quay", "Shipyards North Van"];

interface SearchResult {
  posts: { uri: string; indexedAt: string; author: { handle: string }; record: { text?: string } }[];
}

export async function fetchBluesky({ env }: SourceContext): Promise<SourceResult> {
  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) return skipped(SOURCE, "add BLUESKY_HANDLE / BLUESKY_APP_PASSWORD (free) to .env.local");
  try {
    const session = await getJson<{ accessJwt: string }>(`${PDS}/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }),
    });
    const auth = { headers: { Authorization: `Bearer ${session.accessJwt}` } };
    const results = await Promise.all(
      QUERIES.map((q) => getJson<SearchResult>(`${PDS}/app.bsky.feed.searchPosts?limit=50&sort=latest&q=${encodeURIComponent(q)}`, auth)),
    );
    const seen = new Set<string>();
    const signals: Signal[] = [];
    for (const post of results.flatMap((r) => r.posts)) {
      if (seen.has(post.uri) || !isRecent(post.indexedAt)) continue;
      seen.add(post.uri);
      const text = post.record.text ?? "";
      const rkey = post.uri.split("/").pop();
      signals.push({ source: SOURCE, type: "post", title: `@${post.author.handle}: ${text.slice(0, 60)}`, text, url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`, time: post.indexedAt });
    }
    return { signals, step: { source: SOURCE, status: "ok", detail: `${signals.length} recent posts` } };
  } catch (err) {
    return failed(SOURCE, err);
  }
}
