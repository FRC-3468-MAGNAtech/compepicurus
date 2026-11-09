// Photo-upload paths (Vercel Blob). Pure, and shared by the browser (which builds the path) and the server (which re-parses
// and checks it). Blob URLs are public, so the security of a photo is (a) an unguessable random path with no user-entered
// text in it, and (b) the server only ever issuing upload tokens for paths that parse here and belong to the caller.

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// Compression always outputs JPEG, but when it fails (e.g. a browser that cannot decode HEIC) the original is uploaded as is.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

// Per-segment limits. Generous for real ids (Firestore ids are 20 chars, FTC event codes under ~12) and small enough to keep paths short.
const MAX_LEN = { kind: 24, teamId: 64, eventCode: 32, teamNumber: 16 } as const;
const UID_TAG_LENGTH = 10;
const MIN_RANDOM = 16;
const MAX_RANDOM = 64;
const DEFAULT_RANDOM_BYTES = 16; // 32 hex chars = 128 bits

export type BlobPathParts = { kind: string; teamId: string; eventCode: string; teamNumber: string; uidTag: string; file: string };

export type BuildBlobPathInput = {
  kind: string;
  teamId: string;
  eventCode: string;
  teamNumber: string | number;
  uid: string;
  /** Hex string, 16 to 64 chars. Tests inject it; real callers leave it out. */
  random?: string;
};

export type UploadValidation = { ok: true } | { ok: false; code: "bad-path" | "bad-type" | "too-large"; message: string };

/**
 * Keeps only [A-Za-z0-9_-] and caps the length. Dots and slashes are dropped entirely, so '..' and path separators can
 * never survive into a segment.
 */
export function sanitizeSegment(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, maxLength);
}

/** Lowercase hex of random bytes from Web Crypto (browser and Node 18+). */
export function randomHex(bytes = DEFAULT_RANDOM_BYTES): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * First 10 hex chars of SHA-256(uid). It lets the server tell "this is the caller's own file" without putting the raw uid
 * in a public URL. Async because Web Crypto is the one hash that exists in both the browser and Node.
 */
export async function uidTagOf(uid: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(uid));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, UID_TAG_LENGTH);
}

export class BlobPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobPathError";
  }
}

function requireSegment(label: keyof typeof MAX_LEN, value: unknown): string {
  const clean = sanitizeSegment(value, MAX_LEN[label]);
  // An empty segment would collapse the path ("pit//x"), so refuse rather than guess.
  if (!clean) throw new BlobPathError(`Missing or invalid ${label}.`);
  return clean;
}

/** `${kind}/${teamId}/${eventCode}/${teamNumber}/${uidTag}-${random}.jpg`. Throws BlobPathError when a segment is empty after sanitizing. */
export async function buildBlobPath(input: BuildBlobPathInput): Promise<string> {
  const kind = requireSegment("kind", input.kind);
  const teamId = requireSegment("teamId", input.teamId);
  const eventCode = requireSegment("eventCode", input.eventCode);
  const teamNumber = requireSegment("teamNumber", input.teamNumber);
  if (!input.uid) throw new BlobPathError("Missing uid.");
  const random = input.random ?? randomHex();
  if (!RANDOM_RE.test(random)) throw new BlobPathError("random must be 16 to 64 lowercase hex characters.");
  return `${kind}/${teamId}/${eventCode}/${teamNumber}/${await uidTagOf(input.uid)}-${random}.jpg`;
}

const RANDOM_RE = new RegExp(`^[0-9a-f]{${MIN_RANDOM},${MAX_RANDOM}}$`);
const SEG = (n: number) => `([A-Za-z0-9_-]{1,${n}})`;
const PATH_RE = new RegExp(
  `^${SEG(MAX_LEN.kind)}/${SEG(MAX_LEN.teamId)}/${SEG(MAX_LEN.eventCode)}/${SEG(MAX_LEN.teamNumber)}/([0-9a-f]{${UID_TAG_LENGTH}})-([0-9a-f]{${MIN_RANDOM},${MAX_RANDOM}})\\.jpg$`,
);

/** Strict inverse of buildBlobPath. null for anything else (so '..', extra segments, other extensions and uppercase hex all fail). */
export function parseBlobPath(path: string): BlobPathParts | null {
  if (typeof path !== "string") return null;
  const m = PATH_RE.exec(path);
  if (!m) return null;
  return { kind: m[1], teamId: m[2], eventCode: m[3], teamNumber: m[4], uidTag: m[5], file: `${m[5]}-${m[6]}.jpg` };
}

/** Lowercases and drops parameters ("image/JPEG; charset=x" -> "image/jpeg"). */
export const normalizeContentType = (contentType: string): string => String(contentType ?? "").split(";")[0].trim().toLowerCase();

export function isAllowedImageType(contentType: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(normalizeContentType(contentType));
}

/** The checks both the browser (before queuing) and the server (before issuing a token) make. `size` is optional because the token request does not know it. */
export function validateUploadRequest(input: { pathname: string; contentType: string; size?: number }): UploadValidation {
  if (!parseBlobPath(input.pathname)) return { ok: false, code: "bad-path", message: "That upload path isn't valid." };
  if (!isAllowedImageType(input.contentType)) return { ok: false, code: "bad-type", message: "Only JPEG, PNG, WebP or HEIC photos can be uploaded." };
  if (input.size !== undefined && (!Number.isFinite(input.size) || input.size < 0 || input.size > MAX_IMAGE_BYTES)) {
    return { ok: false, code: "too-large", message: "That photo is too large (6 MB at most)." };
  }
  return { ok: true };
}
