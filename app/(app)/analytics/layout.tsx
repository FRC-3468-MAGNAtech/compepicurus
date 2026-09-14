import { AnalyticsTabs } from "@/components/layout/analytics-tabs";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Everything the scouting data tells us, sliced a few ways.</p>
      </div>
      <AnalyticsTabs />
      <div>{children}</div>
    </div>
  );
}
