import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { handleTemplateAction, TemplateRouteError } from "@/lib/server/templates";

// A form template can be 256 KB; the body adds a little to that.
const MAX_BODY_BYTES = 320 * 1024;

/**
 * P23: the server side of form templates (see lib/server/templates.ts for each action): request-publish, update-public, unpublish, report, import
 * (returns the template and counts the use), and the platform owner's approve / reject / take-down / set-official / dismiss-reports / seed-official.
 */
export async function POST(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, code: "not-signed-in", error: "Not signed in." }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, code: "not-configured", error: "Server isn't configured." }, { status: 503 });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "too-large", error: "That's too large." }, { status: 413 });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "too-large", error: "That's too large." }, { status: 413 });
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ ok: false, code: "bad-request", error: "That request couldn't be read." }, { status: 400 });

  try {
    return NextResponse.json(await handleTemplateAction(db, decoded, body));
  } catch (err) {
    if (err instanceof TemplateRouteError) return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: err.status });
    console.error("templates route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, code: "error", error: "Something went wrong." }, { status: 500 });
  }
}
