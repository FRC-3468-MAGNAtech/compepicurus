import Link from "next/link";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-4 lg:px-8">
      <header className="glass-panel sticky top-4 z-30 mt-4 flex items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
          >
            <Trophy className="h-[18px] w-[18px] text-white" />
          </span>
          <span className="text-sm font-semibold sm:text-base">CompEpicurus</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <ThemeSwitcher compact />
          </div>
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Log in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Sign up</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16 flex flex-col items-center gap-3 py-8 text-sm text-[var(--muted-foreground)] sm:flex-row sm:justify-between">
        <span>&copy; {new Date().getFullYear()} FTC Team 3468 &mdash; MAGNAtech</span>
        <div className="flex items-center gap-4">
          <Link href="/credits" className="hover:text-[var(--foreground)]">
            Credits
          </Link>
          <Link href="/changelog" className="hover:text-[var(--foreground)]">
            Changelog
          </Link>
        </div>
      </footer>
    </div>
  );
}
