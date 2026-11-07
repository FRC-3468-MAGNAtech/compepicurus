import { stripHtml } from "@/lib/forms/sanitize";
import {
  BIO_MAX,
  DEFAULT_AVATAR,
  DEFAULT_PROFILE_VISIBILITY,
  DISPLAY_NAME_MAX,
  PRONOUNS_MAX,
  presetById,
  type AvatarChoice,
  type ProfileVisibility,
} from "@/lib/profile/config";

// P25: the profile document and the pure rules around it (shared by the pages and mirrored by firestore.rules).

/** `profiles/{uid}`. Created on the member's first save; until then the defaults below apply. */
export type ProfileDoc = {
  teamId: string;
  /** Shown in the profile header only; falls back to the account name. */
  displayName: string;
  bio: string;
  pronouns: string;
  avatar: AvatarChoice;
  /** The member's PREFERENCE. What applies is effectiveVisibility(): admins are always visible. */
  visibility: ProfileVisibility;
  updatedAt?: unknown;
};

export function parseAvatar(raw: unknown): AvatarChoice {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if ((r.type === "google" || r.type === "initials" || r.type === "preset") && typeof r.value === "string") {
      if (r.type === "preset" && !presetById(r.value)) return DEFAULT_AVATAR;
      if (r.type === "google" && !isGoogleAvatarUrl(r.value)) return DEFAULT_AVATAR;
      return { type: r.type, value: r.value };
    }
  }
  return DEFAULT_AVATAR;
}

/** Google profile pictures only: an https URL on googleusercontent.com (also what the rules accept). */
export function isGoogleAvatarUrl(url: string): boolean {
  return url.length <= 500 && /^https:\/\/lh[0-9]\.googleusercontent\.com\/[^\s]*$/.test(url);
}

export function parseProfile(raw: Record<string, unknown> | undefined, teamId: string): ProfileDoc {
  const d = raw ?? {};
  return {
    teamId,
    displayName: typeof d.displayName === "string" ? d.displayName : "",
    bio: typeof d.bio === "string" ? d.bio : "",
    pronouns: typeof d.pronouns === "string" ? d.pronouns : "",
    avatar: parseAvatar(d.avatar),
    visibility: d.visibility === "private" || d.visibility === "public" ? d.visibility : DEFAULT_PROFILE_VISIBILITY,
    updatedAt: d.updatedAt,
  };
}

/** Plain text only: tags and control characters removed, runs of blank lines collapsed, trimmed, capped. */
export function sanitizeProfileText(input: string, max: number, opts: { multiline?: boolean } = {}): string {
  let s = stripHtml(String(input ?? ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n");
  s = opts.multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

export const sanitizeBio = (s: string) => sanitizeProfileText(s, BIO_MAX, { multiline: true });
export const sanitizePronouns = (s: string) => sanitizeProfileText(s, PRONOUNS_MAX);
export const sanitizeDisplayName = (s: string) => sanitizeProfileText(s, DISPLAY_NAME_MAX);

/** Admins and the owner (an owner's admin flag stays on) are always visible to teammates; everyone else follows their preference. */
export function effectiveVisibility(input: { visibility: ProfileVisibility | null | undefined; isAdmin: boolean }): ProfileVisibility {
  if (input.isAdmin) return "public";
  return input.visibility ?? DEFAULT_PROFILE_VISIBILITY;
}

export type ProfileAccess = "full" | "limited";

/** What a viewer sees: everything, or only avatar, name and primary role ("This profile is private"). */
export function profileAccess(input: { viewerUid: string; viewerIsAdmin: boolean; targetUid: string; targetIsAdmin: boolean; visibility: ProfileVisibility | null | undefined }): ProfileAccess {
  if (input.viewerUid === input.targetUid || input.viewerIsAdmin) return "full";
  return effectiveVisibility({ visibility: input.visibility, isAdmin: input.targetIsAdmin }) === "public" ? "full" : "limited";
}

/**
 * The visibility to write when saving. An admin's toggle is disabled (the rules refuse a change), so they keep what
 * they had — their saved preference comes back if they are ever demoted — and a first save as an admin is public.
 */
export function visibilityToSave(input: { isAdmin: boolean; chosen: ProfileVisibility; existing: ProfileVisibility | null }): ProfileVisibility {
  if (input.isAdmin) return input.existing ?? "public";
  return input.chosen;
}

/** Admins can clear a teammate's bio / pronouns (never write them). The owner's own row is only theirs to edit. */
export function canModerateProfile(input: { viewerUid: string; viewerIsAdmin: boolean; targetUid: string; targetIsOwner: boolean }): boolean {
  return input.viewerIsAdmin && input.viewerUid !== input.targetUid && !input.targetIsOwner;
}

/** The header name: the profile's display name when set, else the account name. */
export const headerName = (profile: Pick<ProfileDoc, "displayName"> | null, accountName: string): string => profile?.displayName?.trim() || accountName;

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
