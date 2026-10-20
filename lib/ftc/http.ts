import "server-only";
import { FTC_API_BASE_URL, getFtcCredentials } from "./config";
import type { ActionError } from "./types";

export class FtcApiError extends Error {
  code: ActionError["code"];
  constructor(code: ActionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

// Short-lived in-memory dedupe cache: several components can ask for the same
// event's data within the same render pass (or in quick succession) without
// each one hammering the upstream API. This is deliberately tiny/server-local —
// the longer-lived "don't refetch across pages" cache lives client-side in
// use-ftc-query.ts.
const DEDUPE_TTL_MS = 20_000;
const dedupeCache = new Map<string, { expires: number; promise: Promise<unknown> }>();

function buildUrl(path: string, searchParams?: Record<string, string | number | undefined>) {
  const url = new URL(`${FTC_API_BASE_URL}${path}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const credentials = getFtcCredentials();
  if (!credentials) {
    throw new FtcApiError("missing_credentials", "FTC_API_USERNAME / FTC_API_KEY are not configured.");
  }

  const token = Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    throw new FtcApiError("network_error", "Could not reach the FIRST API.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new FtcApiError("unauthorized", "FIRST API rejected the configured credentials.");
  }
  if (response.status === 404) {
    throw new FtcApiError("not_found", "The requested resource was not found.");
  }
  if (response.status === 429) {
    throw new FtcApiError("rate_limited", "FIRST API rate limit was hit. Try again shortly.");
  }
  if (!response.ok) {
    throw new FtcApiError("upstream_error", `FIRST API returned ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function ftcFetch<T>(path: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
  const url = buildUrl(path, searchParams);
  const now = Date.now();
  const cached = dedupeCache.get(url);
  if (cached && cached.expires > now) {
    return cached.promise as Promise<T>;
  }

  const promise = fetchJson<T>(url);
  dedupeCache.set(url, { expires: now + DEDUPE_TTL_MS, promise });
  // Don't let a cached rejection poison subsequent calls past this request.
  promise.catch(() => dedupeCache.delete(url));
  return promise;
}
