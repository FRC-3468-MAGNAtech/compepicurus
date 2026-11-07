import { NextResponse } from "next/server";
import { issueStartToken } from "@/lib/server/application-token";

/**
 * P20: the application form calls this when it opens. The signed token it returns proves how long the form
 * has been open (the minimum time-to-submit check), so a bot can't just claim it took a minute. No data is
 * stored and no sign-in is needed; the token carries nothing about the visitor.
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, token: issueStartToken() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });
  }
}
