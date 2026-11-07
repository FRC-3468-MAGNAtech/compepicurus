"use client";

import { useState } from "react";
import { Crown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReauthField } from "@/components/team/reauth-field";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api-client";
import { usePermissions } from "@/lib/permissions";
import { reauthenticate } from "@/lib/reauth";
import { useTeamDoc } from "@/lib/team";
import { useTeamMembers } from "@/lib/team-members";
import { readFieldTeams } from "@/lib/field-teams";
import { canCancelTransfer, livePendingTransfer } from "@/lib/team-owner";
import { acceptOwnershipTransfer, cancelOwnershipTransfer, declineOwnershipTransfer, requestOwnershipTransfer } from "@/lib/team-transfer-client";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * P20: Team Settings > Ownership. Everyone sees who owns the account and any pending transfer. The **team owner** can
 * start a transfer: pick an existing admin (their email must be verified: the server checks), confirm it's them by
 * re-authenticating, and type an FTC team number. That creates one pending transfer the recipient can accept or
 * decline (it expires after 7 days); the owner (or whoever requested it) can cancel. The previous owner stays an admin.
 */
export function OwnershipSection() {
  const { user, profile } = useAuth();
  const { isOwner } = usePermissions();
  const teamId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamId);
  const { members } = useTeamMembers(teamId);
  // `Date.now()` once per mount: the expiry shown is to the day, and the server enforces the real clock.
  const [now] = useState(() => Date.now());

  const [open, setOpen] = useState(false);
  const [toUid, setToUid] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = livePendingTransfer(team?.pendingTransfer, now);
  const owner = members.find((m) => m.isOwner);
  const candidates = members.filter((m) => m.isAdmin && m.uid !== user?.uid);
  const teamNumbers = team ? readFieldTeams(team).map((t) => t.number) : [];
  const isRecipient = pending !== null && pending.toUid === user?.uid;
  const mayCancel = canCancelTransfer(pending, user?.uid ?? "", isOwner);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      await reauthenticate(password);
      await requestOwnershipTransfer(toUid, confirm);
      setOpen(false);
      setPassword("");
      setConfirm("");
      setToUid("");
    });

  const chosen = candidates.find((m) => m.uid === toUid);

  return (
    <GlassPanel className="flex flex-col gap-4" data-testid="ownership-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            <Crown className="h-4 w-4" /> Ownership
          </h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            The owner has extra protections on their account and is the only one who can hand the account to someone else. Ownership can only go to an existing admin.
          </p>
        </div>
        {isOwner && !pending && (
          <Button variant="glass" size="sm" onClick={() => { setError(null); setOpen(true); }} disabled={candidates.length === 0} title={candidates.length === 0 ? "Make another member an admin first" : undefined}>
            Transfer ownership
          </Button>
        )}
      </div>

      {!loaded ? (
        <div className="glass-card h-12 animate-pulse" />
      ) : (
        <div className="glass-card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="text-[var(--muted-foreground)]">Owner</span>
          <span className="font-semibold">{owner?.name ?? "Not set yet"}</span>
          {isOwner && <Badge variant="glass">You</Badge>}
        </div>
      )}

      {pending && (
        <div className="glass-card flex flex-col gap-3 border border-amber-400/30 px-4 py-3 text-sm" data-testid="pending-transfer" role="status">
          <p>
            {isRecipient ? (
              <>
                <strong>{pending.fromName || "The owner"}</strong> wants to make <strong>you</strong> the owner of this account.
              </>
            ) : (
              <>
                Ownership is being offered to <strong>{pending.toName || "an admin"}</strong>. It stays with {pending.fromName || "the owner"} until they accept.
              </>
            )}{" "}
            <span className="text-[var(--muted-foreground)]">Expires {fmtDate(pending.expiresAtMs)}.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {isRecipient && (
              <>
                <Button size="sm" disabled={busy} onClick={() => run(acceptOwnershipTransfer)}>
                  Accept ownership
                </Button>
                <Button size="sm" variant="glass" disabled={busy} onClick={() => run(declineOwnershipTransfer)}>
                  Decline
                </Button>
              </>
            )}
            {mayCancel && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(cancelOwnershipTransfer)}>
                Cancel transfer
              </Button>
            )}
          </div>
        </div>
      )}

      {error && !open && (
        <p role="alert" className="text-sm font-medium text-red-300">
          {error}
        </p>
      )}

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="glass-overlay w-[min(94vw,480px)]">
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            The new owner must accept within 7 days. You stay an admin. You&apos;ll lose the owner protections once they accept.
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <Label htmlFor="transfer-to">New owner (an admin)</Label>
              <Select value={toUid} onValueChange={setToUid} disabled={busy}>
                <SelectTrigger id="transfer-to">
                  <SelectValue>{chosen ? `${chosen.name} (${chosen.email})` : "Choose an admin"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((m) => (
                    <SelectItem key={m.uid} value={m.uid}>
                      {m.name} ({m.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">They need a verified email address.</p>
            </div>
            <div>
              <Label htmlFor="transfer-confirm">Type your team number to confirm</Label>
              <Input id="transfer-confirm" inputMode="numeric" maxLength={5} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} disabled={busy} placeholder={teamNumbers[0] ? String(teamNumbers[0]) : "12345"} />
              {teamNumbers.length > 1 && <p className="mt-1 text-xs text-[var(--muted-foreground)]">Any of this account&apos;s FTC team numbers works: {teamNumbers.join(", ")}.</p>}
            </div>
            <ReauthField password={password} onPasswordChange={setPassword} disabled={busy} />
            {error && (
              <p role="alert" className="text-sm font-medium text-red-300">
                {error}
              </p>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !toUid || !confirm} className="min-w-36 gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </GlassPanel>
  );
}
