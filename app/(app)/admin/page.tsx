"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { scouts } from "@/lib/mock-data";

const roles = ["scout", "lead", "admin"];

export default function AdminPanelPage() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [allowSignups, setAllowSignups] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <GlassPanel
        strong
        className="flex items-center gap-3 border-red-400/30"
        style={{ boxShadow: "0 0 0 1px rgba(239,68,68,0.25), 0 12px 32px -12px rgba(239,68,68,0.35)" }}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/15">
          <ShieldAlert className="h-5 w-5 text-red-300" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Admin Panel</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Elevated controls &mdash; changes here affect the whole team.</p>
        </div>
        <Badge variant="danger" className="ml-auto">Privileged area</Badge>
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">App settings</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Maintenance mode</div>
              <div className="text-xs text-[var(--muted-foreground)]">Show a banner and disable new scout submissions.</div>
            </div>
            <Switch checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Allow new signups</div>
              <div className="text-xs text-[var(--muted-foreground)]">Let new scouts create accounts.</div>
            </div>
            <Switch checked={allowSignups} onCheckedChange={setAllowSignups} />
          </div>
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-4 border-red-400/20">
          <h2 className="flex items-center gap-2 text-base font-semibold text-red-300">
            <AlertTriangle className="h-4 w-4" /> Danger zone
          </h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Reset all match data</div>
              <div className="text-xs text-[var(--muted-foreground)]">Placeholder action &mdash; no real data will be deleted.</div>
            </div>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button variant="danger" size="sm" className="gap-2 shrink-0">
                  <Trash2 className="h-3.5 w-3.5" /> Reset
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Reset all match data?</DialogTitle>
                <DialogDescription>
                  This is a placeholder scaffold &mdash; there is no real data to delete. In the finished app this
                  would be irreversible.
                </DialogDescription>
                <div className="mt-4 flex justify-end gap-3">
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                  <Button variant="danger" onClick={() => setConfirmOpen(false)} className="gap-2">
                    <RefreshCw className="h-3.5 w-3.5" /> Confirm reset
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel>
        <h2 className="mb-4 text-base font-semibold">User roles</h2>
        <div className="flex flex-col gap-2.5">
          {scouts.map((s) => (
            <div key={s.id} className="glass-card flex items-center gap-3 p-3.5">
              <Avatar name={s.name} color={s.avatarColor} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="truncate text-xs text-[var(--muted-foreground)]">{s.role}</div>
              </div>
              <Select defaultValue={s.id === "s1" ? "admin" : "scout"}>
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
