export type Scout = {
  id: string;
  name: string;
  role: "Scout" | "Lead Scout" | "Drive Team" | "Mentor";
  matchesScouted: number;
  accuracy: number;
  avatarColor: string;
};

export const scouts: Scout[] = [
  { id: "s1", name: "Priya Nandakumar", role: "Lead Scout", matchesScouted: 142, accuracy: 96.2, avatarColor: "#e11d3c" },
  { id: "s2", name: "Marcus Webb", role: "Scout", matchesScouted: 88, accuracy: 91.4, avatarColor: "#f5b400" },
  { id: "s3", name: "Ana Torres", role: "Scout", matchesScouted: 103, accuracy: 94.8, avatarColor: "#ff7a45" },
  { id: "s4", name: "Devon Ellis", role: "Drive Team", matchesScouted: 41, accuracy: 88.1, avatarColor: "#e11d3c" },
  { id: "s5", name: "Kai Fujimoto", role: "Scout", matchesScouted: 76, accuracy: 92.9, avatarColor: "#f5b400" },
  { id: "s6", name: "Lena Brandt", role: "Mentor", matchesScouted: 59, accuracy: 97.5, avatarColor: "#ff7a45" },
];

export type TeamStat = {
  teamNumber: number;
  teamName: string;
  avgAuto: number;
  avgTeleop: number;
  avgEndgame: number;
  avgTotal: number;
  winRate: number;
  rank: number;
};

export const teamStats: TeamStat[] = [
  { teamNumber: 3468, teamName: "MAGNAtech", avgAuto: 18.4, avgTeleop: 62.1, avgEndgame: 14.0, avgTotal: 94.5, winRate: 0.78, rank: 2 },
  { teamNumber: 254, teamName: "The Cheesy Poofs", avgAuto: 21.2, avgTeleop: 68.9, avgEndgame: 15.0, avgTotal: 105.1, winRate: 0.86, rank: 1 },
  { teamNumber: 1114, teamName: "Simbotics", avgAuto: 16.7, avgTeleop: 55.3, avgEndgame: 12.0, avgTotal: 84.0, winRate: 0.71, rank: 3 },
  { teamNumber: 118, teamName: "Robonauts", avgAuto: 14.9, avgTeleop: 51.8, avgEndgame: 10.0, avgTotal: 76.7, winRate: 0.64, rank: 4 },
  { teamNumber: 6672, teamName: "Amp'd Up", avgAuto: 12.1, avgTeleop: 44.2, avgEndgame: 9.0, avgTotal: 65.3, winRate: 0.55, rank: 5 },
  { teamNumber: 8110, teamName: "Bearbotics", avgAuto: 10.8, avgTeleop: 39.6, avgEndgame: 7.0, avgTotal: 57.4, winRate: 0.48, rank: 6 },
];

export type MatchEntry = {
  id: string;
  matchNumber: number;
  redAlliance: number[];
  blueAlliance: number[];
  redScore: number;
  blueScore: number;
  scout: string;
  time: string;
};

export const matches: MatchEntry[] = [
  { id: "m1", matchNumber: 12, redAlliance: [3468, 254, 118], blueAlliance: [1114, 6672, 8110], redScore: 187, blueScore: 152, scout: "Priya Nandakumar", time: "9:14 AM" },
  { id: "m2", matchNumber: 13, redAlliance: [1114, 118, 8110], blueAlliance: [3468, 254, 6672], redScore: 140, blueScore: 201, scout: "Marcus Webb", time: "9:26 AM" },
  { id: "m3", matchNumber: 14, redAlliance: [3468, 6672, 8110], blueAlliance: [254, 1114, 118], redScore: 168, blueScore: 175, scout: "Ana Torres", time: "9:38 AM" },
  { id: "m4", matchNumber: 15, redAlliance: [254, 8110, 118], blueAlliance: [3468, 1114, 6672], redScore: 159, blueScore: 190, scout: "Kai Fujimoto", time: "9:50 AM" },
];

export type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  tag: "feature" | "fix" | "improvement";
  notes: string[];
};

export const changelog: ChangelogEntry[] = [
  {
    version: "0.4.0",
    date: "2026-09-10",
    title: "Bouncy Glass redesign",
    tag: "feature",
    notes: [
      "Introduced the glassmorphic design system with theme switching",
      "Added Team Colors and BIOBUZZ palettes",
      "Rebuilt navigation with a collapsible glass sidebar",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-08-22",
    title: "Scout accuracy tracking",
    tag: "improvement",
    notes: ["Added per-scout consistency scoring", "Fixed rounding error in team averages"],
  },
  {
    version: "0.3.0",
    date: "2026-08-05",
    title: "Pick list & rankings",
    tag: "feature",
    notes: ["New pick list builder for alliance selection", "Live rankings table"],
  },
  {
    version: "0.2.0",
    date: "2026-07-18",
    title: "Practice scouting sandbox",
    tag: "feature",
    notes: ["Practice mode no longer writes to real match data"],
  },
  {
    version: "0.1.0",
    date: "2026-06-30",
    title: "Initial scaffold",
    tag: "fix",
    notes: ["Project bootstrapped"],
  },
];

export type Person = {
  id: string;
  name: string;
  grade: string;
  subteam: "Mechanical" | "Programming" | "Scouting" | "Business" | "CAD";
  role: string;
  email: string;
};

export const people: Person[] = [
  { id: "p1", name: "Priya Nandakumar", grade: "12th", subteam: "Scouting", role: "Lead Scout", email: "priya@compepicurus.org" },
  { id: "p2", name: "Marcus Webb", grade: "11th", subteam: "Programming", role: "Software Lead", email: "marcus@compepicurus.org" },
  { id: "p3", name: "Ana Torres", grade: "10th", subteam: "Scouting", role: "Scout", email: "ana@compepicurus.org" },
  { id: "p4", name: "Devon Ellis", grade: "12th", subteam: "Mechanical", role: "Drive Coach", email: "devon@compepicurus.org" },
  { id: "p5", name: "Kai Fujimoto", grade: "9th", subteam: "CAD", role: "CAD Designer", email: "kai@compepicurus.org" },
  { id: "p6", name: "Lena Brandt", grade: "Mentor", subteam: "Business", role: "Mentor", email: "lena@compepicurus.org" },
];

export type PickListEntry = {
  rank: number;
  teamNumber: number;
  teamName: string;
  notes: string;
};

export const pickList: PickListEntry[] = [
  { rank: 1, teamNumber: 254, teamName: "The Cheesy Poofs", notes: "Elite auto + consistent endgame" },
  { rank: 2, teamNumber: 3468, teamName: "MAGNAtech", notes: "Strong teleop cycles, good driver" },
  { rank: 3, teamNumber: 1114, teamName: "Simbotics", notes: "Reliable defense partner" },
  { rank: 4, teamNumber: 118, teamName: "Robonauts", notes: "Backup pick, decent scoring" },
];

export const dashboardStats = [
  { label: "Matches Scouted", value: "142", delta: "+18 today" },
  { label: "Teams Tracked", value: "36", delta: "+2 this event" },
  { label: "Active Scouts", value: "6", delta: "on shift now" },
  { label: "Avg. Scout Accuracy", value: "93.5%", delta: "+1.2% this week" },
];
