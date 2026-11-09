import { describe, expect, it } from "vitest";
import {
  accessiblePages,
  canAccessPage,
  defaultPageAccessConfig,
  explainAccess,
  grantMemberPage,
  memberPageState,
  pageRolesOf,
  parsePageAccess,
  samePageAccess,
  setMemberPageState,
  setRoleGrant,
  type AccessUser,
} from "./access";
import { PAGES, RESTRICTED_PAGES, pageForPath } from "./pages";
import { visibleNav } from "./nav";
import { mainNav, secondaryNav } from "@/lib/nav";
import { ROLES } from "@/lib/roles";

const user = (over: Partial<AccessUser> = {}): AccessUser => ({ uid: "u1", isAdmin: false, isOwner: false, primaryRole: "match-scout", secondaryRoles: [], ...over });

const OPEN = ["dashboard", "match-scout-form", "analytics", "practice-scouting", "my-scouting", "people", "changelog", "credits", "account-settings", "match-list"];
const DEFAULTS: Record<string, string[]> = {
  "lead-scout-form": ["lead-scout"],
  "pit-scout-form": ["pit-scout"],
  "team-strategy-form": ["lead-strategist"],
  "match-strategy-form": ["lead-strategist"],
  "drive-reflection-form": ["drive-team"],
  "helper-form": ["pit-scout", "pit-team"],
  "scout-status": ["lead-scout", "team-coach"],
  "scout-accuracy": ["lead-scout", "team-coach"],
  assignments: ["lead-scout"],
  "event-selection": ["lead-scout", "lead-strategist", "team-coach"],
  "team-management": ["team-coach"],
};

describe("the PAGES registry", () => {
  it("lists exactly the open pages, the restricted pages with their default roles, and the admin panel", () => {
    expect(PAGES.filter((p) => p.access === "open").map((p) => p.id)).toEqual(OPEN);
    expect(Object.fromEntries(RESTRICTED_PAGES.map((p) => [p.id, p.defaultRoles]))).toEqual(DEFAULTS);
    expect(PAGES.filter((p) => p.access === "admin").map((p) => p.id)).toEqual(["admin-panel"]);
  });

  it("has unique ids and routes, and only real roles as defaults", () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    const routes = PAGES.flatMap((p) => p.routes);
    expect(new Set(routes).size).toBe(routes.length);
    const roles = new Set(ROLES.map((r) => r.id));
    for (const p of PAGES) for (const r of p.defaultRoles) expect(roles.has(r)).toBe(true);
  });

  it("maps a path to its page, the longest route winning (Scout Status is not the open Analytics)", () => {
    expect(pageForPath("/analytics/team-averages")?.id).toBe("analytics");
    expect(pageForPath("/analytics/scout-status")?.id).toBe("scout-status");
    expect(pageForPath("/analytics/scout-status/")?.id).toBe("scout-status");
    expect(pageForPath("/event")?.id).toBe("event-selection");
    expect(pageForPath("/people/abc")?.id).toBe("people");
    expect(pageForPath("/profile")?.id).toBe("people");
    expect(pageForPath("/scout")?.id).toBe("match-scout-form");
    expect(pageForPath("/scout-accuracy")?.id).toBe("scout-accuracy"); // not the open /scout
    expect(pageForPath("/admin")?.id).toBe("admin-panel");
    expect(pageForPath("/login")).toBeNull();
    expect(pageForPath("/e2e/profiles")).toBeNull();
  });
});

describe("canAccessPage", () => {
  const cfg = defaultPageAccessConfig();

  it("an admin or the owner opens everything, including the admin panel", () => {
    for (const u of [user({ isAdmin: true }), user({ isOwner: true })]) for (const p of PAGES) expect(canAccessPage(u, p.id, cfg), p.id).toBe(true);
  });

  it("everyone opens the open pages", () => {
    for (const role of ROLES) for (const id of OPEN) expect(canAccessPage(user({ primaryRole: role.id }), id, cfg), `${role.id} ${id}`).toBe(true);
  });

  it("nobody but an admin opens the admin panel, whatever roles or grants they have", () => {
    const withEverything = setMemberPageState(cfg, "u1", "admin-panel", "grant");
    expect(canAccessPage(user({ primaryRole: "team-coach" }), "admin-panel", withEverything)).toBe(false);
    expect(explainAccess(user(), "admin-panel", cfg).source).toBe("admin-only");
  });

  it("restricted pages follow the default roles, by primary role", () => {
    for (const [pageId, roles] of Object.entries(DEFAULTS)) {
      for (const role of ROLES) expect(canAccessPage(user({ primaryRole: role.id }), pageId, cfg), `${role.id} -> ${pageId}`).toBe(roles.includes(role.id));
    }
  });

  it("a secondary role counts as much as the primary one", () => {
    expect(canAccessPage(user({ primaryRole: "match-scout", secondaryRoles: ["lead-scout"] }), "assignments", cfg)).toBe(true);
    expect(canAccessPage(user({ primaryRole: "match-scout", secondaryRoles: ["pit-team"] }), "helper-form", cfg)).toBe(true);
    expect(canAccessPage(user({ primaryRole: "match-scout", secondaryRoles: ["media"] }), "assignments", cfg)).toBe(false);
  });

  it("an explicit grant opens a page the roles don't", () => {
    const granted = setMemberPageState(cfg, "u1", "assignments", "grant");
    expect(canAccessPage(user(), "assignments", granted)).toBe(true);
    expect(canAccessPage(user({ uid: "someone-else" }), "assignments", granted)).toBe(false);
    expect(explainAccess(user(), "assignments", granted).source).toBe("grant");
  });

  it("an explicit deny closes a page the role (or a grant) would open", () => {
    const denied = setMemberPageState(cfg, "u1", "assignments", "deny");
    const lead = user({ primaryRole: "lead-scout" });
    expect(canAccessPage(lead, "assignments", cfg)).toBe(true);
    expect(canAccessPage(lead, "assignments", denied)).toBe(false);
    expect(explainAccess(lead, "assignments", denied)).toMatchObject({ allowed: false, source: "denied", viaRoles: ["lead-scout"] });
    // a deny never closes the open pages, and never an admin
    expect(canAccessPage(lead, "dashboard", denied)).toBe(true);
    expect(canAccessPage(user({ isAdmin: true, primaryRole: "lead-scout" }), "assignments", denied)).toBe(true);
  });

  it("an admin can change a role's pages: removing and adding", () => {
    const noLead = setRoleGrant(cfg, "lead-scout", "assignments", false);
    expect(canAccessPage(user({ primaryRole: "lead-scout" }), "assignments", noLead)).toBe(false);
    expect(canAccessPage(user({ primaryRole: "lead-scout" }), "scout-status", noLead)).toBe(true);
    const mediaGetsIt = setRoleGrant(cfg, "media", "team-management", true);
    expect(canAccessPage(user({ primaryRole: "media" }), "team-management", mediaGetsIt)).toBe(true);
    expect(canAccessPage(user({ primaryRole: "media" }), "team-management", cfg)).toBe(false);
  });

  it("a missing config means the defaults, and a missing user or unknown page means no", () => {
    expect(canAccessPage(user({ primaryRole: "lead-scout" }), "assignments", null)).toBe(true);
    expect(canAccessPage(user({ primaryRole: "lead-scout" }), "assignments", undefined)).toBe(true);
    expect(canAccessPage(null, "dashboard", cfg)).toBe(false);
    expect(canAccessPage(user(), "no-such-page", cfg)).toBe(false);
  });

  it("lists what a member can open, in registry order", () => {
    const ids = accessiblePages(user({ primaryRole: "pit-scout" }), cfg).map((p) => p.id);
    expect(ids).toEqual([...OPEN, "pit-scout-form", "helper-form"]);
  });
});

describe("editing and parsing", () => {
  it("setRoleGrant only touches restricted pages", () => {
    const cfg = defaultPageAccessConfig();
    expect(setRoleGrant(cfg, "media", "dashboard", false)).toBe(cfg);
    expect(setRoleGrant(cfg, "media", "admin-panel", true)).toBe(cfg);
    expect(setRoleGrant(cfg, "media", "nope", true)).toBe(cfg);
  });

  it("member overrides cycle default / grant / deny and drop out when empty", () => {
    let cfg = defaultPageAccessConfig();
    expect(memberPageState(cfg, "u1", "assignments")).toBe("default");
    cfg = setMemberPageState(cfg, "u1", "assignments", "grant");
    expect(memberPageState(cfg, "u1", "assignments")).toBe("grant");
    cfg = setMemberPageState(cfg, "u1", "assignments", "deny");
    expect(memberPageState(cfg, "u1", "assignments")).toBe("deny");
    expect(cfg.memberOverrides.u1.grant).toEqual([]);
    cfg = setMemberPageState(cfg, "u1", "assignments", "default");
    expect(cfg.memberOverrides).toEqual({});
  });

  it("approving a request grants the page and lifts a deny", () => {
    const denied = setMemberPageState(defaultPageAccessConfig(), "u1", "assignments", "deny");
    const approved = grantMemberPage(denied, "u1", "assignments");
    expect(memberPageState(approved, "u1", "assignments")).toBe("grant");
  });

  it("a missing doc is the defaults; a missing role gets its default grants; unknown pages are dropped", () => {
    expect(parsePageAccess(undefined)).toEqual(defaultPageAccessConfig());
    const parsed = parsePageAccess({ roleGrants: { "lead-scout": ["assignments", "ghost-page", "dashboard"] }, memberOverrides: { u9: { grant: ["helper-form", "nope"], deny: [] }, u8: { grant: [], deny: [] } } });
    expect(parsed.roleGrants["lead-scout"]).toEqual(["assignments"]);
    expect(parsed.roleGrants["team-coach"]).toEqual(["scout-status", "scout-accuracy", "event-selection", "team-management"]); // not in the doc: the defaults
    expect(parsed.memberOverrides).toEqual({ u9: { grant: ["helper-form"], deny: [] } });
  });

  it("an explicitly empty role stays empty (it is not refilled with defaults)", () => {
    const parsed = parsePageAccess({ roleGrants: { "lead-scout": [] } });
    expect(parsed.roleGrants["lead-scout"]).toEqual([]);
  });

  it("builds the rules-friendly pageRoles mirror, complete for every restricted page", () => {
    const mirror = pageRolesOf(defaultPageAccessConfig());
    expect(Object.keys(mirror).sort()).toEqual(RESTRICTED_PAGES.map((p) => p.id).sort());
    expect(mirror["helper-form"]).toEqual(["pit-scout", "pit-team"]);
    expect(mirror["team-management"]).toEqual(["team-coach"]);
    expect(pageRolesOf(setRoleGrant(defaultPageAccessConfig(), "media", "assignments", true)).assignments).toEqual(["media", "lead-scout"].sort((a, b) => ROLES.findIndex((r) => r.id === a) - ROLES.findIndex((r) => r.id === b)));
  });

  it("compares configs by content", () => {
    const a = defaultPageAccessConfig();
    expect(samePageAccess(a, parsePageAccess(JSON.parse(JSON.stringify(a))))).toBe(true);
    expect(samePageAccess(a, setRoleGrant(a, "media", "assignments", true))).toBe(false);
  });
});

describe("navigation hiding", () => {
  const cfg = defaultPageAccessConfig();
  const labels = (u: AccessUser) => visibleNav([...mainNav, ...secondaryNav], (id) => canAccessPage(u, id, cfg)).map((i) => i.label);

  it("a plain Match Scout loses the restricted pages and the Admin Panel, and keeps the open ones", () => {
    const l = labels(user());
    for (const hidden of ["Active Events", "Assignments", "Scout Accuracy", "Team Management", "Admin Panel", "Lead Scout Form", "Match Strategy Form", "Drive Reflection Form"]) expect(l, hidden).not.toContain(hidden);
    for (const shown of ["Dashboard", "Match List", "Match Scout Form", "Analytics", "Practice Scouting", "My Scouting", "People", "Changelog", "Credits", "Account Settings", "Team Settings"]) expect(l, shown).toContain(shown);
  });

  it("each default role gets exactly its pages", () => {
    expect(labels(user({ primaryRole: "lead-scout" }))).toEqual(expect.arrayContaining(["Active Events", "Assignments", "Scout Accuracy"]));
    expect(labels(user({ primaryRole: "lead-scout" }))).not.toContain("Team Management");
    expect(labels(user({ primaryRole: "team-coach" }))).toEqual(expect.arrayContaining(["Active Events", "Scout Accuracy", "Team Management"]));
    expect(labels(user({ primaryRole: "team-coach" }))).not.toContain("Assignments");
    expect(labels(user({ primaryRole: "lead-strategist" }))).toContain("Active Events");
    expect(labels(user({ primaryRole: "lead-strategist" }))).not.toContain("Scout Accuracy");
  });

  it("an admin sees everything, an explicit deny hides a page, a grant shows one", () => {
    const admin = labels(user({ isAdmin: true }));
    for (const item of [...mainNav, ...secondaryNav]) expect(admin).toContain(item.label);
    const denied = setMemberPageState(cfg, "u1", "assignments", "deny");
    expect(visibleNav(mainNav, (id) => canAccessPage(user({ primaryRole: "lead-scout" }), id, denied)).map((i) => i.label)).not.toContain("Assignments");
    const granted = setMemberPageState(cfg, "u1", "team-management", "grant");
    expect(visibleNav(mainNav, (id) => canAccessPage(user(), id, granted)).map((i) => i.label)).toContain("Team Management");
  });

  it("hides nothing without a signed-in person (the browser-test fixture)", () => {
    expect(visibleNav(mainNav, null)).toHaveLength(mainNav.length);
  });
});
