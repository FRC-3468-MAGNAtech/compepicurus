"use client";

import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROLES, getRole, type RoleId } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * Role controls for the dashboard: a segmented control across the user's own
 * roles (shown only when they have more than one — the choice is remembered),
 * and, for admins, a "View as role" menu that previews any role's dashboard
 * without changing what they've saved.
 */
export function RoleSwitcher({
  roles,
  active,
  onChange,
  isAdmin,
  viewAs,
  onViewAs,
}: {
  /** The user's own roles, primary first. */
  roles: RoleId[];
  /** The role currently showing (the preview, when an admin is viewing as someone else). */
  active: RoleId;
  onChange: (role: RoleId) => void;
  isAdmin: boolean;
  viewAs: RoleId | null;
  onViewAs: (role: RoleId | null) => void;
}) {
  const previewing = isAdmin && viewAs !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {roles.length > 1 && (
          <Tabs value={previewing ? "" : active} onValueChange={(v) => onChange(v as RoleId)}>
            <TabsList className="max-w-full overflow-x-auto" aria-label="Your roles">
              {roles.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {getRole(r).label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">View as role</span>
            <Select value={viewAs ?? "__mine"} onValueChange={(v) => onViewAs(v === "__mine" ? null : (v as RoleId))}>
              <SelectTrigger className="h-11 w-48" aria-label="View as role">
                <SelectValue>{viewAs ? getRole(viewAs).label : "My own roles"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__mine">My own roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {previewing && (
        <div className={cn("flex items-center gap-2 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs font-medium text-sky-200")}>
          <Eye className="h-4 w-4 shrink-0" />
          <span className="flex-1">Previewing the {getRole(viewAs!).label} dashboard. Nothing you do here changes anyone&apos;s settings.</span>
          <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => onViewAs(null)}>
            <X className="h-3.5 w-3.5" /> Back to mine
          </Button>
        </div>
      )}
    </div>
  );
}
