import { NextResponse } from "next/server";
import { getAdminFirestore, getAdminMessaging } from "@/lib/firebase/admin";
import { requireUser } from "@/lib/server/require-user";
import { resolvePendingLiveMatches } from "@/lib/live/resolve-pending";
import { LIVE_CONFIG } from "@/lib/live/config";

/**
 * P7: the client-side fallback — while a scout has a pending live session,
 * the app calls this every minute (see lib/live/config.ts's
 * CLIENT_SCORE_POLL_INTERVAL_MS) so score-ready notifications still work
 * even if the external scheduler for app/api/cron/poll-live-scores isn't
 * set up. Scoped to the caller's own sessions only — the cron route is
 * what sweeps every team's pending matches.
 *
 * Rate-limited server-side (in addition to the client's own interval) so a
 * stray fast poller can't hammer the FIRST API — best-effort, in-memory
 * per-uid timestamps. Vercel serverless instances are ephemeral and can
 * run several in parallel, so this isn't a hard guarantee across
 * instances, only a cheap backstop on top of the client's own pacing; see
 * docs/ASSUMPTIONS.md (P7).
 */
const lastCallByUid = new Map<string, number>();
const MIN_INTERVAL_MS = LIVE_CONFIG.CLIENT_SCORE_POLL_INTERVAL_MS / 2;

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const lastCall = lastCallByUid.get(user.uid);
  if (lastCall && Date.now() - lastCall < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true, checked: 0, resolved: 0, rateLimited: true });
  }
  lastCallByUid.set(user.uid, Date.now());

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });
  const messaging = getAdminMessaging();

  try {
    const result = await resolvePendingLiveMatches(db, messaging, user.uid);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("check-scores failed:", err);
    return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  }
}
