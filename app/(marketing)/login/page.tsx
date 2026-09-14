"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogIn } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMockAuth } from "@/lib/mock-auth";
import { cardEntranceVariants } from "@/lib/motion";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useMockAuth();
  const [email, setEmail] = useState("scout@compepicurus.org");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = email.split("@")[0].replace(/[._]/g, " ") || "Scout";
    login(name.replace(/\b\w/g, (c) => c.toUpperCase()), "lead");
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-16">
      <motion.div variants={cardEntranceVariants} initial="hidden" animate="show" className="w-full max-w-sm">
        <GlassPanel strong className="flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Welcome back</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Log in to your CompEpicurus account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@compepicurus.org"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                required
              />
            </div>
            <Button type="submit" size="lg" className="mt-2 gap-2">
              <LogIn className="h-4 w-4" /> Log in
            </Button>
          </form>

          <p className="text-center text-xs text-[var(--muted-foreground)]">
            This is a placeholder login &mdash; any email/password works.
          </p>

          <p className="text-center text-sm text-[var(--muted-foreground)]">
            No account?{" "}
            <Link href="/signup" className="font-medium text-[var(--foreground)] underline underline-offset-4">
              Sign up
            </Link>
          </p>
        </GlassPanel>
      </motion.div>
    </div>
  );
}
