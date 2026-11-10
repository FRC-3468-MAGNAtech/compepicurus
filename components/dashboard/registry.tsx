import { ComingSoonCard } from "@/components/dashboard/shared";
import { LastMatchRecapWidget, MatchPreviewWidget } from "@/components/dashboard/widgets/drive-team";
import { HiddenGemsWidget, DataConfidenceWidget, PickSnapshotWidget, RankTrendWidget, TopTeamsWidget } from "@/components/dashboard/widgets/lead-strategist";
import { AccuracySummaryWidget, AssignmentsStatusWidget, CoverageWidget, FlaggedEntriesWidget, PracticeWeekWidget } from "@/components/dashboard/widgets/lead-scout";
import { EventHighlightsWidget, OpponentNamesWidget, ShareResultsWidget } from "@/components/dashboard/widgets/media";
import { MyAccuracyWidget, MySubmissionsWidget, NextAssignmentWidget, RecentPracticeWidget, ResumeWidget } from "@/components/dashboard/widgets/match-scout";
import { LatestCommentsWidget, TeamCoverageWidget, TeamLookupWidget, ZeroEntryTeamsWidget } from "@/components/dashboard/widgets/pit-scout";
import { PhaseVsEventWidget, ScoutsSawWidget } from "@/components/dashboard/widgets/pit-team";
import { FormCoverageWidget, FormMissingTeamsWidget, HelperLogWidget, MyAssignedTeamsWidget } from "@/components/dashboard/widgets/team-forms";
import { NextMatchWidget, OurResultsWidget, UpcomingMatchesWidget } from "@/components/dashboard/widgets/schedule-widgets";
import { AttendanceWidget, EventOverviewWidget, InterventionWidget, ScoutingHealthWidget } from "@/components/dashboard/widgets/team-coach";
import { StrengthBulletsWidget, TeamSummaryWidget } from "@/components/dashboard/widgets/judge";
import type { DashboardWidget } from "@/lib/dashboard/types";
import type { RoleId } from "@/lib/roles";

/**
 * Role → its ordered widgets (P13). **Adding a widget later is one entry here**
 * (plus its component): `{ id, title, size, render }`. A widget reads what it
 * needs from `useDashboard()` / `useOurTeamEvent()`; it never subscribes or
 * fetches itself. If a widget needs a Firestore source the role doesn't load
 * yet, add that source to `ROLE_SOURCES` in lib/dashboard/roles.ts.
 *
 * Roles whose feature doesn't exist in the app yet (pit scouting forms, judging
 * notes, media tools) get widgets backed by data we do have, plus exactly one
 * "Coming soon" card — a placeholder, never a made-up feature.
 */
export const dashboardRegistry: Record<RoleId, DashboardWidget[]> = {
  "match-scout": [
    { id: "next-assignment", title: "My next assignment", size: "medium", render: () => <NextAssignmentWidget /> },
    { id: "my-accuracy", title: "My accuracy", size: "medium", render: () => <MyAccuracyWidget /> },
    { id: "resume", title: "Resume", size: "small", render: () => <ResumeWidget /> },
    { id: "my-entries", title: "My entries here", size: "small", render: () => <MySubmissionsWidget /> },
    { id: "recent-practice", title: "Recent practice", size: "medium", render: () => <RecentPracticeWidget /> },
  ],

  "pit-scout": [
    { id: "my-assigned-teams", title: "My assigned teams", size: "medium", render: () => <MyAssignedTeamsWidget kind="pit" /> },
    { id: "pit-coverage", title: "Teams with a pit entry", size: "small", render: () => <FormCoverageWidget formType="pit-scout" title="Teams with a pit entry" noun="pit entry" href="/pit-scout-form" linkLabel="Pit Scout Form" /> },
    { id: "pit-missing", title: "Teams without a pit entry", size: "medium", render: () => <FormMissingTeamsWidget formType="pit-scout" title="Teams without a pit entry" noun="pit entry" href="/pit-scout-form" linkLabel="Pit Scout Form" /> },
    { id: "team-coverage", title: "Teams scouted", size: "small", render: () => <TeamCoverageWidget /> },
    { id: "zero-entry-teams", title: "Teams with no entries", size: "medium", render: () => <ZeroEntryTeamsWidget /> },
    { id: "team-lookup", title: "Team lookup", size: "medium", render: () => <TeamLookupWidget /> },
    { id: "pit-helper-log", title: "Pit assists", size: "medium", render: () => <HelperLogWidget /> },
    { id: "latest-comments", title: "Latest scout comments", size: "wide", render: () => <LatestCommentsWidget /> },
  ],

  "pit-team": [
    { id: "next-match", title: "Next match", size: "medium", render: () => <NextMatchWidget /> },
    { id: "our-results", title: "Our results", size: "medium", render: () => <OurResultsWidget /> },
    { id: "scouts-saw", title: "What scouts saw on us", size: "wide", render: () => <ScoutsSawWidget /> },
    { id: "phases-vs-event", title: "Our phases vs the event", size: "medium", render: () => <PhaseVsEventWidget /> },
    { id: "pit-helper-log", title: "Pit assists", size: "medium", render: () => <HelperLogWidget /> },
  ],

  "drive-team": [
    { id: "next-match", title: "Next match", size: "medium", render: () => <NextMatchWidget showOpponents /> },
    { id: "match-preview", title: "Match preview", size: "wide", render: () => <MatchPreviewWidget /> },
    { id: "last-match", title: "Last match recap", size: "medium", render: () => <LastMatchRecapWidget /> },
  ],

  "lead-scout": [
    { id: "coverage", title: "Scouting coverage", size: "medium", render: () => <CoverageWidget /> },
    { id: "accuracy-summary", title: "Scout accuracy", size: "medium", render: () => <AccuracySummaryWidget /> },
    { id: "flagged", title: "Flagged entries", size: "small", render: () => <FlaggedEntriesWidget /> },
    { id: "assignments", title: "Assignments", size: "small", render: () => <AssignmentsStatusWidget /> },
    { id: "practice-week", title: "Practice this week", size: "small", render: () => <PracticeWeekWidget /> },
  ],

  "lead-strategist": [
    { id: "my-assigned-teams", title: "My assigned teams", size: "medium", render: () => <MyAssignedTeamsWidget kind="teamStrategy" /> },
    { id: "rank-trend", title: "Our rank & trend", size: "small", render: () => <RankTrendWidget /> },
    { id: "pick-list", title: "Pick list", size: "medium", render: () => <PickSnapshotWidget /> },
    { id: "top-teams", title: "Top teams (scouted)", size: "medium", render: () => <TopTeamsWidget /> },
    { id: "opponents", title: "Next-match opponents", size: "wide", render: () => <MatchPreviewWidget opponentsOnly /> },
    { id: "data-confidence", title: "Data confidence", size: "small", render: () => <DataConfidenceWidget /> },
    { id: "hidden-gems", title: "Hidden gems", size: "medium", render: () => <HiddenGemsWidget /> },
    { id: "strategy-coverage", title: "Teams without a strategy entry", size: "medium", render: () => <FormMissingTeamsWidget formType="team-strategy" title="Teams without a strategy entry" noun="strategy entry" href="/team-strategy-form" linkLabel="Team Strategy Form" /> },
  ],

  "team-coach": [
    { id: "event-overview", title: "Event overview", size: "medium", render: () => <EventOverviewWidget /> },
    { id: "upcoming", title: "Upcoming schedule", size: "medium", render: () => <UpcomingMatchesWidget /> },
    { id: "scouting-health", title: "Scouting health", size: "small", render: () => <ScoutingHealthWidget /> },
    { id: "intervention", title: "Mentor Intervention", size: "medium", render: () => <InterventionWidget /> },
    { id: "attendance", title: "Attendance", size: "small", render: () => <AttendanceWidget /> },
  ],

  media: [
    { id: "schedule", title: "Our schedule", size: "medium", render: () => <UpcomingMatchesWidget title="Our schedule" limit={6} /> },
    { id: "opponent-names", title: "Upcoming opponents", size: "medium", render: () => <OpponentNamesWidget /> },
    { id: "share-results", title: "Results to share", size: "wide", render: () => <ShareResultsWidget /> },
    { id: "highlights", title: "Event highlights", size: "medium", render: () => <EventHighlightsWidget /> },
    { id: "media-soon", title: "Media tools", size: "small", render: () => <ComingSoonCard title="Media tools" description="Nothing here yet — this role's tools are still to come." /> },
  ],

  "judge-awards": [
    { id: "team-summary", title: "Our team summary", size: "medium", render: () => <TeamSummaryWidget /> },
    { id: "strengths", title: "Our strengths", size: "medium", render: () => <StrengthBulletsWidget /> },
    { id: "judging-soon", title: "Judging notes", size: "small", render: () => <ComingSoonCard title="Judging notes" description="Judging notes aren't in the app yet." /> },
  ],
};
