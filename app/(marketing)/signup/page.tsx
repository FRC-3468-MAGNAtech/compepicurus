"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMockAuth } from "@/lib/mock-auth";
import { cardEntranceVariants } from "@/lib/motion";

export default function SignupPage() {
  const router = useRouter();
  const { login } = useMockAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subteam, setSubteam] = useState("Scouting");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(name || "New Scout", "scout");
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-16">
      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className="w-full max-w-sm">
        <GlassPanel strong className="flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Join the team</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Create your CompEpicurus scouting account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" required />
            </div>
            <div>
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@compepicurus.org"
                required
              />
            </div>
            <div>
              <Label htmlFor="subteam">Sub-team</Label>
              <Select value={subteam} onValueChange={setSubteam}>
                <SelectTrigger id="subteam">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Scouting", "Mechanical", "Programming", "Business", "CAD"].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="lg" className="mt-2 gap-2">
              <UserPlus className="h-4 w-4" /> Create account
            </Button>
          </form>

          <p className="text-center text-xs text-[var(--muted-foreground)]">
            This is a placeholder signup &mdash; no data leaves your browser.
          </p>

          <p className="text-center text-sm text-[var(--muted-foreground)]">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[var(--foreground)] underline underline-offset-4">
              Log in
            </Link>
          </p>
        </GlassPanel>
      </motion.div>
    </div>
  );
}
