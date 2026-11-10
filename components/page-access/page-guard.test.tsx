import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canAccessPage, defaultPageAccessConfig, setMemberPageState, type AccessUser } from "@/lib/page-access/access";

// P26: the route guard. The path and the person are mocked; what is checked is the decision the guard makes for a direct URL
// (the no-access screen, never an error or a blank page) and that open pages and unowned routes are never gated.

let pathname = "/dashboard";
let accessUser: AccessUser | null = null;
let config = defaultPageAccessConfig();
let loaded = true;

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: accessUser ? { uid: accessUser.uid } : null, profile: accessUser ? { teamId: "t1", name: "Test Person" } : null }) }));
vi.mock("@/lib/page-access/store", () => ({
  usePageAccess: () => ({ config, loaded, can: (id: string) => canAccessPage(accessUser, id, config) }),
  usePageAccessRequests: () => ({ requests: [], loaded: true }),
  requestPageAccess: async () => {},
}));

import { PageGuard } from "./page-guard";

const person = (over: Partial<AccessUser> = {}): AccessUser => ({ uid: "u1", isAdmin: false, isOwner: false, primaryRole: "match-scout", secondaryRoles: [], ...over });
const render = (path: string) => {
  pathname = path;
  return renderToString(
    <PageGuard>
      <p>PAGE CONTENT</p>
    </PageGuard>
  );
};

describe("PageGuard", () => {
  beforeEach(() => {
    pathname = "/dashboard";
    accessUser = person();
    config = defaultPageAccessConfig();
    loaded = true;
  });

  it("shows the no-access screen (not the page) at the URL of a restricted page the person can't open", () => {
    for (const path of ["/assignments", "/scout-accuracy", "/team-management", "/event", "/analytics/scout-status", "/lead-scout-form"]) {
      const html = render(path);
      expect(html, path).toContain("have access to");
      expect(html, path).not.toContain("PAGE CONTENT");
      expect(html, path).toContain("Request access");
    }
  });

  it("names the page and offers no request for an admin-only page", () => {
    const html = render("/admin");
    expect(html).toContain("have access to");
    expect(html).toContain("Admin Panel");
    expect(html).toContain("only for admins");
    expect(html).not.toContain("Request access");
  });

  it("renders the page for a role that has it, by primary or secondary role", () => {
    accessUser = person({ primaryRole: "lead-scout" });
    expect(render("/assignments")).toContain("PAGE CONTENT");
    accessUser = person({ secondaryRoles: ["team-coach"] });
    expect(render("/team-management")).toContain("PAGE CONTENT");
  });

  it("an explicit grant opens it, an explicit deny closes it again", () => {
    config = setMemberPageState(config, "u1", "assignments", "grant");
    expect(render("/assignments")).toContain("PAGE CONTENT");
    accessUser = person({ primaryRole: "lead-scout" });
    config = setMemberPageState(defaultPageAccessConfig(), "u1", "assignments", "deny");
    expect(render("/assignments")).not.toContain("PAGE CONTENT");
  });

  it("admins and the owner open everything, the Admin Panel included", () => {
    for (const who of [person({ isAdmin: true }), person({ isOwner: true })]) {
      accessUser = who;
      for (const path of ["/admin", "/assignments", "/team-management", "/analytics/scout-status"]) expect(render(path), path).toContain("PAGE CONTENT");
    }
  });

  it("never gates the open pages, Analytics subpages (except Scout Status), or a route no page owns", () => {
    for (const path of ["/dashboard", "/match-list", "/scout", "/analytics", "/analytics/team-averages", "/practice-scouting", "/my-scouting", "/people", "/people/abc", "/profile", "/changelog", "/credits", "/account", "/team-settings", "/login"]) {
      expect(render(path), path).toContain("PAGE CONTENT");
    }
  });

  it("holds a restricted page back (a skeleton, not the page and not the no-access screen) until the access doc has loaded", () => {
    loaded = false;
    const html = render("/assignments");
    expect(html).not.toContain("PAGE CONTENT");
    expect(html).not.toContain("have access to");
    expect(render("/dashboard")).toContain("PAGE CONTENT"); // open pages never wait
  });
});

describe("PageGuard: the P28 and P29 form pages", () => {
  const FORM_PAGES: [string, string[]][] = [
    ["/lead-scout-form", ["lead-scout"]],
    ["/match-strategy-form", ["lead-strategist"]],
    ["/drive-reflection-form", ["drive-team"]],
    ["/pit-scout-form", ["pit-scout"]],
    ["/team-strategy-form", ["lead-strategist"]],
    ["/helper-form", ["pit-scout", "pit-team"]],
  ];

  beforeEach(() => {
    accessUser = person();
    config = defaultPageAccessConfig();
    loaded = true;
  });

  it("each opens for its default role (primary or secondary) and shows the no-access screen to everyone else", () => {
    for (const [path, roles] of FORM_PAGES) {
      for (const role of ["match-scout", "pit-scout", "pit-team", "drive-team", "lead-scout", "lead-strategist", "team-coach", "media", "judge-awards"] as const) {
        accessUser = person({ primaryRole: role });
        expect(render(path).includes("PAGE CONTENT"), `${role} -> ${path}`).toBe(roles.includes(role));
      }
      accessUser = person({ primaryRole: "match-scout", secondaryRoles: [roles[0] as never] });
      expect(render(path), `secondary ${path}`).toContain("PAGE CONTENT");
    }
  });

  it("an explicit grant opens one, an explicit deny closes it (even for the right role), and admins always open them", () => {
    for (const [path] of FORM_PAGES) {
      const id = path.slice(1);
      accessUser = person({ primaryRole: "media" });
      config = setMemberPageState(defaultPageAccessConfig(), "u1", id, "grant");
      expect(render(path), `grant ${path}`).toContain("PAGE CONTENT");
      accessUser = person({ primaryRole: "lead-scout", secondaryRoles: ["lead-strategist", "drive-team"] });
      config = setMemberPageState(defaultPageAccessConfig(), "u1", id, "deny");
      expect(render(path), `deny ${path}`).not.toContain("PAGE CONTENT");
      accessUser = person({ isAdmin: true });
      expect(render(path), `admin ${path}`).toContain("PAGE CONTENT");
    }
  });
});
