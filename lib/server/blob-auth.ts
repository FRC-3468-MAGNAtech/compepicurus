// Who may upload or delete a form photo. Pure and injectable (no next/server, no Firebase): the routes in app/api/blob/*
// verify the Firebase ID token (401 when it is missing or invalid, handled there) and wire the Admin SDK deps; every
// decision after "this is uid X" lives here so it can be unit-tested.
import { MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES, parseBlobPath, uidTagOf, validateUploadRequest, type BlobPathParts } from "@/lib/blob/paths";
import { canAccessPage, type AccessUser, type PageAccessConfig } from "@/lib/page-access/access";
import { DEFAULT_ROLE_ID, ROLES, type RoleId } from "@/lib/roles";

/** The built-in forms each belong to a (restricted) page; the photo rules follow the page's access rules. */
const FORM_PAGES: Record<string, string> = {
  "lead-scout-v1": "lead-scout-form",
  "pit-scout-v1": "pit-scout-form",
  "team-strategy-v1": "team-strategy-form",
  "match-strategy-v1": "match-strategy-form",
  "drive-reflection-v1": "drive-reflection-form",
  "helper-v1": "helper-form",
};

/** Any other (custom) form is filled in from the Match Scout page, which is open to the whole team. */
export const CUSTOM_FORM_PAGE_ID = "match-scout-form";

export function pageIdForForm(formId: string): string {
  return Object.prototype.hasOwnProperty.call(FORM_PAGES, formId) ? FORM_PAGES[formId] : CUSTOM_FORM_PAGE_ID;
}

/** What the client sends as `clientPayload` (a JSON string) with every upload. */
export type BlobClientPayload = { formId: string; kind: string; teamId: string; eventCode: string; teamNumber: string };

/** The fields of `users/{uid}` this module reads. Everything is `unknown` because it comes from Firestore. */
export type BlobUserDoc = { teamId?: unknown; primaryRole?: unknown; secondaryRoles?: unknown; isAdmin?: unknown; isOwner?: unknown };

export type BlobAuthDeps = {
  /** `users/{uid}`, or null when it doesn't exist. */
  getUser: (uid: string) => Promise<BlobUserDoc | null>;
  /** The team's page access config (already parsed with `parsePageAccess`), or null for the defaults. */
  getPageAccessConfig: (teamId: string) => Promise<PageAccessConfig | null | undefined>;
};

export type BlobDenied = { ok: false; status: number; code: string; message: string };

export type BlobUploadAllowed = {
  ok: true;
  /** JSON string stored in the client token (echoed back to onUploadCompleted, which we don't rely on). */
  tokenPayload: string;
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: false;
  allowOverwrite: false;
};

const deny = (status: number, code: string, message: string): BlobDenied => ({ ok: false, status, code, message });

const ROLE_IDS = new Set<string>(ROLES.map((r) => r.id));
const isRole = (v: unknown): v is RoleId => typeof v === "string" && ROLE_IDS.has(v);

/** Turns the stored user doc into what `canAccessPage` needs. A missing or unknown primary role is the default role, as elsewhere in the app. */
function toAccessUser(uid: string, doc: BlobUserDoc): AccessUser {
  return {
    uid,
    isAdmin: doc.isAdmin === true,
    isOwner: doc.isOwner === true,
    primaryRole: isRole(doc.primaryRole) ? doc.primaryRole : DEFAULT_ROLE_ID,
    secondaryRoles: Array.isArray(doc.secondaryRoles) ? doc.secondaryRoles.filter(isRole) : [],
  };
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** Reads and shape-checks the JSON `clientPayload`. null when it isn't what our client sends. */
export function parseClientPayload(raw: string | null | undefined): BlobClientPayload | null {
  if (!raw || raw.length > 1000) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const teamNumber = typeof v.teamNumber === "number" ? String(v.teamNumber) : v.teamNumber;
  const formId = str(v.formId, 100);
  const kind = str(v.kind, 24);
  const teamId = str(v.teamId, 64);
  const eventCode = str(v.eventCode, 32);
  const team = str(teamNumber, 16);
  if (!formId || !kind || !teamId || !eventCode || !team) return null;
  return { formId, kind, teamId, eventCode, teamNumber: team };
}

/**
 * The decision behind POST /api/blob/upload (after the route has verified the caller's ID token).
 *
 * `contentType` and `size` are optional: the token request doesn't carry them (the token itself enforces
 * `allowedContentTypes` and `maximumSizeInBytes` on the actual upload), but a caller that knows them gets them checked too.
 */
export async function authorizeBlobUpload(input: {
  uid: string;
  pathname: string;
  clientPayload: string | null | undefined;
  contentType?: string;
  size?: number;
  deps: BlobAuthDeps;
}): Promise<BlobUploadAllowed | BlobDenied> {
  const { uid, pathname, deps } = input;

  const payload = parseClientPayload(input.clientPayload);
  if (!payload) return deny(400, "bad-payload", "That upload request couldn't be read.");

  const parts = parseBlobPath(pathname);
  if (!parts) return deny(400, "bad-path", "That upload path isn't valid.");

  if (input.contentType !== undefined || input.size !== undefined) {
    const v = validateUploadRequest({ pathname, contentType: input.contentType ?? ALLOWED_IMAGE_TYPES[0], size: input.size });
    if (!v.ok) return deny(v.code === "bad-type" ? 415 : v.code === "too-large" ? 413 : 400, v.code, v.message);
  }

  const userDoc = await deps.getUser(uid);
  if (!userDoc) return deny(403, "unknown-user", "Your account isn't set up yet.");
  const userTeamId = typeof userDoc.teamId === "string" ? userDoc.teamId : "";
  if (!userTeamId || userTeamId !== payload.teamId) return deny(403, "wrong-team", "You can only upload photos for your own team.");

  // The path is what ends up in a public URL, so it has to agree with the payload we authorized and be the caller's own.
  if (parts.kind !== payload.kind || parts.teamId !== payload.teamId || parts.eventCode !== payload.eventCode || parts.teamNumber !== payload.teamNumber) {
    return deny(403, "path-mismatch", "The upload path doesn't match the request.");
  }
  if (parts.uidTag !== (await uidTagOf(uid))) return deny(403, "not-your-path", "That upload path belongs to someone else.");

  const config = await deps.getPageAccessConfig(userTeamId);
  if (!canAccessPage(toAccessUser(uid, userDoc), pageIdForForm(payload.formId), config)) {
    return deny(403, "no-page-access", "You don't have access to this form.");
  }

  return {
    ok: true,
    tokenPayload: JSON.stringify({ uid, ...payload }),
    allowedContentTypes: [...ALLOWED_IMAGE_TYPES],
    maximumSizeInBytes: MAX_IMAGE_BYTES,
    // The path already carries 128 bits of randomness, so no suffix, and a second upload to the same path is always a bug or an attack.
    addRandomSuffix: false,
    allowOverwrite: false,
  };
}

/** `https://<store>.public.blob.vercel-storage.com/<pathname>` -> pathname; null for any other URL. */
export function blobPathnameFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname.endsWith(".blob.vercel-storage.com") || u.search || u.hash) return null;
  try {
    return decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

/**
 * The decision behind POST /api/blob/delete: the file must be in the caller's team folder, and be the caller's own upload
 * unless the caller is an admin or the team owner.
 */
export async function authorizeBlobDelete(input: {
  uid: string;
  url: string;
  deps: Pick<BlobAuthDeps, "getUser">;
}): Promise<{ ok: true; pathname: string; parts: BlobPathParts } | BlobDenied> {
  const pathname = blobPathnameFromUrl(input.url);
  if (!pathname) return deny(400, "bad-url", "That isn't one of our photo links.");
  const parts = parseBlobPath(pathname);
  if (!parts) return deny(400, "bad-path", "That isn't one of our photo links.");

  const userDoc = await input.deps.getUser(input.uid);
  if (!userDoc) return deny(403, "unknown-user", "Your account isn't set up yet.");
  const userTeamId = typeof userDoc.teamId === "string" ? userDoc.teamId : "";
  if (!userTeamId || userTeamId !== parts.teamId) return deny(403, "wrong-team", "That photo belongs to another team.");

  const privileged = userDoc.isAdmin === true || userDoc.isOwner === true;
  if (!privileged && parts.uidTag !== (await uidTagOf(input.uid))) return deny(403, "not-yours", "Only the person who uploaded a photo, or an admin, can delete it.");
  return { ok: true, pathname, parts };
}
