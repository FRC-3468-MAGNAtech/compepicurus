import { afterEach, describe, expect, it, vi } from "vitest";
import { hashValue, safeEqual, signValue } from "./app-secret";
import { checkStartToken, issueStartToken } from "./application-token";
import { verifyTurnstile } from "./turnstile";
import { appBaseUrl, isEmailConfigured, platformOwnerEmails, sendEmail } from "./email";
import { emailTemplates, escapeHtml } from "./email-templates";
import { APPLICATION_LIMITS } from "@/lib/applications";

const SECRET = "test-secret-value";
const NOW = 1_800_000_000_000;

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("hashing", () => {
  it("is deterministic, namespaced by purpose, keyed by the secret, and never the input", () => {
    const a = hashValue("ip", "203.0.113.9", SECRET);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(hashValue("ip", "203.0.113.9", SECRET)).toBe(a);
    expect(hashValue("email", "203.0.113.9", SECRET)).not.toBe(a);
    expect(hashValue("ip", "203.0.113.9", "another-secret")).not.toBe(a);
    expect(a).not.toContain("203");
  });
  it("compares signatures in constant time and rejects different lengths", () => {
    expect(safeEqual(signValue("x", SECRET), signValue("x", SECRET))).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(signValue("x", SECRET), signValue("y", SECRET))).toBe(false);
  });
});

describe("start token (the minimum time-to-submit check)", () => {
  it("accepts a token between the minimum and maximum age and reports how long the form was open", () => {
    const token = issueStartToken(NOW, SECRET);
    const r = checkStartToken(token, NOW + 30_000, SECRET);
    expect(r).toEqual({ ok: true, ageMs: 30_000 });
    expect(checkStartToken(token, NOW + APPLICATION_LIMITS.minFillMs, SECRET).ok).toBe(true);
    expect(checkStartToken(token, NOW + APPLICATION_LIMITS.maxFillMs, SECRET).ok).toBe(true);
  });
  it("refuses an instant submit and an old token", () => {
    const token = issueStartToken(NOW, SECRET);
    expect(checkStartToken(token, NOW + APPLICATION_LIMITS.minFillMs - 1, SECRET)).toEqual({ ok: false, reason: "too-fast" });
    expect(checkStartToken(token, NOW + APPLICATION_LIMITS.maxFillMs + 1, SECRET)).toEqual({ ok: false, reason: "expired" });
  });
  it("refuses a missing, malformed, forged or re-signed token", () => {
    const token = issueStartToken(NOW, SECRET);
    const [issued, nonce, sig] = token.split(".");
    expect(checkStartToken(undefined, NOW + 10_000, SECRET)).toEqual({ ok: false, reason: "missing" });
    expect(checkStartToken("a.b", NOW + 10_000, SECRET)).toEqual({ ok: false, reason: "invalid" });
    // a bot claiming the form opened long ago can't forge the time: the signature covers it
    expect(checkStartToken(`${Number(issued) - 600_000}.${nonce}.${sig}`, NOW + 10_000, SECRET)).toEqual({ ok: false, reason: "invalid" });
    expect(checkStartToken(token, NOW + 10_000, "different-secret")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("verifyTurnstile", () => {
  const respond = (json: unknown) => vi.fn(async () => ({ json: async () => json }) as unknown as Response);

  it("reports not configured when there is no secret (the route then relies on its other measures)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstile("tok", "1.2.3.4", respond({ success: true }))).toEqual({ configured: false });
  });
  it("posts the secret, the token and the IP, and trusts only success: true", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const fetchImpl = respond({ success: true });
    expect(await verifyTurnstile("tok", "1.2.3.4", fetchImpl)).toEqual({ configured: true, ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams; method: string }];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    expect(init.body.get("secret")).toBe("secret");
    expect(init.body.get("response")).toBe("tok");
    expect(init.body.get("remoteip")).toBe("1.2.3.4");
    expect(await verifyTurnstile("tok", null, respond({ success: false, "error-codes": ["invalid-input-response"] }))).toEqual({ configured: true, ok: false, reason: "invalid-input-response" });
    expect(await verifyTurnstile("tok", null, respond({ success: "true" }))).toMatchObject({ ok: false });
  });
  it("fails closed for a missing/oversized token and when Cloudflare can't be reached", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const never = vi.fn();
    expect(await verifyTurnstile(null, null, never as unknown as typeof fetch)).toMatchObject({ ok: false, reason: "missing-token" });
    expect(await verifyTurnstile("x".repeat(5000), null, never as unknown as typeof fetch)).toMatchObject({ ok: false });
    expect(never).not.toHaveBeenCalled();
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await verifyTurnstile("tok", null, down as unknown as typeof fetch)).toEqual({ configured: true, ok: false, reason: "unreachable" });
  });
});

describe("sendEmail", () => {
  const msg = { to: "a@example.com", subject: "Hi", text: "Hello" };
  it("does nothing, and says so, when email isn't configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const fetchImpl = vi.fn();
    expect(isEmailConfigured()).toBe(false);
    expect(await sendEmail(msg, fetchImpl as unknown as typeof fetch)).toEqual({ sent: false, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("posts to Resend with the key and the configured sender", async () => {
    process.env.RESEND_API_KEY = "re_key";
    process.env.EMAIL_FROM = "CompEpicurus <notify@example.org>";
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    expect(await sendEmail({ ...msg, html: "<p>x</p>" }, fetchImpl as unknown as typeof fetch)).toEqual({ sent: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_key");
    expect(JSON.parse(init.body)).toMatchObject({ from: "CompEpicurus <notify@example.org>", to: ["a@example.com"], subject: "Hi", text: "Hello", html: "<p>x</p>" });
  });
  it("drops invalid addresses, never throws, and reports failures", async () => {
    process.env.RESEND_API_KEY = "k";
    process.env.EMAIL_FROM = "n@example.org";
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    expect(await sendEmail({ ...msg, to: ["not an email", "b@example.com"] }, fetchImpl as unknown as typeof fetch)).toEqual({ sent: true });
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body).to).toEqual(["b@example.com"]);
    expect(await sendEmail({ ...msg, to: "nope" }, fetchImpl as unknown as typeof fetch)).toEqual({ sent: false, reason: "no-recipient" });
    expect(await sendEmail(msg, (async () => ({ ok: false, status: 500 }) as Response) as typeof fetch)).toEqual({ sent: false, reason: "error" });
    expect(
      await sendEmail(msg, (async () => {
        throw new Error("boom");
      }) as typeof fetch)
    ).toEqual({ sent: false, reason: "error" });
  });
  it("reads the platform owners' addresses and the app URL from the environment", () => {
    process.env.OWNER_EMAILS = " a@x.org , b@x.org,, ";
    expect(platformOwnerEmails()).toEqual(["a@x.org", "b@x.org"]);
    process.env.APP_URL = "https://app.example.org///";
    expect(appBaseUrl()).toBe("https://app.example.org");
    delete process.env.APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "prod.vercel.app";
    expect(appBaseUrl()).toBe("https://prod.vercel.app");
  });
});

describe("email templates", () => {
  it("escapes everything user-supplied in the html body, and keeps plain text readable", () => {
    const m = emailTemplates.newApplicationForOwner({
      to: ["o@example.org"],
      applicantName: `<script>alert("x")</script>`,
      applicantEmail: "a@example.org",
      teamNumber: 35792,
      teamName: "Alpha & Co",
      role: "Team Coach",
      queueUrl: "https://app.example.org/admin",
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Alpha &amp; Co");
    expect(m.text).toContain("FTC 35792");
    expect(m.text).toContain("https://app.example.org/admin");
    expect(m.subject).toBe("New team application: FTC 35792");
  });
  it("escapes the characters that matter", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("says the right thing for each notice", () => {
    expect(emailTemplates.applicationReceived({ to: "a@x.org", name: "Ada", teamNumber: 1, statusUrl: "https://x/apply" }).text).toContain("30 days");
    expect(emailTemplates.applicationApproved({ to: "a@x.org", name: "Ada", teamNumber: 1, appUrl: "https://x" }).text).toContain("owner and an admin");
    expect(emailTemplates.applicationRejected({ to: "a@x.org", name: "Ada", teamNumber: 1, reason: "Link your page.", statusUrl: "https://x/apply" }).text).toContain("Reason: Link your page.");
    expect(emailTemplates.ownershipTransferRequested({ to: "a@x.org", toName: "Ada", fromName: "Bo", teamLabel: "FTC 1", expiresInDays: 7, appUrl: "https://x" }).text).toContain("expires in 7 days");
    const forced = emailTemplates.ownershipTransferred({ to: "a@x.org", name: "Ada", teamLabel: "FTC 1", newOwnerName: "Bo", forced: true, appUrl: "https://x" });
    expect(forced.text).toContain("recovery transfer");
    expect(emailTemplates.ownershipTransferred({ to: "a@x.org", name: "Ada", teamLabel: "FTC 1", newOwnerName: "Bo", forced: false, appUrl: "https://x" }).text).not.toContain("recovery");
  });
});
