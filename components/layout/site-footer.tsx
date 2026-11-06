import Link from "next/link";
import { cn } from "@/lib/utils";

/** The small footer on every page (P14): team credit line plus the Credits and Changelog links. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("flex flex-col items-center gap-3 py-6 text-sm text-[var(--muted-foreground)] sm:flex-row sm:justify-between", className)}>
      <span>&copy; {new Date().getFullYear()} FTC Team 3468 &mdash; MAGNAtech</span>
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
