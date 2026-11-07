"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Turnstile, turnstileSiteKey } from "@/components/auth/turnstile";
import { ApiError } from "@/lib/api-client";
import { fetchStartToken, submitApplication } from "@/lib/applications-client";
import { APPLICATION_LIMITS } from "@/lib/applications";
import { getTeamByNumber } from "@/lib/ftc/actions";
import { parseFieldTeamNumber } from "@/lib/field-teams";
import { ROLES, getRole, type RoleId } from "@/lib/roles";

type Lookup = { status: "idle" } | { status: "loading" } | { status: "found"; name: string } | { status: "missing" } | { status: "error" };

/**
 * P20: the "Apply to create a team" form. The caller must already be signed in with a verified email (the page
 * checks; the server checks again). The FTC team number is looked up on FIRST (current season) to confirm it exists
 * and fill in the name; the lookup is a convenience, never a gate (a rookie team may not be listed yet, and the
 * platform owner sees what FIRST said). A hidden honeypot field and a signed "form opened at" token (fetched here)
 * feed the server's bot checks; Cloudflare Turnstile is shown when a site key is configured.
 */
export function ApplyForm({ email, defaultName, onSubmitted }: { email: string; defaultName: string; onSubmitted: () => void }) {
  const [name, setName] = useState(defaultName);
  const [teamNumber, setTeamNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [role, setRole] = useState<RoleId>("team-coach");
  const [verification, setVerification] = useState("");
  const [link, setLink] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [startToken, setStartToken] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const autoName = useRef("");
  const lookedUp = useRef<number | null>(null);
  const needsCaptcha = turnstileSiteKey() !== null;

  useEffect(() => {
    let cancelled = false;
    fetchStartToken()
      .then((t) => !cancelled && setStartToken(t))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // Look the team up once the number is a valid 1-5 digit number (debounced), and fill the name if the applicant hasn't typed one.
  useEffect(() => {
    const number = parseFieldTeamNumber(teamNumber);
    if (number === null || lookedUp.current === number) return;
    const timer = setTimeout(async () => {
      lookedUp.current = number;
      setLookup({ status: "loading" });
      let next: Lookup;
      try {
        const res = await getTeamByNumber(number);
        next = !res.ok ? { status: "error" } : res.data ? { status: "found", name: res.data.nameShort } : { status: "missing" };
      } catch {
        next = { status: "error" };
      }
      if (lookedUp.current !== number) return;
      setLookup(next);
      if (next.status === "found") {
        setTeamName((current) => {
          if (current.trim() === "" || current === autoName.current) {
            autoName.current = next.name;
            return next.name;
          }
          return current;
        });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [teamNumber]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!startToken) return setError("The form isn't ready yet. Wait a second and try again.");
    if (needsCaptcha && !turnstileToken) return setError("Complete the CAPTCHA first.");
    setSubmitting(true);
    try {
      await submitApplication({ name, teamNumber, teamName, role, verification, link, startToken, turnstileToken, orgUrl: honeypot });
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields ?? {});
        setError(err.fields ? null : err.message);
        // A refused attempt spent the one-time CAPTCHA token and (for "too quick" / "expired") the start token.
        if (err.code === "too-fast" || err.code === "form-expired") fetchStartToken().then(setStartToken).catch(() => {});
      } else {
        setError("Something went wrong. Please try again.");
      }
      setTurnstileToken(null);
      setCaptchaReset((n) => n + 1);
      setSubmitting(false);
    }
  };

  const err = (field: string) => fieldErrors[field];

  return (
    <GlassPanel strong className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Apply to create a team</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Each FTC team gets one CompEpicurus account, and the platform owner approves each one by hand. Tell us about your team so we can check it.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label htmlFor="apply-name">Your name</Label>
          <Input id="apply-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={APPLICATION_LIMITS.name} required aria-invalid={err("name") ? true : undefined} autoComplete="name" />
          {err("name") && <p className="mt-1 text-xs text-red-300">{err("name")}</p>}
        </div>

        <div>
          <Label htmlFor="apply-email">Your email</Label>
          <Input id="apply-email" value={email} readOnly disabled />
          <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-300">
            <Check className="h-3 w-3" /> Verified. The account is created for this address.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <Label htmlFor="apply-team-number">FTC team number</Label>
            <Input
              id="apply-team-number"
              inputMode="numeric"
              maxLength={5}
              value={teamNumber}
              onChange={(e) => setTeamNumber(e.target.value.replace(/\D/g, ""))}
              placeholder="12345"
              required
              aria-invalid={err("teamNumber") ? true : undefined}
              aria-describedby="apply-team-status"
            />
          </div>
          <div>
            <Label htmlFor="apply-team-name">Team name</Label>
            <Input id="apply-team-name" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={APPLICATION_LIMITS.teamName} placeholder="Filled in from FIRST when we can" aria-describedby="apply-team-status" />
          </div>
        </div>
        <div id="apply-team-status" aria-live="polite" className="-mt-2 min-h-4 text-xs">
          {err("teamNumber") ? (
            <span className="text-red-300">{err("teamNumber")}</span>
          ) : lookup.status === "loading" ? (
            <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking FIRST…
            </span>
          ) : lookup.status === "found" ? (
            <span className="flex items-center gap-1.5 text-emerald-300">
              <Check className="h-3 w-3" /> Found on FIRST: {lookup.name}
            </span>
          ) : lookup.status === "missing" ? (
            <span className="text-amber-300">FIRST doesn&apos;t list this number for the current season. You can still apply (a rookie team may not be listed yet); the reviewer will see this.</span>
          ) : lookup.status === "error" ? (
            <span className="text-amber-300">Couldn&apos;t check FIRST right now. You can still apply and type the name yourself.</span>
          ) : null}
        </div>

        <div>
          <Label htmlFor="apply-role">Your role on the team</Label>
          <Select value={role} onValueChange={(v) => setRole(v as RoleId)}>
            <SelectTrigger id="apply-role">
              <SelectValue>{getRole(role).label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("role") && <p className="mt-1 text-xs text-red-300">{err("role")}</p>}
        </div>

        <div>
          <Label htmlFor="apply-verification">How can we verify you&apos;re on this team?</Label>
          <Textarea
            id="apply-verification"
            value={verification}
            onChange={(e) => setVerification(e.target.value)}
            maxLength={APPLICATION_LIMITS.verification}
            rows={4}
            placeholder="For example: your team's website or social page, your school or sponsor, a mentor we can contact, your role this season."
            required
            aria-invalid={err("verification") ? true : undefined}
          />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-red-300">{err("verification")}</span>
            <span className="tabular-nums text-[var(--muted-foreground)]">
              {verification.length}/{APPLICATION_LIMITS.verification}
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="apply-link">Website or social link (optional)</Label>
          <Input id="apply-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} maxLength={APPLICATION_LIMITS.link} placeholder="https://" aria-invalid={err("link") ? true : undefined} />
          {err("link") && <p className="mt-1 text-xs text-red-300">{err("link")}</p>}
        </div>

        {/* Honeypot: invisible to people and to screen readers, but a bot filling every field will fill it. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label>
            Organization website
            <input type="text" name="orgUrl" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} data-testid="honeypot" />
          </label>
        </div>

        <Turnstile onToken={setTurnstileToken} resetKey={captchaReset} />

        {error && (
          <p role="alert" className="text-sm font-medium text-red-300">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="gap-2" disabled={submitting || !startToken}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? "Sending…" : "Submit application"}
        </Button>
      </form>
    </GlassPanel>
  );
}
