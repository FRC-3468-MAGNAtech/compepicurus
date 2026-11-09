import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { authorizeBlobDelete } from "@/lib/server/blob-auth";

const MAX_BODY_BYTES = 4 * 1024;

const json = (body: Record<string, unknown>, status: number) => NextResponse.json({ ok: false, ...body }, { status });

/**
 * Deletes one form photo. Body: { url }. Only the uploader or an admin/owner of the same team may (see authorizeBlobDelete).
 * Blob URLs are public, so the URL alone proves nothing: the check is on the Firebase token and the path's team and uid tag.
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ code: "not-configured", error: "Photo uploads aren't set up on this server." }, 503);

  const decoded = await verifyBearerToken(request);
  if (!decoded) return json({ code: "not-signed-in", error: "Not signed in." }, 401);
  const db = getAdminFirestore();
  if (!db) return json({ code: "not-configured", error: "Server isn't configured." }, 503);

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ code: "too-large", error: "That's too large." }, 413);
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return json({ code: "too-large", error: "That's too large." }, 413);
  let url: unknown;
  try {
    url = (JSON.parse(raw) as { url?: unknown } | null)?.url;
  } catch {
    url = undefined;
  }
  if (typeof url !== "string" || !url) return json({ code: "bad-request", error: "That request couldn't be read." }, 400);

  const decision = await authorizeBlobDelete({
    uid: decoded.uid,
    url,
    deps: {
      getUser: async (id) => {
        const snap = await db.doc(`users/${id}`).get();
        return snap.exists ? (snap.data() ?? null) : null;
      },
    },
  });
  if (!decision.ok) return json({ code: decision.code, error: decision.message }, decision.status);

  try {
    // Delete by the pathname we validated, not the caller's URL string.
    await del(decision.pathname);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("blob delete failed:", err instanceof Error ? err.message : err);
    return json({ code: "error", error: "Something went wrong." }, 500);
  }
}
