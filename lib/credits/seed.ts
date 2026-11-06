import type { CreditSection } from "@/lib/credits/ops";

// What the Credits page shows until an admin edits it (P14). Nothing is written
// to Firestore for these — the first edit materialises them into
// `credits/{teamId}` (store.ts), which is why every id here is fixed: an edit
// made against the defaults has to find the same section and entry ids when it's
// replayed on the stored copy.
//
// The built-with list reflects what the project really uses: the app is Next.js
// (App Router) on React, not Vite — see docs/ASSUMPTIONS.md (P14).

export const DEFAULT_CREDITS: CreditSection[] = [
  {
    id: "built-with-ai",
    title: "Built with AI",
    order: 0,
    entries: [
      {
        id: "claude",
        name: "Claude (Anthropic)",
        description: "AI collaborator — wrote and reviewed code alongside the team, from the data model to the interface.",
        link: "https://www.anthropic.com/claude",
        imageUrl: null,
      },
    ],
  },
  {
    id: "team",
    title: "Team",
    order: 1,
    entries: [
      { id: "member-1", name: "Team member name", description: "Role — an admin can replace this placeholder.", link: null, imageUrl: null },
      { id: "member-2", name: "Team member name", description: "Role — an admin can replace this placeholder.", link: null, imageUrl: null },
      { id: "member-3", name: "Team member name", description: "Role — an admin can replace this placeholder.", link: null, imageUrl: null },
    ],
  },
  {
    id: "built-with",
    title: "Built with",
    order: 2,
    entries: [
      { id: "react", name: "React", description: "The interface library.", link: "https://react.dev", imageUrl: null },
      { id: "nextjs", name: "Next.js", description: "The app framework — routing, server routes, and builds.", link: "https://nextjs.org", imageUrl: null },
      { id: "tailwind", name: "Tailwind CSS", description: "Utility-first styling for the glass design system.", link: "https://tailwindcss.com", imageUrl: null },
      { id: "framer-motion", name: "Framer Motion", description: "The spring animations and transitions.", link: "https://www.framer.com/motion/", imageUrl: null },
      { id: "firebase", name: "Firebase", description: "Sign-in and the realtime Firestore database.", link: "https://firebase.google.com", imageUrl: null },
      { id: "vercel", name: "Vercel", description: "Hosting and deployment.", link: "https://vercel.com", imageUrl: null },
    ],
  },
  {
    id: "data",
    title: "Data",
    order: 3,
    entries: [
      {
        id: "ftc-events-api",
        name: "FIRST Tech Challenge Events API",
        description: "Events, teams, matches, and official scores and rankings.",
        link: "https://ftc-events.firstinspires.org/services/API",
        imageUrl: null,
      },
    ],
  },
];
