/** P7: parses a pasted livestream link into a platform + embeddable id. Pure — no network calls (see detect-event's route for the oEmbed lookup, which does need one). */

export type StreamPlatform = "youtube" | "twitch";
export type ParsedStream = { platform: StreamPlatform; id: string; url: string };

const YOUTUBE_PATTERNS = [
  /youtube\.com\/watch\?v=([\w-]{11})/,
  /youtube\.com\/live\/([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
];

const TWITCH_PATTERN = /twitch\.tv\/([a-zA-Z0-9_]{3,25})(?:\/|$|\?)/;

/** Returns null for anything that isn't a recognizable YouTube/Twitch link. */
export function parseStreamUrl(url: string): ParsedStream | null {
  const trimmed = url.trim();
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return { platform: "youtube", id: match[1], url: trimmed };
  }
  const twitchMatch = TWITCH_PATTERN.exec(trimmed);
  if (twitchMatch) return { platform: "twitch", id: twitchMatch[1], url: trimmed };
  return null;
}

/** `parentDomain` is required by Twitch's embed (it checks the referrer) — pass `location.hostname` client-side. */
export function embedUrlFor(stream: ParsedStream, parentDomain?: string): string {
  if (stream.platform === "youtube") {
    return `https://www.youtube.com/embed/${stream.id}?enablejsapi=1`;
  }
  const parent = parentDomain ?? "localhost";
  return `https://player.twitch.tv/?channel=${stream.id}&parent=${parent}&autoplay=true`;
}
