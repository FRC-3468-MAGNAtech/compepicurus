import type { ChangeItem } from "@/lib/changelog";

// Starter changelog drafts (P14). They are created as **drafts** the first time
// an admin opens the Changelog, so an admin can review, reword, and publish
// them — nothing is published on anyone's behalf. Every line describes
// something that exists in the app today (checked against docs/ARCHITECTURE.md
// and the code); dates are the real dates the work landed in git history, and the
// version labels are just a suggested numbering an admin can change.

export type StarterEntry = {
  /** Stable key — the Firestore doc id is `starter-{teamId}-{key}`, so seeding is idempotent. */
  key: string;
  version: string;
  title: string;
  date: string;
  summary: string;
  changes: ChangeItem[];
};

export const STARTER_ENTRIES: StarterEntry[] = [
  {
    key: "v0-1-0",
    version: "v0.1.0",
    title: "Match scouting and the FIRST event data",
    date: "2026-10-19",
    summary: "The first working version: pick an event, scout a match, and see the results in a table.",
    changes: [
      { type: "new", text: "**Event Selection** — browse FTC events from the FIRST Events API and set the one your team is at." },
      { type: "new", text: "**Match Scout Form** — pick a match and team, then log autonomous, teleoperated, and endgame scoring plus incidents, with a live score bar." },
      { type: "new", text: "**Match Scout Analytics** — every scout entry in a sortable table with sticky match and team columns, flags, and a Config modal for reviewing an entry." },
      { type: "new", text: "A glass design system with team and BIOBUZZ themes." },
    ],
  },
  {
    key: "v0-2-0",
    version: "v0.2.0",
    title: "Accounts, roles, and scout accuracy",
    date: "2026-10-23",
    summary: "Real sign-in and teams, and the first tools for checking how accurate our scouting is.",
    changes: [
      { type: "new", text: "Sign in with email or Google, and create or join a team with a join code." },
      { type: "new", text: "**Roles** (Match Scout, Pit Scout, Drive Team, Lead Scout and more) with a primary role, secondary roles, and admin access, managed in Team Management." },
      { type: "new", text: "**Accuracy** — each alliance's scouted total is compared with the official score, and every scout gets a status band." },
      { type: "new", text: "**Practice Scouting** — scout recorded matches solo in Trial or Competitive mode, with an official-score reveal at the end." },
      { type: "new", text: "**Scout Accuracy** and **My Scouting** — leaderboards and a personal view of your accuracy by category." },
      { type: "improved", text: "The Match Scout Form now builds itself from a form schema, so a new season's form is data rather than code." },
      { type: "fixed", text: "Dropdowns showing a blank label until first opened, and pages that hung on their loading spinner after sign-in." },
    ],
  },
  {
    key: "v0-3-0",
    version: "v0.3.0",
    title: "Assignments and live practice",
    date: "2026-10-26",
    summary: "Plan who scouts what, and practice against real matches as they happen.",
    changes: [
      { type: "new", text: "**Assignments** — mark who is attending an event and generate a fair scouting schedule, with undo and manual swaps." },
      { type: "new", text: "**Live Practice** — scout a livestreamed match in real time, with a partner finding the other robot on the alliance and a notification when official scores arrive." },
      { type: "new", text: "**Live Practice Lobby** — a Kahoot-style group round: join with a code, scout the same match, and see whose accuracy was best." },
      { type: "new", text: "Practice data in Match Scout Analytics, and **Admin Panel** tools to look up a session, edit an entry, rescore, and export backups." },
    ],
  },
  {
    key: "v0-4-0",
    version: "v0.4.0",
    title: "Analytics, multiple events, and a smoother app",
    date: "2026-11-02",
    summary: "The Analytics pages come alive, and the app handles more than one active event.",
    changes: [
      { type: "new", text: "**Team Profile**, **Team Averages**, and **Rankings** built from scouted data, with one shared filter bar (game, events, practice, accuracy) on every Analytics page." },
      { type: "new", text: "**Match Breakdown** — every official match with an alliance bar, per-robot detail, and accuracy — and **Team Breakdown** cards." },
      { type: "new", text: "Select **several active events** at once and mark one as primary; pickers across the app offer them all." },
      { type: "new", text: "Team Management has a proper **role editor** (primary, secondary, admin) with owner and last-admin protection, and every change is logged." },
      { type: "improved", text: "Event Selection sorts In Progress, Upcoming, then Completed, with filters, and keeps your selected events visible as you scroll." },
      { type: "fixed", text: "Page content starting too low and then snapping into place on every page." },
    ],
  },
  {
    key: "v0-5-0",
    version: "v0.5.0",
    title: "Pick List and role dashboards",
    date: "2026-11-05",
    summary: "Plan alliance selection together, and open the app to a dashboard made for your role.",
    changes: [
      { type: "new", text: "**Pick List** — a shared, live board to plan alliance selection, with official rank, scouted rank, an EPA rating from official scores, and a pick-likelihood estimate." },
      { type: "new", text: "**Role dashboards** — each role gets its own glanceable widgets, with a header showing our rank, record, and next match." },
      { type: "new", text: "Admins can preview any role's dashboard with **View as role**." },
    ],
  },
  {
    key: "v0-6-0",
    version: "v0.6.0",
    title: "Match List, reorderable events, and fixes",
    date: "2026-11-07",
    summary: "See the whole schedule in one place, put the active events in the order you want, and a few things that were annoying.",
    changes: [
      { type: "new", text: "**Match List** — the schedule and results for the events we're signed up for, with Practice, Qualifications and Playoffs tabs, our teams highlighted, a next-match marker, team search and a refresh button." },
      { type: "new", text: "**Active Events** can be dragged into order (or moved with the arrows). The first event is always the primary one." },
      { type: "improved", text: "The condensed Active Events bar shows every event's code, so nothing looks different from the next one." },
      { type: "improved", text: "**Credits** opens in a clean view for everyone; admins press **Edit credits** to change it and **Done** to finish." },
      { type: "fixed", text: "Switching your profile between **public and private** now saves the moment you pick it, and you always see your own profile." },
    ],
  },
  {
    key: "v0-7-0",
    version: "v0.7.0",
    title: "Page access",
    date: "2026-11-07",
    summary: "Some pages are now only for the roles that need them, and admins decide who gets what.",
    changes: [
      { type: "new", text: "**Page access** — every page is either open to everyone, limited to certain roles, or admin-only. Admins manage it in **Admin Panel > Page Access**: a role-by-role table, per-member extras, and a **Preview as member** view." },
      { type: "new", text: "If you open a page you can't use, you get a clear message and a **Request access** button; admins approve or deny requests in Page Access." },
      { type: "improved", text: "**Scout Accuracy** and **Scout Status** are now for Lead Scouts and Team Coaches, **Assignments** for Lead Scouts, **Event Selection** for Lead Scouts, Lead Strategists and Team Coaches, and **Team Management** for Team Coaches. Admins and the owner can open everything, and an admin can change any of this." },
      { type: "improved", text: "Who can change **Assignments** and the **Scout Status** targets now follows who can open those pages." },
      { type: "improved", text: "Dashboard, Match Scout Form, Analytics (except Scout Status), Practice Scouting, My Scouting, People, Changelog, Credits, Account Settings and Match List stay open to everyone." },
    ],
  },
];

/** The Firestore doc id for a starter entry — deterministic, so two admins opening the page at once can't create it twice. */
export const starterDocId = (teamId: string, key: string): string => `starter-${teamId}-${key}`;
