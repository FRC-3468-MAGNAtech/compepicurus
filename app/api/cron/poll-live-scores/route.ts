import { NextResponse } from "next/server";
import { getAdminFirestore, getAdminMessaging } from "@/lib/firebase/admin";
import { resolvePendingLiveMatches } from "@/lib/live/resolve-pending";

/**
 * P7: the score-ready poller. Call every 2-5 minutes from a free external
 * scheduler (cron-job.org, a GitHub Actions schedule, ...) sending
 * `Authorization: Bearer <CRON_SECRET>` — Vercel's own Hobby-plan cron only
 * runs once a day at an inexact time, nowhere close to fast enough; see
 * docs/DEPLOYMENT.md for exact setup steps and `vercel.json` for the daily
 * fallback entry. Unverified in this sandbox — no real live event or
 * scheduler to run it against (see docs/ASSUMPTIONS.md, P7); the logic
 * itself (`lib/live/resolve-pending.ts`) is unit-tested indirectly through
 * its pure building blocks (`resolveLiveAllianceScoring`,
 * `isAllianceReadyToNotify`).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });
  const messaging = getAdminMessaging();

  try {
    const result = await resolvePendingLiveMatches(db, messaging);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("poll-live-scores failed:", err);
    return NextResponse.json({ ok: false, error: "Internal error." }, { status: 500 });
  }
}
