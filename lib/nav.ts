import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  FlaskConical,
  Target,
  Users,
  UsersRound,
  ShieldAlert,
  History,
  Settings,
  SlidersHorizontal,
  Heart,
  CalendarCheck,
  UserCircle,
  CalendarRange,
  ListOrdered,
  UserSearch,
  Route,
  RotateCcw,
  Wrench,
  Lightbulb,
  HandHelping,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: boolean;
};

export const mainNav: NavItem[] = [
  { href: "/event", label: "Active Events", icon: CalendarCheck },
  { href: "/assignments", label: "Assignments", icon: CalendarRange },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/match-list", label: "Match List", icon: ListOrdered },
  { href: "/scout", label: "Match Scout Form", icon: ClipboardList },
  { href: "/lead-scout-form", label: "Lead Scout Form", icon: UserSearch },
  { href: "/match-strategy-form", label: "Match Strategy Form", icon: Route },
  { href: "/drive-reflection-form", label: "Drive Reflection Form", icon: RotateCcw },
  { href: "/pit-scout-form", label: "Pit Scout Form", icon: Wrench },
  { href: "/team-strategy-form", label: "Team Strategy Form", icon: Lightbulb },
  { href: "/helper-form", label: "Helper Form", icon: HandHelping },
  { href: "/analytics", label: "Analytics", icon: BarChart3, matchPrefix: true },
  { href: "/practice-scouting", label: "Practice Scouting", icon: FlaskConical },
  { href: "/scout-accuracy", label: "Scout Accuracy", icon: Target },
  { href: "/my-scouting", label: "My Scouting", icon: UserCircle },
  { href: "/people", label: "People", icon: Users },
  { href: "/team-management", label: "Team Management", icon: UsersRound },
];

export const secondaryNav: NavItem[] = [
  { href: "/admin", label: "Admin Panel", icon: ShieldAlert },
  { href: "/changelog", label: "Changelog", icon: History },
  { href: "/credits", label: "Credits", icon: Heart },
  { href: "/team-settings", label: "Team Settings", icon: SlidersHorizontal },
  { href: "/account", label: "Account Settings", icon: Settings },
];

/** The Analytics tabs. `group` items sit together under a small label ("Raw data": the entry tables, P30). */
export const analyticsNav: { href: string; label: string; group?: string }[] = [
  { href: "/analytics/match-scout", label: "Match Scout Analytics", group: "Raw data" },
  { href: "/analytics/lead-scout", label: "Lead Scout", group: "Raw data" },
  { href: "/analytics/pit-scout", label: "Pit Scout", group: "Raw data" },
  { href: "/analytics/team-strategy", label: "Team Strategy", group: "Raw data" },
  { href: "/analytics/match-strategy", label: "Match Strategy", group: "Raw data" },
  { href: "/analytics/drive-reflection", label: "Drive Reflection", group: "Raw data" },
  { href: "/analytics/helper", label: "Helper Analytics", group: "Raw data" },
  { href: "/analytics/team-averages", label: "Team Averages" },
  { href: "/analytics/match-breakdown", label: "Match Breakdown" },
  { href: "/analytics/rankings", label: "Rankings" },
  { href: "/analytics/team-breakdown", label: "Team Breakdown" },
  { href: "/analytics/pick-list", label: "Pick List" },
  { href: "/analytics/scout-status", label: "Scout Status" },
];
