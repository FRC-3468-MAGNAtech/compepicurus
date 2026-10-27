import { NextResponse } from "next/server";
import { getEvents } from "@/lib/ftc/actions";
import { getDefaultSeason } from "@/lib/ftc/config";
import { matchEventFromText } from "@/lib/live/matching";
import { parseStreamUrl } from "@/lib/live/stream";

/**
 * P7: given a pasted livestream link, tries to detect the FTC event. Runs
 * server-side because the browser can't call YouTube's oEmbed endpoint
 * cross-origin reliably in every case, and because `getEvents` (a Server
 * Action) already requires a signed-in session — this route inherits that
 * gate for free rather than duplicating it.
 *
 * YouTube: a real oEmbed title lookup (no API key needed). Twitch: no
 * reliable, keyless oEmbed exists anymore, so only the channel name itself
 * is used as a (weak) match signal — in practice this means Twitch links
 * fall back to the manual event picker far more often than YouTube ones;
 * see docs/ASSUMPTIONS.md (P7).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  const season = typeof body?.season === "number" ? body.season : getDefaultSeason();
  if (!url) return NextResponse.json({ ok: false, error: "Missing url." }, { status: 400 });

  const stream = parseStreamUrl(url);
  if (!stream) return NextResponse.json({ ok: true, detected: null, reason: "unrecognized-link" });

  let text = "";
  if (stream.platform === "youtube") {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(stream.url)}&format=json`;
      const res = await fetch(oembedUrl);
      if (res.ok) {
        const data = (await res.json()) as { title?: string; author_name?: string };
        text = `${data.title ?? ""} ${data.author_name ?? ""}`;
      }
    } catch {
      // Falls through to the manual event picker — see the function doc comment.
    }
  } else {
    text = stream.id;
  }

  const eventsResult = await getEvents({ season });
  if (!eventsResult.ok) {
    return NextResponse.json({ ok: true, detected: null, reason: "events-unavailable" });
  }

  const match = text ? matchEventFromText(text, eventsResult.data) : null;
  return NextResponse.json({ ok: true, detected: match ? { event: match.event, confident: match.confident } : null });
}
