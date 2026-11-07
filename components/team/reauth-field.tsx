"use client";

import { Input, Label } from "@/components/ui/input";
import { reauthMethod } from "@/lib/reauth";

/** The "confirm it's you" part of a sensitive form: a password box for password accounts, a note about the Google window for Google ones. */
export function ReauthField({ password, onPasswordChange, disabled }: { password: string; onPasswordChange: (value: string) => void; disabled?: boolean }) {
  const method = reauthMethod();
  if (method === "google") {
    return <p className="text-xs text-[var(--muted-foreground)]">To confirm it&apos;s you, a Google window will ask you to sign in again when you submit.</p>;
  }
  return (
    <div>
      <Label htmlFor="reauth-password">Your password</Label>
      <Input id="reauth-password" type="password" autoComplete="current-password" value={password} onChange={(e) => onPasswordChange(e.target.value)} disabled={disabled} placeholder="To confirm it's you" />
    </div>
  );
}
