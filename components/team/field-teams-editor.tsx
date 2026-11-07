"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Loader2, Plus, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { HoverTip } from "@/components/ui/hover-tip";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTeamByNumber } from "@/lib/ftc/actions";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import { useTeamMembers } from "@/lib/team-members";
import { useFieldTeams } from "@/lib/field-teams-context";
import { saveTeamSettings } from "@/lib/field-teams-actions";
import {
  MAX_ACCOUNT_NAME,
  MAX_FIELD_TEAMS,
  MAX_FIELD_TEAM_NAME,
  draftsToFieldTeams,
  fieldTeamFullLabel,
  membersAssignedTo,
  moveItem,
  newFieldTeamId,
  parseFieldTeamNumber,
  planRemovals,
  toDrafts,
  validateFieldTeamDrafts,
  type FieldTeamDraft,
} from "@/lib/field-teams";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Draft = {
  /** Fingerprint of the saved settings this draft started from, to notice someone else saving meanwhile. */
  baseKey: string;
  accountName: string;
  teams: FieldTeamDraft[];
  /** Removed (saved) team id -> the team its members move to. Applied together with the save. */
  removed: Record<string, string>;
};

type Lookup = { status: "loading" } | { status: "found"; name: string } | { status: "missing" } | { status: "error" };

/**
 * P19: Settings > Team Settings. Admins (and the owner) edit the account name and the account's FTC
 * teams (add, remove, reorder; number 1-5 digits and unique, name optional); everyone else sees them
 * read-only. A typed number is looked up through the FIRST API proxy to confirm it exists and to
 * auto-fill the name (a manual name always works, so a failed lookup never blocks saving).
 * Safeguards: the last team can't be removed, and removing a team that has members asks where to
 * move them first. Everything saves in one batch with its audit entry (lib/field-teams-actions.ts).
 */
export function FieldTeamsEditor() {
  const { user, profile } = useAuth();
  const { isAdmin, isOwner } = usePermissions();
  const canEdit = isAdmin || isOwner;
  const { fieldTeams, accountName, loaded } = useFieldTeams();
  const { members } = useTeamMembers(canEdit ? (profile?.teamId ?? null) : null);

  const baseKey = useMemo(() => JSON.stringify([accountName, fieldTeams]), [accountName, fieldTeams]);
  // `null` = untouched: the view follows the saved (realtime) settings. Any edit creates a draft.
  const [draft, setDraft] = useState<Draft | null>(null);
  const view: Draft = draft ?? { baseKey, accountName: accountName ?? "", teams: toDrafts(fieldTeams), removed: {} };
  const staleBase = draft !== null && draft.baseKey !== baseKey;

  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  // The last name we auto-filled per row, so a later lookup only overwrites a name the admin hasn't typed over.
  const autoNames = useRef<Record<string, string>>({});
  const lookedUp = useRef<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");
  const [showIssues, setShowIssues] = useState(false);

  const edit = (fn: (d: Draft) => Draft) => {
    setSaved(false);
    setDraft((prev) => fn(prev ?? { baseKey, accountName: accountName ?? "", teams: toDrafts(fieldTeams), removed: {} }));
  };

  const issues = useMemo(() => {
    const list = validateFieldTeamDrafts(view.teams);
    if (view.accountName.trim().length > MAX_ACCOUNT_NAME) list.push({ id: null, field: "name", message: `The account name can be at most ${MAX_ACCOUNT_NAME} characters.` });
    return list;
  }, [view.teams, view.accountName]);
  const issueFor = (id: string, field: "number" | "name") => issues.find((i) => i.id === id && i.field === field)?.message ?? null;

  // FIRST lookup: when a row's number becomes a valid 1-5 digit number, check it (debounced) and fill the name.
  const lookupKey = view.teams.map((t) => `${t.id}:${t.number}`).join("|");
  useEffect(() => {
    if (!canEdit || !draft) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const row of draft.teams) {
      const number = parseFieldTeamNumber(row.number);
      if (number === null || lookedUp.current[row.id] === number) continue;
      timers.push(
        setTimeout(async () => {
          lookedUp.current[row.id] = number;
          setLookups((l) => ({ ...l, [row.id]: { status: "loading" } }));
          let result: Lookup;
          try {
            const res = await getTeamByNumber(number);
            result = !res.ok ? { status: "error" } : res.data ? { status: "found", name: res.data.nameShort } : { status: "missing" };
          } catch {
            result = { status: "error" };
          }
          // A newer edit to this row's number makes this answer stale.
          if (lookedUp.current[row.id] !== number) return;
          setLookups((l) => ({ ...l, [row.id]: result }));
          if (result.status === "found") {
            setDraft((d) =>
              d && d.teams.find((t) => t.id === row.id && parseFieldTeamNumber(t.number) === number)
                ? {
                    ...d,
                    teams: d.teams.map((t) => {
                      const untouched = t.name.trim() === "" || t.name === autoNames.current[row.id];
                      if (t.id !== row.id || !untouched) return t;
                      autoNames.current[row.id] = result.name;
                      return { ...t, name: result.name };
                    }),
                  }
                : d
            );
          }
        }, 500)
      );
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey, canEdit, draft === null]);

  // --- read-only view ------------------------------------------------------------------------
  if (!canEdit) {
    return (
      <div className="flex flex-col gap-6">
        <GlassPanel className="flex flex-col gap-3">
          <SectionTitle>Account</SectionTitle>
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Account name</div>
            <div className="text-lg font-semibold">{loaded ? (accountName ?? "Not set") : "Loading…"}</div>
          </div>
        </GlassPanel>
        <GlassPanel className="flex flex-col gap-3">
          <SectionTitle>FTC teams</SectionTitle>
          {!loaded ? (
            <div className="glass-card h-16 animate-pulse" />
          ) : (
            <ul className="flex flex-col gap-2">
              {fieldTeams.map((t) => (
                <li key={t.id} className="glass-card px-4 py-3 text-sm font-medium tabular-nums">
                  {fieldTeamFullLabel(t)}
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <ShieldAlert className="h-4 w-4 shrink-0" /> Only admins can change these settings.
          </p>
        </GlassPanel>
      </div>
    );
  }

  // --- editing -------------------------------------------------------------------------------
  const savedIds = new Set(fieldTeams.map((t) => t.id));
  const dirty = draft !== null;
  const lastTeam = view.teams.length <= 1;

  const addTeam = () => {
    edit((d) => ({ ...d, teams: [...d.teams, { id: newFieldTeamId(), number: "", name: "" }] }));
    setShowIssues(false);
  };

  const requestRemove = (id: string) => {
    if (lastTeam) return;
    // Only a team that is saved can have members assigned to it, and only those need a new home.
    if (savedIds.has(id) && membersAssignedTo(id, members).length > 0) {
      const firstOther = view.teams.find((t) => t.id !== id);
      setReassignTo(firstOther?.id ?? "");
      setRemoveTarget(id);
      return;
    }
    removeRow(id, null);
  };

  const removeRow = (id: string, target: string | null) => {
    edit((d) => ({
      ...d,
      teams: d.teams.filter((t) => t.id !== id),
      removed: target && savedIds.has(id) ? { ...d.removed, [id]: target } : d.removed,
    }));
    setRemoveTarget(null);
  };

  const handleSave = async () => {
    setShowIssues(true);
    setSaveError(null);
    if (!user || !profile || issues.length > 0) return;
    const after = draftsToFieldTeams(view.teams);
    // A removal whose target was removed afterwards is followed on to the surviving team (planRemovals).
    const targets = Object.fromEntries(Object.entries(view.removed).filter(([id]) => !after.some((t) => t.id === id)));
    const reassignments = planRemovals(targets, members, fieldTeams).map((r) => ({ ...r, name: members.find((m) => m.uid === r.uid)?.name ?? r.uid }));
    setSaving(true);
    try {
      await saveTeamSettings({
        actor: { teamId: profile.teamId, uid: user.uid, name: profile.name },
        before: { accountName, fieldTeams },
        after: { accountName: view.accountName.trim() || null, fieldTeams: after },
        reassignments,
      });
      setDraft(null);
      lookedUp.current = {};
      setLookups({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveError("Couldn't save. You may not have permission, or the team list changed while you were editing.");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(null);
    setShowIssues(false);
    setSaveError(null);
    lookedUp.current = {};
    setLookups({});
  };

  const removeTargetTeam = removeTarget ? view.teams.find((t) => t.id === removeTarget) : null;
  const affectedCount = removeTarget ? membersAssignedTo(removeTarget, members).length : 0;

  return (
    <div className="flex flex-col gap-6">
      {staleBase && (
        <div role="status" className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Someone else changed these settings while you were editing. Saving will replace their changes with yours.
        </div>
      )}

      <GlassPanel className="flex flex-col gap-3">
        <SectionTitle>Account</SectionTitle>
        <div className="max-w-md">
          <Label htmlFor="account-name">Account name</Label>
          <Input
            id="account-name"
            value={view.accountName}
            maxLength={MAX_ACCOUNT_NAME + 10}
            placeholder="Optional, e.g. your robotics organisation"
            onChange={(e) => edit((d) => ({ ...d, accountName: e.target.value }))}
            aria-invalid={issues.some((i) => i.id === null && i.field === "name") || undefined}
          />
          <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">Shown under the CompEpicurus name in the sidebar. Separate from the FTC teams below.</p>
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle>FTC teams</SectionTitle>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              The competing teams on this account. Scouting data stays shared by everyone; which team a member is on only changes their defaults, display and filters.
            </p>
          </div>
          <Button variant="glass" size="sm" className="gap-1.5" onClick={addTeam} disabled={view.teams.length >= MAX_FIELD_TEAMS}>
            <Plus className="h-4 w-4" /> Add team
          </Button>
        </div>

        {!loaded ? (
          <div className="glass-card h-24 animate-pulse" />
        ) : (
          <ul className="flex flex-col gap-3">
            {view.teams.map((row, index) => {
              const numberIssue = issueFor(row.id, "number");
              const nameIssue = issueFor(row.id, "name");
              const lookup = lookups[row.id];
              return (
                <motion.li key={row.id} layout="position" transition={spring} className="glass-card flex flex-col gap-3 p-4" data-testid="field-team-row">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_1fr_auto] sm:items-start">
                    <div>
                      <Label htmlFor={`ft-number-${row.id}`}>Team number</Label>
                      <Input
                        id={`ft-number-${row.id}`}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={5}
                        value={row.number}
                        placeholder="12345"
                        onChange={(e) => edit((d) => ({ ...d, teams: d.teams.map((t) => (t.id === row.id ? { ...t, number: e.target.value.replace(/\D/g, "") } : t)) }))}
                        aria-invalid={numberIssue ? true : undefined}
                        aria-describedby={`ft-status-${row.id}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`ft-name-${row.id}`}>Team name</Label>
                      <Input
                        id={`ft-name-${row.id}`}
                        value={row.name}
                        maxLength={MAX_FIELD_TEAM_NAME + 10}
                        placeholder="Optional"
                        onChange={(e) => edit((d) => ({ ...d, teams: d.teams.map((t) => (t.id === row.id ? { ...t, name: e.target.value } : t)) }))}
                        aria-invalid={nameIssue ? true : undefined}
                        aria-describedby={`ft-status-${row.id}`}
                      />
                    </div>
                    <div className="flex items-center gap-1 sm:pt-6">
                      <Button variant="ghost" size="sm" className="h-11 w-11 p-0" disabled={index === 0} onClick={() => edit((d) => ({ ...d, teams: moveItem(d.teams, index, index - 1) }))} aria-label={`Move FTC ${row.number || "team"} up`}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-11 w-11 p-0" disabled={index === view.teams.length - 1} onClick={() => edit((d) => ({ ...d, teams: moveItem(d.teams, index, index + 1) }))} aria-label={`Move FTC ${row.number || "team"} down`}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      {lastTeam ? (
                        <HoverTip content="An account needs at least one FTC team." align="end">
                          <Button variant="ghost" size="sm" className="h-11 w-11 p-0" disabled aria-label="Remove team (not available: the last FTC team can't be removed)">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </HoverTip>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-11 w-11 p-0 text-red-300" onClick={() => requestRemove(row.id)} aria-label={`Remove FTC ${row.number || "team"}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div id={`ft-status-${row.id}`} aria-live="polite" className="min-h-4 text-xs">
                    {(showIssues || row.number.length >= 5) && numberIssue ? (
                      <span className="text-red-300">{numberIssue}</span>
                    ) : nameIssue ? (
                      <span className="text-red-300">{nameIssue}</span>
                    ) : lookup?.status === "loading" ? (
                      <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking FIRST…
                      </span>
                    ) : lookup?.status === "found" ? (
                      <span className="flex items-center gap-1.5 text-emerald-300">
                        <Check className="h-3 w-3" /> Confirmed with FIRST: {lookup.name}
                      </span>
                    ) : lookup?.status === "missing" ? (
                      <span className="text-amber-300">FIRST has no FTC team with this number this season. You can still save it and type the name yourself.</span>
                    ) : lookup?.status === "error" ? (
                      <span className="text-amber-300">Couldn&apos;t check FIRST right now. Type the name yourself.</span>
                    ) : null}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}

        {showIssues && issues.some((i) => i.field === "list") && (
          <p role="alert" className="text-sm font-medium text-red-300">
            {issues.find((i) => i.field === "list")?.message}
          </p>
        )}
      </GlassPanel>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {saveError && (
          <p role="alert" className="mr-auto text-sm font-medium text-red-300">
            {saveError}
          </p>
        )}
        {saved && !dirty && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-300">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
          Discard changes
        </Button>
        <Button onClick={handleSave} disabled={!dirty || saving} className="min-w-32">
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,480px)]">
          <DialogTitle>Move members before removing FTC {removeTargetTeam?.number ?? ""}?</DialogTitle>
          <DialogDescription>
            {affectedCount} {affectedCount === 1 ? "member is" : "members are"} assigned to this team. Choose the team they should move to. This happens when you save.
          </DialogDescription>
          <div className="mt-4">
            <Label htmlFor="reassign-to">Move them to</Label>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger id="reassign-to">
                <SelectValue>{(() => { const t = view.teams.find((x) => x.id === reassignTo); return t ? fieldTeamFullLabel({ number: parseFieldTeamNumber(t.number) ?? 0, name: t.name }) : "Choose a team"; })()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {view.teams
                  .filter((t) => t.id !== removeTarget)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.number ? fieldTeamFullLabel({ number: parseFieldTeamNumber(t.number) ?? 0, name: t.name }) : "New team"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!reassignTo} onClick={() => removeTarget && removeRow(removeTarget, reassignTo)}>
              Move members and remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className={cn("text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]")}>{children}</h2>;
}
