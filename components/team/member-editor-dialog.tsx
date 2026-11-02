"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ADMIN_TOGGLE_BLOCK_REASONS, diffMemberAccess, normalizeSecondaryRoles, type AdminToggleBlock, type MemberAccess } from "@/lib/member-access";
import { ROLES, getRole, type RoleId } from "@/lib/roles";
import { spring, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/team-members";

/**
 * Admin-only role editor (FIX1-3): primary role (single select, shown as a
 * coloured pill), secondary roles (multi-select, uncoloured pills), and the
 * admin switch, with Save/Cancel. Mount it with a fresh `key` each time it
 * opens so the draft always starts from the member's current values.
 *
 * `onSave` receives only what changed (never called when nothing did) and
 * should throw/reject on failure — the dialog then stays open with an error.
 */
export function MemberEditorDialog({
  member,
  open,
  onOpenChange,
  adminToggleBlock,
  onSave,
}: {
  member: TeamMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminToggleBlock: AdminToggleBlock;
  onSave: (changes: Partial<MemberAccess>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MemberAccess>({
    primaryRole: member.primaryRole,
    secondaryRoles: normalizeSecondaryRoles(member.secondaryRoles, member.primaryRole),
    isAdmin: member.isAdmin,
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const changes = diffMemberAccess(member, draft);
  const dirty = Object.keys(changes).length > 0;
  const busy = status === "saving" || status === "saved";

  const setPrimary = (role: RoleId) =>
    // A role can't be both primary and secondary, so promoting a secondary drops it from that list.
    setDraft((d) => ({ ...d, primaryRole: role, secondaryRoles: normalizeSecondaryRoles(d.secondaryRoles, role) }));

  const toggleSecondary = (role: RoleId) =>
    setDraft((d) => ({
      ...d,
      secondaryRoles: normalizeSecondaryRoles(d.secondaryRoles.includes(role) ? d.secondaryRoles.filter((r) => r !== role) : [...d.secondaryRoles, role], d.primaryRole),
    }));

  const handleSave = async () => {
    if (!dirty) {
      onOpenChange(false);
      return;
    }
    setStatus("saving");
    try {
      await onSave(changes);
      setStatus("saved");
      // Let the glow pulse play before the dialog closes.
      setTimeout(() => onOpenChange(false), 750);
    } catch {
      setStatus("error");
    }
  };

  const primary = getRole(draft.primaryRole);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      {/* glass-overlay: a solid backing, so role names stay legible in every theme. */}
      <DialogContent className="glass-overlay w-[min(94vw,520px)] max-h-[88vh] overflow-y-auto">
        <motion.div
          animate={status === "saved" ? { boxShadow: ["0 0 0 0 rgba(var(--glow),0)", "0 0 40px 6px rgba(var(--glow),0.55)", "0 0 0 0 rgba(var(--glow),0)"] } : undefined}
          transition={{ duration: 0.75, ease: "easeOut" }}
          className="-m-6 rounded-[28px] p-6"
        >
          <div className="flex items-center gap-3 pr-8">
            <Avatar name={member.name} size="md" />
            <div className="min-w-0">
              <DialogTitle className="truncate">Edit {member.name}</DialogTitle>
              <DialogDescription className="truncate">{member.email}</DialogDescription>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-5">
            <div>
              <Label htmlFor="member-primary-role">Primary role</Label>
              <Select value={draft.primaryRole} onValueChange={(v) => setPrimary(v as RoleId)} disabled={busy}>
                <SelectTrigger id="member-primary-role" className="h-12">
                  <SelectValue>
                    <span className={cn("rounded-full px-3 py-1 text-sm font-medium", primary.className)}>{primary.label}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="py-2.5">
                      <span className={cn("rounded-full px-3 py-1 text-sm font-medium", r.className)}>{r.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Secondary roles</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {ROLES.filter((r) => r.id !== draft.primaryRole).map((r) => {
                  const active = draft.secondaryRoles.includes(r.id);
                  return (
                    <motion.button
                      key={r.id}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      disabled={busy}
                      whileTap={{ scale: 0.94 }}
                      transition={springSnappy}
                      onClick={() => toggleSecondary(r.id)}
                      className={cn(
                        "flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
                        active
                          ? "border-[var(--glass-border)] bg-white/15 text-[var(--foreground)]"
                          : "border-dashed border-[var(--glass-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      )}
                    >
                      {active && <Check className="h-3.5 w-3.5" />}
                      {r.label}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <div className="glass-card flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" /> Admin
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {adminToggleBlock
                    ? ADMIN_TOGGLE_BLOCK_REASONS[adminToggleBlock]
                    : "Admins manage events, assignments, roles, and scout data."}
                </p>
              </div>
              <Switch
                checked={draft.isAdmin}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, isAdmin: v }))}
                disabled={busy || adminToggleBlock !== null}
                aria-label="Admin access"
              />
            </div>
          </div>

          {status === "error" && (
            <p className="mt-4 text-sm font-medium text-red-300">Couldn&apos;t save those changes. You may not have permission, or someone else just changed this member.</p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={busy || !dirty} className="min-w-28 gap-2">
              {status === "saved" ? (
                <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={spring} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> Saved
                </motion.span>
              ) : status === "saving" ? (
                "Saving…"
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
