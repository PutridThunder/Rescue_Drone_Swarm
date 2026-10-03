// Links social-media posts to the places they mention ("busy at the Shipyards tonight").

import type { Place, Signal } from "./types";

// Local nicknames people use online -> words that appear in the OSM place name.
const ALIASES: Record<string, string[]> = {
  seabus: ["lonsdale quay"],
  "the quay": ["lonsdale quay"],
  shipyards: ["shipyard"],
  "lions gate": ["lions gate hospital"],
  lgh: ["lions gate hospital"],
};

// Words that suggest a crowd is gathering.
const CROWD_WORDS = /\b(festival|market|concert|parade|fireworks|game|tournament|fair|show|event|crowd|packed|busy|lineup|celebration|rally)\b/i;

export interface PostMatch {
  place: Place;
  post: Signal;
  crowdy: boolean; // post uses crowd words
}

/** Every (place, post) pair where the post names the place or a known alias for it. */
export function matchPostsToPlaces(places: Place[], posts: Signal[]): PostMatch[] {
  const named = places.filter((p) => p.name.length >= 5);
  const matches: PostMatch[] = [];
  for (const post of posts) {
    const text = `${post.title} ${post.text}`.toLowerCase();
    const needles = new Set<string>();
    for (const [alias, targets] of Object.entries(ALIASES)) if (text.includes(alias)) targets.forEach((t) => needles.add(t));
    for (const place of named) {
      const name = place.name.toLowerCase();
      const hit = text.includes(name) || [...needles].some((n) => name.includes(n));
      if (hit) matches.push({ place, post, crowdy: CROWD_WORDS.test(text) });
    }
  }
  return matches;
}
