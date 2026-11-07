"use client";

import Link from "next/link";
import { fieldTeamLabel } from "@/lib/field-teams";
import { useFieldTeams } from "@/lib/field-teams-context";
import { cn } from "@/lib/utils";

/**
 * The small footer on every page (P14): a credit line plus the Credits and Changelog links. Since P19 the credit line is
 * data-driven: signed in, it lists the account's FTC teams ("FTC 35792, FTC 35794"); signed out (marketing pages, which can't
 * read team data) it is just the app name.
 */
export function SiteFooter({ className }: { className?: string }) {
  const { fieldTeams } = useFieldTeams();
  const teams = fieldTeams.map(fieldTeamLabel).join(", ");
  return (
    <footer className={cn("flex flex-col items-center gap-3 py-6 text-sm text-[var(--muted-foreground)] sm:flex-row sm:justify-between", className)}>
      <span>
        &copy; {new Date().getFullYear()} CompEpicurus{teams && <> &mdash; {teams}</>}
      </span>
      <nav aria-label="Footer" className="flex items-center gap-4">
        <Link href="/credits" className="transition-colors hover:text-[var(--foreground)]">
          Credits
        </Link>
        <Link href="/changelog" className="transition-colors hover:text-[var(--foreground)]">
          Changelog
        </Link>
      </nav>
    </footer>
  );
}
