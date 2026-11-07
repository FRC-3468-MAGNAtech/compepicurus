"use client";

import { auth } from "@/lib/firebase/client";

/** A failed API call, with the route's machine-readable `code` (and per-field errors for form validation) kept. */
export class ApiError extends Error {
  status: number;
  code: string | null;
  fields: Record<string, string> | null;
  constructor(message: string, status: number, code: string | null, fields: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/**
 * Calls one of our own API routes with the signed-in user's fresh ID token (`Authorization: Bearer`), the same
 * way lib/team-enrollment.ts does, but keeping the status, `code` and `fields` so callers can react to a specific
 * refusal ("email-unverified", "reauth-required", ...). Throws ApiError on any non-2xx or `{ ok: false }` answer.
 */
export async function authedApi<T = Record<string, unknown>>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  if (!auth.currentUser) throw new ApiError("Not signed in.", 401, "not-signed-in", null);
  const idToken = await auth.currentUser.getIdToken();
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${idToken}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new ApiError(
      typeof json.error === "string" ? json.error : "Something went wrong.",
      res.status,
      typeof json.code === "string" ? json.code : null,
      json.fields && typeof json.fields === "object" ? (json.fields as Record<string, string>) : null
    );
  }
  return json as T;
}
