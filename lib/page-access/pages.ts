import type { RoleId } from "@/lib/roles";

// P26: the single registry of who may open which page. A new page declares its access HERE, once; the navigation,
// the route guard, the Admin Panel's Page Access screen and (for gated writes) firestore.rules' `pageAccessAllowed()` all
// follow it. Pure: no React, no Firebase.

/**
 *  - `open`: every role, not configurable.
 *  - `restricted`: configurable. The default roles below apply until an admin changes them (Admin Panel > Page Access).
 *  - `admin`: admins and the owner only, never grantable.
 * Admins and the owner can always open every page.
 */
export type PageAccessKind = "open" | "restricted" | "admin";

export type PageDef = {
  /** Stable id (stored in the page-access doc; never rename one). */
  id: string;
  title: string;
  /** The main route first. A path belongs to the page whose route is its longest match (a route matches itself and everything below it). */
  routes: string[];
  access: PageAccessKind;
  /** For `restricted` pages: the roles (primary OR secondary) that can open it until an admin changes it. Empty for open and admin pages. */
  defaultRoles: RoleId[];
};

export const PAGES: PageDef[] = [
  // --- open to every role ------------------------------------------------------------------------------------
  { id: "dashboard", title: "Dashboard", routes: ["/dashboard"], access: "open", defaultRoles: [] },
  { id: "match-scout-form", title: "Match Scout Form", routes: ["/scout"], access: "open", defaultRoles: [] },
  // Every Analytics subpage except Scout Status (a longer route below wins for that one).
  { id: "analytics", title: "Analytics", routes: ["/analytics"], access: "open", defaultRoles: [] },
  { id: "practice-scouting", title: "Practice Scouting", routes: ["/practice-scouting"], access: "open", defaultRoles: [] },
  { id: "my-scouting", title: "My Scouting", routes: ["/my-scouting"], access: "open", defaultRoles: [] },
  { id: "people", title: "People", routes: ["/people", "/profile"], access: "open", defaultRoles: [] },
  { id: "changelog", title: "Changelog", routes: ["/changelog"], access: "open", defaultRoles: [] },
  { id: "credits", title: "Credits", routes: ["/credits"], access: "open", defaultRoles: [] },
  { id: "account-settings", title: "Account Settings", routes: ["/account"], access: "open", defaultRoles: [] },
  { id: "match-list", title: "Match List", routes: ["/match-list"], access: "open", defaultRoles: [] },

  // --- restricted (configurable) -----------------------------------------------------------------------------
  { id: "lead-scout-form", title: "Lead Scout Form", routes: ["/lead-scout-form"], access: "restricted", defaultRoles: ["lead-scout"] },
  { id: "pit-scout-form", title: "Pit Scout Form", routes: ["/pit-scout-form"], access: "restricted", defaultRoles: ["pit-scout"] },
  { id: "team-strategy-form", title: "Team Strategy Form", routes: ["/team-strategy-form"], access: "restricted", defaultRoles: ["lead-strategist"] },
  { id: "match-strategy-form", title: "Match Strategy Form", routes: ["/match-strategy-form"], access: "restricted", defaultRoles: ["lead-strategist"] },
  { id: "drive-reflection-form", title: "Drive Reflection Form", routes: ["/drive-reflection-form"], access: "restricted", defaultRoles: ["drive-team"] },
  { id: "helper-form", title: "Helper Form", routes: ["/helper-form"], access: "restricted", defaultRoles: ["pit-scout", "pit-team"] },
  { id: "scout-status", title: "Scout Status", routes: ["/analytics/scout-status"], access: "restricted", defaultRoles: ["lead-scout", "team-coach"] },
  { id: "scout-accuracy", title: "Scout Accuracy", routes: ["/scout-accuracy"], access: "restricted", defaultRoles: ["lead-scout", "team-coach"] },
  { id: "assignments", title: "Assignments", routes: ["/assignments"], access: "restricted", defaultRoles: ["lead-scout"] },
  { id: "event-selection", title: "Event Selection", routes: ["/event"], access: "restricted", defaultRoles: ["lead-scout", "lead-strategist", "team-coach"] },
  { id: "team-management", title: "Team Management", routes: ["/team-management"], access: "restricted", defaultRoles: ["team-coach"] },

  // --- admin only (not grantable) ----------------------------------------------------------------------------
  // The whole Admin Panel: Forms, Page Access and the other tabs.
  { id: "admin-panel", title: "Admin Panel", routes: ["/admin"], access: "admin", defaultRoles: [] },
];

export const RESTRICTED_PAGES: PageDef[] = PAGES.filter((p) => p.access === "restricted");

const BY_ID = new Map(PAGES.map((p) => [p.id, p]));

export const getPage = (id: string): PageDef | null => BY_ID.get(id) ?? null;

const routeMatches = (route: string, pathname: string) => pathname === route || pathname.startsWith(`${route}/`);

/** The registered page a path belongs to (the longest matching route wins), or null for a path no page owns (the login screens, e2e fixtures, ...): those aren't gated. */
export function pageForPath(pathname: string): PageDef | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: { page: PageDef; len: number } | null = null;
  for (const page of PAGES) {
    for (const route of page.routes) {
      if (routeMatches(route, path) && (!best || route.length > best.len)) best = { page, len: route.length };
    }
  }
  return best?.page ?? null;
}
