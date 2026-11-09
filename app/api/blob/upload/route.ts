import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { parsePageAccess } from "@/lib/page-access/access";
import { verifyBearerToken } from "@/lib/server/require-user";
import { authorizeBlobUpload, type BlobAuthDeps } from "@/lib/server/blob-auth";

// The token request is a few hundred bytes of JSON (the photo itself goes browser -> Vercel Blob directly).
const MAX_BODY_BYTES = 8 * 1024;

const json = (body: Record<string, unknown>, status: number) => NextResponse.json({ ok: false, ...body }, { status });

/**
 * Photo uploads, step 1: the browser asks for a one-use upload token for ONE path. The token request body is the standard
 * `handleUpload` body; our client adds `Authorization: Bearer <Firebase ID token>` and a JSON `clientPayload`
 * ({ formId, kind, teamId, eventCode, teamNumber }). All the rules live in lib/server/blob-auth.ts `authorizeBlobUpload`.
 *
 * The same endpoint also receives Vercel's "upload completed" webhook, which is signed by Vercel (handleUpload verifies
 * the signature) and carries no Firebase token, so it is let through to handleUpload without our auth (and does nothing).
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ code: "not-configured", error: "Photo uploads aren't set up on this server." }, 503);

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ code: "too-large", error: "That's too large." }, 413);
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return json({ code: "too-large", error: "That's too large." }, 413);
  let body: HandleUploadBody;
  try {
    body = JSON.parse(raw) as HandleUploadBody;
  } catch {
    return json({ code: "bad-request", error: "That request couldn't be read." }, 400);
  }
  if (!body || typeof body !== "object" || typeof body.type !== "string") return json({ code: "bad-request", error: "That request couldn't be read." }, 400);

  let uid: string | null = null;
  if (body.type === "blob.generate-client-token") {
    const decoded = await verifyBearerToken(request);
    if (!decoded) return json({ code: "not-signed-in", error: "Not signed in." }, 401);
    uid = decoded.uid;
  }

  const db = getAdminFirestore();
  if (!db) return json({ code: "not-configured", error: "Server isn't configured." }, 503);
  const deps: BlobAuthDeps = {
    getUser: async (id) => {
      const snap = await db.doc(`users/${id}`).get();
      return snap.exists ? (snap.data() ?? null) : null;
    },
    getPageAccessConfig: async (teamId) => {
      const snap = await db.doc(`teams/${teamId}/settings/pageAccess`).get();
      return parsePageAccess(snap.exists ? snap.data() : undefined);
    },
  };

  // handleUpload throws for the token event when onBeforeGenerateToken throws; carry our decision out of the callback.
  let denied: { status: number; code: string; message: string } | null = null;
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const decision = await authorizeBlobUpload({ uid: uid ?? "", pathname, clientPayload, deps });
        if (!decision.ok) {
          denied = { status: decision.status, code: decision.code, message: decision.message };
          throw new Error(decision.code);
        }
        const { ok: _ok, ...options } = decision;
        void _ok;
        return options;
      },
      // Vercel calls this when the upload finishes, but it can't reach localhost and we never depend on it: the browser
      // gets the URL straight from upload() and saves it with the form. Nothing to do here.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    if (denied) {
      const d: { status: number; code: string; message: string } = denied;
      return json({ code: d.code, error: d.message }, d.status);
    }
    console.error("blob upload route failed:", err instanceof Error ? err.message : err);
    return json({ code: "error", error: "Something went wrong." }, 400);
  }
}
