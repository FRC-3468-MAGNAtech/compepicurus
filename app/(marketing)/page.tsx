import Link from "next/link";
import { ArrowRight, BarChart3, ClipboardList, Sparkles, Target, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: ClipboardList,
    title: "Match Scout Form",
    desc: "Fast, tap-friendly data entry built for the noise of an event floor.",
  },
  {
    icon: BarChart3,
    title: "Live Analytics",
    desc: "Team averages, match breakdowns, rankings, and pick lists — updated in real time.",
  },
  {
    icon: Target,
    title: "Scout Accuracy",
    desc: "Track consistency across scouts so alliance selection data stays trustworthy.",
  },
  {
    icon: Users,
    title: "Team Management",
    desc: "Roster, sub-teams, and roles in one place for the whole program.",
  },
];

export default function LandingPage() {
  return (
    <div className="pb-20">
      <section className="relative flex flex-col items-center gap-8 pt-16 text-center sm:pt-24">
        <Badge variant="glass" className="gap-2 px-4 py-1.5">
          <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--color-secondary)" }} />
          Built for FTC Team 3468 &mdash; MAGNAtech
        </Badge>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Scout smarter.
          <br />
          <span className="text-gradient">Pick winners.</span>
        </h1>
        <p className="max-w-xl text-balance text-base text-[var(--muted-foreground)] sm:text-lg">
          CompEpicurus is MAGNAtech&apos;s scouting platform — match data entry, live analytics,
          and alliance selection tools, wrapped in one glassy, bouncy interface.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup">
            <Button size="lg" className="gap-2">
              Get started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="glass">
              Log in
            </Button>
          </Link>
        </div>

        <GlassPanel strong className="mt-10 w-full max-w-4xl overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-5 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400/70" />
            <span className="h-3 w-3 rounded-full bg-amber-400/70" />
            <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
            <span className="ml-3 text-xs text-[var(--muted-foreground)]">dashboard &mdash; compepicurus.app</span>
          </div>
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
            {["Matches Scouted", "Teams Tracked", "Active Scouts", "Avg. Accuracy"].map((label, i) => (
              <div key={label} className="glass-card p-4 text-left">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
                <div className="mt-2 text-2xl font-semibold">{["142", "36", "6", "93.5%"][i]}</div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </section>

      <section className="mt-24 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(({ icon: Icon, title, desc }) => (
          <GlassPanel key={title} interactive className="flex flex-col gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{ background: "rgba(var(--glow), 0.16)" }}
            >
              <Icon className="h-5 w-5" style={{ color: "var(--color-primary)" }} />
            </span>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-sm text-[var(--muted-foreground)]">{desc}</p>
          </GlassPanel>
        ))}
      </section>

      <section className="mt-24 flex justify-center">
        <GlassPanel strong className="flex w-full max-w-3xl flex-col items-center gap-5 py-12 text-center">
          <Trophy className="h-10 w-10" style={{ color: "var(--color-secondary)" }} />
          <h2 className="text-2xl font-semibold sm:text-3xl">Ready to scout your next event?</h2>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">
            Create an account to join the MAGNAtech scouting roster and start logging matches.
          </p>
          <Link href="/signup">
            <Button size="lg" className="gap-2">
              Create your account <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </GlassPanel>
      </section>
    </div>
  );
}
