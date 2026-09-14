"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { people, type Person } from "@/lib/mock-data";

const subteams: Person["subteam"][] = ["Mechanical", "Programming", "Scouting", "Business", "CAD"];

export default function TeamManagementPage() {
  const [roster, setRoster] = useState(people);
  const [name, setName] = useState("");
  const [subteam, setSubteam] = useState<Person["subteam"]>("Scouting");
  const [role, setRole] = useState("");
  const [open, setOpen] = useState(false);

  const addMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setRoster((r) => [
      ...r,
      {
        id: `p${r.length + 1}`,
        name,
        grade: "9th",
        subteam,
        role: role || "Member",
        email: `${name.split(" ")[0].toLowerCase()}@compepicurus.org`,
      },
    ]);
    setName("");
    setRole("");
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team Management</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Assign sub-teams and roles across the roster.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" /> Add member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Add a team member</DialogTitle>
            <DialogDescription>Placeholder only &mdash; nothing is saved beyond this session.</DialogDescription>
            <form onSubmit={addMember} className="mt-4 flex flex-col gap-4">
              <div>
                <Label htmlFor="member-name">Name</Label>
                <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="member-role">Role</Label>
                <Input id="member-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Scout" />
              </div>
              <div>
                <Label htmlFor="member-subteam">Sub-team</Label>
                <Select value={subteam} onValueChange={(v) => setSubteam(v as Person["subteam"])}>
                  <SelectTrigger id="member-subteam">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subteams.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="mt-1">Add to roster</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {subteams.map((st) => {
          const members = roster.filter((p) => p.subteam === st);
          return (
            <GlassPanel key={st} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{st}</h2>
                <Badge variant="glass">{members.length}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {members.map((m) => (
                  <div key={m.id} className="glass-card flex items-center gap-2.5 p-2.5">
                    <Avatar name={m.name} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{m.name}</div>
                      <div className="truncate text-[10px] text-[var(--muted-foreground)]">{m.role}</div>
                    </div>
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">No members yet.</p>
                )}
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}
