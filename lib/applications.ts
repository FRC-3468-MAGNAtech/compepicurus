// P20: pure logic for team applications (no React, no Firebase): input sanitizing and validation, the
// disposable-email check, canonical email keys, name matching against the FIRST API, and expiry. The server
// route (app/api/applications) and the form share it, so the limits a visitor sees are the limits enforced.

import { DISPOSABLE_EMAIL_DOMAINS } from "@/lib/disposable-domains";
import { parseFieldTeamNumber } from "@/lib/field-teams";
import { ROLES, type RoleId } from "@/lib/roles";

export type ApplicationStatus = "pending" | "approved" | "rejected" | "blocked" | "expired";

/** The status an applicant sees: a block is shown as a rejection (it doesn't announce itself). */
export type ApplicantFacingStatus = "pending" | "approved" | "rejected" | "expired";

export const APPLICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const APPLICATION_LIMITS = {
  name: 80,
  teamName: 80,
  verification: 1200,
  verificationMin: 20,
  link: 300,
  reason: 500,
  notes: 2000,
  /** A human can't read and fill the form faster than this (a signed start token proves how long it was open). */
  minFillMs: 4000,
  maxFillMs: 2 * 60 * 60 * 1000,
  perIpPerHour: 3,
  perEmailPerHour: 3,
} as const;

export type ApplicationInput = {
  name: string;
  teamNumber: number;
  teamName: string;
  role: RoleId;
  verification: string;
  link: string | null;
};

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

/** Strips control and bidi/zero-width characters, collapses whitespace to single spaces, trims and bounds the length. */
export function sanitizeLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Like `sanitizeLine` but keeps line breaks (at most one blank line in a row). */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** An http(s) URL no longer than the limit, or `null`. (Whitespace and angle brackets are never valid in the stored link.) */
export function sanitizeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > APPLICATION_LIMITS.link || /[\s<>"']/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * The email with the tricks that make one mailbox look like many removed: lowercase, no `+tag`, and no dots
 * for Gmail. This is the key for "one pending application per email" and for blocking an email.
 */
export function canonicalEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") return `${local.replace(/\./g, "")}@gmail.com`;
  return `${local}@${domain}`;
}

/** True for a listed throwaway domain or any subdomain of one. */
export function isDisposableEmail(email: string, domains: readonly string[] = DISPOSABLE_EMAIL_DOMAINS): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

/** A signal for the reviewer (a school or team domain is a stronger sign than a free mailbox, never a requirement). */
export function isFreeEmailProvider(email: string): boolean {
  return FREE_MAIL.has(emailDomain(email));
}

function normalizeForCompare(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(team|ftc|robotics|robotic|club|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does the name the applicant typed plausibly match FIRST's name for the team? Compares loosely (case,
 * punctuation, and filler words like "Team"/"Robotics" don't matter) and accepts one containing the other,
 * since FIRST lists both a short and a long (sponsor-laden) name.
 */
export function nameMatches(entered: string, official: string | null | undefined): boolean {
  if (!official) return false;
  const a = normalizeForCompare(entered);
  const b = normalizeForCompare(official);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export type ApplicationErrors = Partial<Record<"name" | "teamNumber" | "teamName" | "role" | "verification" | "link", string>>;

const ROLE_IDS = new Set<string>(ROLES.map((r) => r.id));

/** Validates and sanitizes the form body. Every string is cleaned and bounded; anything else is rejected, not coerced. */
export function validateApplication(raw: unknown): { ok: true; value: ApplicationInput } | { ok: false; errors: ApplicationErrors } {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: ApplicationErrors = {};

  const name = sanitizeLine(body.name, APPLICATION_LIMITS.name);
  if (name.length < 2) errors.name = "Enter your name.";

  const teamNumber = parseFieldTeamNumber(typeof body.teamNumber === "number" || typeof body.teamNumber === "string" ? body.teamNumber : null);
  if (teamNumber === null) errors.teamNumber = "Enter your FTC team number (1 to 5 digits).";

  const teamName = sanitizeLine(body.teamName, APPLICATION_LIMITS.teamName);

  const role = typeof body.role === "string" && ROLE_IDS.has(body.role) ? (body.role as RoleId) : null;
  if (!role) errors.role = "Choose your role on the team.";

  const verification = sanitizeText(body.verification, APPLICATION_LIMITS.verification);
  if (verification.length < APPLICATION_LIMITS.verificationMin) errors.verification = `Tell us a little more (at least ${APPLICATION_LIMITS.verificationMin} characters).`;

  const rawLink = typeof body.link === "string" ? body.link.trim() : "";
  const link = rawLink ? sanitizeLink(rawLink) : null;
  if (rawLink && !link) errors.link = "That doesn't look like a web link (it should start with https://).";

  if (Object.keys(errors).length > 0 || teamNumber === null || !role) return { ok: false, errors };
  return { ok: true, value: { name, teamNumber, teamName, role, verification, link } };
}

/** A stored application as the app reads it (timestamps as milliseconds). */
export type ApplicationLike = { status: ApplicationStatus; expiresAtMs: number | null };

/** `pending` past its expiry is `expired` (applications expire after 30 days; nothing needs to run to make that true). */
export function effectiveStatus(app: ApplicationLike, nowMs: number): ApplicationStatus {
  if (app.status === "pending" && app.expiresAtMs !== null && app.expiresAtMs <= nowMs) return "expired";
  return app.status;
}

export function applicantFacingStatus(status: ApplicationStatus): ApplicantFacingStatus {
  return status === "blocked" ? "rejected" : status;
}

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  blocked: "Blocked",
  expired: "Expired",
};

/** The signals shown to the platform owner next to an application. */
export type ApplicationSignals = {
  emailVerified: boolean;
  signInProvider: string | null;
  /** How old the sign-in account is, in ms (null when unknown). */
  accountAgeMs: number | null;
  firstApi: { season: number; status: "found" | "not-found" | "error"; officialName: string | null; nameMatches: boolean | null };
  turnstile: "passed" | "not-configured";
  fillSeconds: number;
  /** Applications from this IP in the last hour, this one included. */
  ipApplicationsLastHour: number;
  emailDomain: string;
  freeEmailProvider: boolean;
  /** An account whose FTC teams already include this number (the platform owner should check before approving). */
  existingAccountForNumber: boolean;
};

export type SignalTone = "good" | "warn" | "bad" | "neutral";

/** Turns the raw signals into the labelled chips the review queue shows. Pure so the wording and thresholds are tested. */
export function describeSignals(s: ApplicationSignals): { label: string; detail: string; tone: SignalTone }[] {
  const out: { label: string; detail: string; tone: SignalTone }[] = [];
  out.push(s.emailVerified ? { label: "Email verified", detail: s.signInProvider === "google.com" ? "Verified by Google sign-in" : "Verified by clicking the emailed link", tone: "good" } : { label: "Email not verified", detail: "This should never happen: the route requires it", tone: "bad" });
  if (s.firstApi.status === "found") {
    out.push(
      s.firstApi.nameMatches === false
        ? { label: "Team found, name differs", detail: `FIRST lists this team as "${s.firstApi.officialName ?? "?"}" (${s.firstApi.season} season)`, tone: "warn" }
        : { label: "Team found on FIRST", detail: `"${s.firstApi.officialName ?? "?"}" (${s.firstApi.season} season), name matches`, tone: "good" }
    );
  } else if (s.firstApi.status === "not-found") {
    out.push({ label: "Team not on FIRST", detail: `FIRST has no FTC team with this number for the ${s.firstApi.season} season (a rookie team may not be listed yet)`, tone: "warn" });
  } else {
    out.push({ label: "FIRST check unavailable", detail: "The FIRST API couldn't be reached when this was submitted", tone: "neutral" });
  }
  const ageDays = s.accountAgeMs === null ? null : s.accountAgeMs / 86_400_000;
  out.push(
    ageDays === null
      ? { label: "Account age unknown", detail: "", tone: "neutral" }
      : ageDays < 1
        ? { label: "Brand-new account", detail: `Created ${Math.max(1, Math.round(s.accountAgeMs! / 60_000))} minute(s) before applying`, tone: "warn" }
        : { label: `Account ${Math.floor(ageDays)} day(s) old`, detail: "", tone: "neutral" }
  );
  out.push(s.freeEmailProvider ? { label: "Free email provider", detail: s.emailDomain, tone: "neutral" } : { label: "Custom email domain", detail: s.emailDomain, tone: "good" });
  if (s.turnstile === "not-configured") out.push({ label: "No CAPTCHA", detail: "Turnstile isn't configured, so this applicant wasn't challenged", tone: "warn" });
  else out.push({ label: "CAPTCHA passed", detail: "Cloudflare Turnstile", tone: "good" });
  if (s.ipApplicationsLastHour >= 2) out.push({ label: "Repeated from this network", detail: `${s.ipApplicationsLastHour} applications from the same IP in the last hour`, tone: "warn" });
  if (s.fillSeconds < 15) out.push({ label: "Filled in very quickly", detail: `${s.fillSeconds}s from opening the form`, tone: "warn" });
  if (s.existingAccountForNumber) out.push({ label: "An account already has this team", detail: "Another account lists this FTC team number", tone: "bad" });
  return out;
}
