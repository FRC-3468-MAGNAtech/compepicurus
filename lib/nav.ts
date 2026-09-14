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
  Heart,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: boolean;
};

export const mainNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scout", label: "Match Scout Form", icon: ClipboardList },
  { href: "/analytics", label: "Analytics", icon: BarChart3, matchPrefix: true },
  { href: "/practice-scouting", label: "Practice Scouting", icon: FlaskConical },
  { href: "/scout-accuracy", label: "Scout Accuracy", icon: Target },
  { href: "/people", label: "People", icon: Users },
  { href: "/team-management", label: "Team Management", icon: UsersRound },
];

export const secondaryNav: NavItem[] = [
  { href: "/admin", label: "Admin Panel", icon: ShieldAlert },
  { href: "/changelog", label: "Changelog", icon: History },
  { href: "/credits", label: "Credits", icon: Heart },
  { href: "/account", label: "Account Settings", icon: Settings },
];

export const analyticsNav = [
  { href: "/analytics/match-scout", label: "Match Scout Analytics" },
  { href: "/analytics/team-averages", label: "Team Averages" },
  { href: "/analytics/match-breakdown", label: "Match Breakdown" },
  { href: "/analytics/rankings", label: "Rankings" },
  { href: "/analytics/team-breakdown", label: "Team Breakdown" },
  { href: "/analytics/pick-list", label: "Pick List" },
  { href: "/analytics/scout-status", label: "Scout Status" },
];
