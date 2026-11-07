"use client";

import { useEffect, useState } from "react";
import { Loader2, LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReauthField } from "@/components/team/reauth-field";
import { reauthenticate } from "@/lib/reauth";
import { fetchRecoveryTeams, forceOwnershipTransfer, type RecoveryTeam } from "@/lib/team-transfer-client";

/**
 * P20: Admin Panel > Recovery (platform owners only). For an account whose owner is gone or locked out, a platform
 * owner can **force** a transfer of ownership to one of that account's admins. It needs a reason, a fresh
 * sign-in and the account's FTC team number typed in, it is labelled as a recovery transfer in that account's own
 * Audit Log, and it is also recorded in the platform log. This list shows each account's FTC teams, owner and admins
 * and nothing else: no scouting data, no join codes, no non-admin members.
 */
export function RecoveryPanel() {
  const [teams, setTeams] = useState<RecoveryTeam[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<RecoveryTeam | null>(null);
  const [toUid, setToUid] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = () => fetchRecoveryTeams().then(setTeams).catch((e: Error) => setLoadError(e.message));
  useEffect(() => {
    load();
  }, []);

  const open = (t: RecoveryTeam) => {
    setTarget(t);
    setToUid("");
    setConfirm("");
    setReason("");
    setPassword("");
    setError(null);
  };

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticate(password);
      await forceOwnershipTransfer(target.teamId, toUid, confirm, reason);
      setDone(`Ownership of FTC ${target.fieldTeams[0]?.number ?? ""} was transferred.`);
      setTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = target?.admins.find((a) => a.uid === toUid);

  return (
    <div className="flex flex-col gap-4" data-testid="recovery-panel">
      <GlassPanel className="flex items-start gap-3 border-amber-400/20">
        <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
        <p className="text-sm text-[var(--muted-foreground)]">
          <strong className="text-[var(--foreground)]">Emergency recovery.</strong> Use this only when an account&apos;s owner can&apos;t act (they left, lost access, or are unreachable). The account&apos;s
          members will see a clearly labelled &ldquo;recovery transfer&rdquo; in their Audit Log. Normal handovers belong in that account&apos;s own Team Settings.
        </p>
      </GlassPanel>

      {done && (
        <p role="status" className="text-sm font-medium text-emerald-300">
          {done}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-sm font-medium text-red-300">
          {loadError}
        </p>
      )}

      {!teams && !loadError ? (
        <div className="glass-card h-24 animate-pulse" />
      ) : (
        <ul className="flex flex-col gap-3">
          {teams?.map((t) => (
            <li key={t.teamId} className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {t.fieldTeams.map((ft) => (
                    <span key={ft.number} className="font-semibold tabular-nums">
                      FTC {ft.number}
                      {ft.name && <span className="ml-1.5 text-sm font-normal text-[var(--muted-foreground)]">{ft.name}</span>}
                    </span>
                  ))}
                  {t.accountName && <Badge variant="outline">{t.accountName}</Badge>}
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Owner: {t.ownerName ?? (t.ownerUid ? "not an admin any more" : "none set")} · {t.admins.length} admin{t.admins.length === 1 ? "" : "s"}
                </p>
              </div>
              <Button variant="glass" size="sm" onClick={() => open(t)} disabled={t.admins.filter((a) => a.uid !== t.ownerUid).length === 0} title={t.admins.length <= 1 ? "Needs another admin to give ownership to" : undefined}>
                Force transfer…
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={target !== null} onOpenChange={(next) => !busy && !next && setTarget(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,500px)]">
          <DialogTitle>Force-transfer ownership (recovery)</DialogTitle>
          <DialogDescription>
            FTC {target?.fieldTeams.map((f) => f.number).join(" / ")}. Ownership moves immediately to the admin you choose; the old owner stays an admin. A pending transfer, if any, is cancelled.
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <Label htmlFor="force-to">New owner (one of its admins)</Label>
              <Select value={toUid} onValueChange={setToUid} disabled={busy}>
                <SelectTrigger id="force-to">
                  <SelectValue>{chosen ? `${chosen.name} (${chosen.email})` : "Choose an admin"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {target?.admins
                    .filter((a) => a.uid !== target.ownerUid)
                    .map((a) => (
                      <SelectItem key={a.uid} value={a.uid}>
                        {a.name} ({a.email})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="force-reason">Reason (kept in the audit logs)</Label>
              <Textarea id="force-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="For example: the owner graduated and can't be reached." />
            </div>
            <div>
              <Label htmlFor="force-confirm">Type one of the account&apos;s FTC team numbers to confirm</Label>
              <Input id="force-confirm" inputMode="numeric" maxLength={5} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} disabled={busy} />
            </div>
            <ReauthField password={password} onPasswordChange={setPassword} disabled={busy} />
            {error && (
              <p role="alert" className="text-sm font-medium text-red-300">
                {error}
              </p>
            )}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submit} disabled={busy || !toUid || !confirm || reason.trim().length < 3} className="min-w-36 gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Transfer ownership
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
