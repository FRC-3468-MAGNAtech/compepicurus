import { describe, expect, it } from "vitest";
import {
  APPLICATION_LIMITS,
  APPLICATION_TTL_MS,
  applicantFacingStatus,
  canonicalEmail,
  describeSignals,
  effectiveStatus,
  isDisposableEmail,
  isFreeEmailProvider,
  nameMatches,
  sanitizeLine,
  sanitizeLink,
  sanitizeText,
  validateApplication,
  type ApplicationSignals,
} from "./applications";

const good = {
  name: "  Ada   Lovelace ",
  teamNumber: "35792",
  teamName: "Alpha Bots",
  role: "team-coach",
  verification: "I'm the lead mentor; our team page is linked below.",
  link: "https://example.org/team",
};

describe("sanitizing", () => {
  it("strips control, zero-width and bidi characters and collapses whitespace", () => {
    expect(sanitizeLine("a\u0000b​c‮d   \n e", 50)).toBe("abcd e");
  });
  it("bounds length and ignores non-strings", () => {
    expect(sanitizeLine("x".repeat(500), 10)).toHaveLength(10);
    expect(sanitizeLine(42, 10)).toBe("");
    expect(sanitizeText({}, 10)).toBe("");
  });
  it("keeps line breaks in free text but never more than one blank line", () => {
    expect(sanitizeText("one\r\ntwo\n\n\n\nthree  \tx", 100)).toBe("one\ntwo\n\nthree x");
  });
  it("accepts only http(s) links without spaces or quotes", () => {
    expect(sanitizeLink("https://example.org/a?b=1")).toBe("https://example.org/a?b=1");
    expect(sanitizeLink("http://example.org")).toBe("http://example.org/");
    for (const bad of ["javascript:alert(1)", "ftp://x.org", "not a url", "https://x.org/<script>", "", `https://x.org/${"a".repeat(400)}`]) {
      expect(sanitizeLink(bad)).toBeNull();
    }
  });
});

describe("validateApplication", () => {
  it("accepts a good body and cleans it", () => {
    const r = validateApplication(good);
    expect(r).toEqual({ ok: true, value: { name: "Ada Lovelace", teamNumber: 35792, teamName: "Alpha Bots", role: "team-coach", verification: good.verification, link: "https://example.org/team" } });
  });
  it("treats the link and team name as optional", () => {
    const r = validateApplication({ ...good, link: "", teamName: undefined });
    expect(r.ok && r.value.link).toBeNull();
    expect(r.ok && r.value.teamName).toBe("");
  });
  it("reports every problem at once", () => {
    const r = validateApplication({ name: "A", teamNumber: "123456", role: "wizard", verification: "short", link: "javascript:alert(1)" });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["link", "name", "role", "teamNumber", "verification"]);
  });
  it("rejects a non-object body and non-string fields instead of coercing them", () => {
    expect(validateApplication(null).ok).toBe(false);
    expect(validateApplication({ ...good, role: ["team-coach"] }).ok).toBe(false);
    expect(validateApplication({ ...good, teamNumber: { n: 1 } }).ok).toBe(false);
  });
  it("truncates over-long text to the limit instead of storing it", () => {
    const r = validateApplication({ ...good, verification: "y".repeat(5000) });
    expect(r.ok && r.value.verification.length).toBe(APPLICATION_LIMITS.verification);
  });
});

describe("email checks", () => {
  it("canonicalises aliases: +tags always, dots for Gmail", () => {
    expect(canonicalEmail(" Ada.Lovelace+robots@Gmail.com ")).toBe("adalovelace@gmail.com");
    expect(canonicalEmail("a.b+c@googlemail.com")).toBe("ab@gmail.com");
    expect(canonicalEmail("A.B+c@School.org")).toBe("a.b@school.org");
    expect(canonicalEmail("plain@x.org")).toBe("plain@x.org");
  });
  it("flags disposable domains and their subdomains, not lookalikes", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@sub.mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@notmailinator.com")).toBe(false);
    expect(isDisposableEmail("x@school.org")).toBe(false);
    expect(isDisposableEmail("no-at-sign")).toBe(false);
    expect(isDisposableEmail("x@custom.test", ["custom.test"])).toBe(true);
  });
  it("tells free providers from custom domains", () => {
    expect(isFreeEmailProvider("a@gmail.com")).toBe(true);
    expect(isFreeEmailProvider("a@school.org")).toBe(false);
  });
});

describe("nameMatches (FIRST name vs typed name)", () => {
  it("ignores case, punctuation and filler words", () => {
    expect(nameMatches("alpha bots", "Alpha Bots")).toBe(true);
    expect(nameMatches("Team Alpha Robotics", "Alpha")).toBe(true);
    expect(nameMatches("Alpha-Bots!", "alpha bots")).toBe(true);
  });
  it("accepts one name containing the other (FIRST has long sponsor names)", () => {
    expect(nameMatches("Alpha Bots", "Acme Corp & Springfield High School/Alpha Bots")).toBe(true);
  });
  it("rejects a different name, an empty one, or no official name", () => {
    expect(nameMatches("Beta Builders", "Alpha Bots")).toBe(false);
    expect(nameMatches("", "Alpha Bots")).toBe(false);
    expect(nameMatches("Alpha Bots", null)).toBe(false);
    expect(nameMatches("Team Robotics", "The Club")).toBe(false);
  });
});

describe("status", () => {
  const now = 1_000_000_000_000;
  it("expires a pending application after its expiry, and nothing else", () => {
    expect(effectiveStatus({ status: "pending", expiresAtMs: now + 1 }, now)).toBe("pending");
    expect(effectiveStatus({ status: "pending", expiresAtMs: now }, now)).toBe("expired");
    expect(effectiveStatus({ status: "approved", expiresAtMs: now - 1 }, now)).toBe("approved");
    expect(effectiveStatus({ status: "rejected", expiresAtMs: now - 1 }, now)).toBe("rejected");
    expect(effectiveStatus({ status: "pending", expiresAtMs: null }, now)).toBe("pending");
  });
  it("is 30 days", () => expect(APPLICATION_TTL_MS).toBe(30 * 86_400_000));
  it("shows a block to the applicant as a rejection", () => {
    expect(applicantFacingStatus("blocked")).toBe("rejected");
    expect(applicantFacingStatus("pending")).toBe("pending");
  });
});

describe("describeSignals", () => {
  const base: ApplicationSignals = {
    emailVerified: true,
    signInProvider: "google.com",
    accountAgeMs: 10 * 86_400_000,
    firstApi: { season: 2026, status: "found", officialName: "Alpha Bots", nameMatches: true },
    turnstile: "passed",
    fillSeconds: 90,
    ipApplicationsLastHour: 1,
    emailDomain: "school.org",
    freeEmailProvider: false,
    existingAccountForNumber: false,
  };
  const labels = (s: ApplicationSignals) => describeSignals(s).map((x) => x.label);
  it("shows only good signs for a clean application", () => {
    const out = describeSignals(base);
    expect(out.some((s) => s.tone === "warn" || s.tone === "bad")).toBe(false);
    expect(labels(base)).toContain("Team found on FIRST");
  });
  it("warns on a name mismatch, an unlisted team, a brand-new account, no CAPTCHA, repeats, speed", () => {
    const out = labels({
      ...base,
      firstApi: { season: 2026, status: "found", officialName: "Other", nameMatches: false },
      accountAgeMs: 120_000,
      turnstile: "not-configured",
      ipApplicationsLastHour: 3,
      fillSeconds: 6,
    });
    expect(out).toEqual(expect.arrayContaining(["Team found, name differs", "Brand-new account", "No CAPTCHA", "Repeated from this network", "Filled in very quickly"]));
    expect(labels({ ...base, firstApi: { season: 2026, status: "not-found", officialName: null, nameMatches: null } })).toContain("Team not on FIRST");
    expect(labels({ ...base, firstApi: { season: 2026, status: "error", officialName: null, nameMatches: null } })).toContain("FIRST check unavailable");
  });
  it("marks an existing account for the number as bad", () => {
    expect(describeSignals({ ...base, existingAccountForNumber: true }).find((s) => s.label.startsWith("An account already"))?.tone).toBe("bad");
  });
});
