"use client";

import { Check, Lock, ShieldCheck, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { explainAccess, memberPageState, accessiblePages, type AccessExplanation, type AccessUser, type MemberPageState, type PageAccessConfig } from "@/lib/page-access/access";
import { visibleNav } from "@/lib/page-access/nav";
import { PAGES, RESTRICTED_PAGES } from "@/lib/page-access/pages";
import type { PageAccessRequest } from "@/lib/page-access/store";
import { mainNav, secondaryNav } from "@/lib/nav";
import { ROLES, getRole } from "@/lib/roles";
import { cn } from "@/lib/utils";

// P26: the pieces of the Admin Panel's Page Access screen, as plain props (the connected panel wires them to Firestore; the
// browser-test fixture to memory). What a person can open is always decided by lib/page-access/access.ts, never here.

/** Solid backing for the sticky first column (a sticky cell over scrolling cells must not be see-through). */
const STICKY = "sticky left-0 z-10 glass-overlay !rounded-none !shadow-none";

/** Rows are the restricted pages, columns the roles; a ticked box means that role (primary or secondary) can open the page. */
export function RoleMatrix({ config, onToggle, disabled }: { config: PageAccessConfig; onToggle: (role: (typeof ROLES)[number]["id"], pageId: string, on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="glass-card overflow-x-auto p-0" data-testid="role-matrix">
      <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
          <tr>
            <th scope="col" className={cn(STICKY, "min-w-[11rem] px-3 py-3 font-medium")}>
              Page
            </th>
            {ROLES.map((r) => (
              <th key={r.id} scope="col" className="px-2 py-3 text-center font-medium">
                <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] normal-case", r.className)}>{r.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-border)]">
          {RESTRICTED_PAGES.map((page) => (
            <tr key={page.id} data-page={page.id}>
              <th scope="row" className={cn(STICKY, "px-3 py-2.5 text-left font-medium")}>
                {page.title}
              </th>
              {ROLES.map((r) => {
                const checked = (config.roleGrants[r.id] ?? []).includes(page.id);
                return (
                  <td key={r.id} className="px-2 py-1.5 text-center">
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => onToggle(r.id, page.id, v === true)}
                      aria-label={`${r.label} can open ${page.title}`}
                      data-testid={`matrix-${r.id}-${page.id}`}
                      className="mx-auto h-7 w-7"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_TEXT: Record<AccessExplanation["source"], (e: AccessExplanation) => string> = {
  admin: () => "Admin: always",
  open: () => "Open to everyone",
  role: (e) => `Role: ${e.viaRoles.map((r) => getRole(r).label).join(", ")}`,
  grant: () => "Extra page granted to this member",
  denied: (e) => (e.viaRoles.length > 0 ? `Closed by an override (their role ${e.viaRoles.map((r) => getRole(r).label).join(", ")} would open it)` : "Closed by an override"),
  none: () => "No role or grant opens it",
  "admin-only": () => "Admins only",
};

const STATE_LABEL: Record<MemberPageState, string> = { default: "Follow roles", grant: "Grant", deny: "Deny" };

/** One member's pages: what they get from their roles, and per page an override (follow their roles, grant, or deny), with where the access comes from. */
export function MemberAccessEditor({ member, config, onSet, disabled }: { member: AccessUser & { name: string }; config: PageAccessConfig; onSet: (pageId: string, state: MemberPageState) => void; disabled?: boolean }) {
  if (member.isAdmin || member.isOwner) {
    return (
      <p data-testid="member-admin-note" className="glass-card flex items-center gap-2 px-4 py-3 text-sm text-[var(--muted-foreground)]">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> {member.name} is {member.isOwner ? "the owner" : "an admin"}, so they can always open every page. Page access only applies to members who aren&apos;t admins.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="member-access-editor">
      {RESTRICTED_PAGES.map((page) => {
        const state = memberPageState(config, member.uid, page.id);
        const e = explainAccess(member, page.id, config);
        return (
          <li key={page.id} data-page={page.id} data-allowed={e.allowed ? "true" : "false"} className="glass-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {e.allowed ? <Check className="h-4 w-4 shrink-0 text-emerald-300" aria-label="Can open" /> : <Lock className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-label="Can't open" />}
                {page.title}
              </div>
              <div className="text-xs text-[var(--muted-foreground)]" data-testid="access-source">
                {SOURCE_TEXT[e.source](e)}
              </div>
            </div>
            <div role="radiogroup" aria-label={`${page.title} override`} className="glass-pill inline-flex shrink-0 items-center gap-1 self-start p-1 sm:self-auto">
              {(["default", "grant", "deny"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={state === s}
                  disabled={disabled}
                  onClick={() => onSet(page.id, s)}
                  data-testid={`override-${page.id}-${s}`}
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] disabled:opacity-50",
                    state === s ? (s === "deny" ? "bg-red-500/25 text-red-200" : "text-[var(--color-primary-foreground)] [background:var(--theme-gradient)]") : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  )}
                >
                  {STATE_LABEL[s]}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "Preview as member": the navigation they see and which pages they can open, from the same function the app uses. */
export function PreviewAsMember({ member, config }: { member: AccessUser & { name: string }; config: PageAccessConfig }) {
  const navItems = visibleNav([...mainNav, ...secondaryNav], (id) => explainAccess(member, id, config).allowed);
  const open = new Set(accessiblePages(member, config).map((p) => p.id));
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="preview-as-member">
      <div className="glass-card flex flex-col gap-2 p-4">
        <h4 className="text-sm font-semibold">Navigation {member.name} sees</h4>
        <ul className="flex flex-wrap gap-1.5" data-testid="preview-nav">
          {navItems.map((i) => (
            <li key={i.href}>
              <Badge variant="glass" className="gap-1.5">
                <i.icon className="h-3 w-3" aria-hidden /> {i.label}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <div className="glass-card flex flex-col gap-2 p-4">
        <h4 className="text-sm font-semibold">Pages they can open</h4>
        <ul className="grid gap-1 text-sm sm:grid-cols-2" data-testid="preview-pages">
          {PAGES.map((p) => (
            <li key={p.id} data-page={p.id} data-open={open.has(p.id) ? "true" : "false"} className={cn("flex items-center gap-1.5", !open.has(p.id) && "text-[var(--muted-foreground)] line-through decoration-1")}>
              {open.has(p.id) ? <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
              {p.title}
              <span className="sr-only">{open.has(p.id) ? " (can open)" : " (can't open)"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Pending requests with Approve (adds a grant) and Deny, then the decided ones. */
export function RequestsList({ requests, onDecide, busyId }: { requests: PageAccessRequest[]; onDecide: (request: PageAccessRequest, approve: boolean) => void; busyId?: string | null }) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 8);
  return (
    <div className="flex flex-col gap-4" data-testid="access-requests">
      {pending.length === 0 ? (
        <p className="glass-card px-4 py-6 text-center text-sm text-[var(--muted-foreground)]" data-testid="no-pending-requests">
          No one is waiting for access.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((r) => (
            <li key={r.id} data-testid={`request-${r.id}`} className="glass-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={r.name} size="sm" />
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{r.name}</span> asked for <span className="font-medium">{r.pageTitle}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => onDecide(r, true)} disabled={busyId === r.id} data-testid={`approve-${r.id}`}>
                  Approve
                </Button>
                <Button size="sm" variant="glass" onClick={() => onDecide(r, false)} disabled={busyId === r.id} data-testid={`deny-${r.id}`}>
                  Deny
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">Recently decided</h4>
          <ul className="flex flex-col gap-1 text-sm text-[var(--muted-foreground)]">
            {decided.map((r) => (
              <li key={r.id} data-testid={`decided-${r.id}`}>
                {r.name}: {r.pageTitle} <Badge variant={r.status === "approved" ? "success" : "outline"}>{r.status === "approved" ? "Approved" : "Denied"}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
