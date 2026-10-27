import type { FtcEvent } from "@/lib/ftc/types";

export type EventMatch = { event: FtcEvent; confident: boolean };

const STOP_WORDS = new Set(["the", "and", "for", "ftc", "first", "tech", "challenge", "live", "stream", "official"]);

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Fuzzy-matches free text (a YouTube title, a Twitch channel name, ...)
 * against a season's events — an exact event code appearing in the text is
 * always confident; otherwise it's a word-overlap score against the event
 * name, confident only above a threshold. Pure so it's unit-testable
 * without ever calling the FIRST API or YouTube's oEmbed endpoint — see
 * app/api/live/detect-event/route.ts for the network side.
 */
export function matchEventFromText(text: string, events: FtcEvent[]): EventMatch | null {
  const upperText = text.toUpperCase();
  const exactCode = events.find((e) => upperText.includes(e.code.toUpperCase()));
  if (exactCode) return { event: exactCode, confident: true };

  const words = new Set(normalize(text));
  if (words.size === 0 || events.length === 0) return null;

  let best: { event: FtcEvent; score: number } | null = null;
  for (const event of events) {
    const nameWords = normalize(event.name);
    if (nameWords.length === 0) continue;
    const overlap = nameWords.filter((w) => words.has(w)).length;
    const score = overlap / nameWords.length;
    if (!best || score > best.score) best = { event, score };
  }
  if (!best || best.score === 0) return null;
  return { event: best.event, confident: best.score >= 0.6 };
}
