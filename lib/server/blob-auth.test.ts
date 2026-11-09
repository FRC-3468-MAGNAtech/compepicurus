import { describe, expect, it } from "vitest";
import { buildBlobPath, MAX_IMAGE_BYTES } from "@/lib/blob/paths";
import { setMemberPageState, setRoleGrant, defaultPageAccessConfig, type PageAccessConfig } from "@/lib/page-access/access";
import {
  authorizeBlobDelete,
  authorizeBlobUpload,
  blobPathnameFromUrl,
  pageIdForForm,
  parseClientPayload,
  type BlobAuthDeps,
  type BlobUserDoc,
} from "@/lib/server/blob-auth";

const TEAM = "team1";
const RANDOM = "0123456789abcdef0123456789abcdef";
const loc = { kind: "pit", teamId: TEAM, eventCode: "USCAABC", teamNumber: "12345" };

function makeDeps(users: Record<string, BlobUserDoc>, config: PageAccessConfig | null = null): BlobAuthDeps {
  return { getUser: async (uid) => users[uid] ?? null, getPageAccessConfig: async () => config };
}
const member = (over: BlobUserDoc = {}): BlobUserDoc => ({ teamId: TEAM, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, ...over });
const payload = (over: Record<string, unknown> = {}) => JSON.stringify({ formId: "custom-form-1", ...loc, ...over });
const pathFor = (uid: string, over: Partial<typeof loc> = {}) => buildBlobPath({ ...loc, ...over, uid, random: RANDOM });

describe("pageIdForForm", () => {
  it("maps the built-in forms and sends everything else to the open Match Scout page", () => {
    expect(pageIdForForm("lead-scout-v1")).toBe("lead-scout-form");
    expect(pageIdForForm("pit-scout-v1")).toBe("pit-scout-form");
    expect(pageIdForForm("team-strategy-v1")).toBe("team-strategy-form");
    expect(pageIdForForm("match-strategy-v1")).toBe("match-strategy-form");
    expect(pageIdForForm("drive-reflection-v1")).toBe("drive-reflection-form");
    expect(pageIdForForm("helper-v1")).toBe("helper-form");
    expect(pageIdForForm("my-custom-form")).toBe("match-scout-form");
    expect(pageIdForForm("constructor")).toBe("match-scout-form");
  });
});

describe("parseClientPayload", () => {
  it("accepts the shape our client sends, with a numeric team number too", () => {
    expect(parseClientPayload(payload())).toEqual({ formId: "custom-form-1", ...loc });
    expect(parseClientPayload(payload({ teamNumber: 12345 }))?.teamNumber).toBe("12345");
  });
  it("rejects junk", () => {
    for (const raw of [null, undefined, "", "{", "[]", "null", "5", payload({ formId: "" }), payload({ teamId: 3 }), "x".repeat(2000)]) {
      expect(parseClientPayload(raw as string)).toBeNull();
    }
  });
});

// A missing or invalid ID token never reaches authorizeBlobUpload: the route answers 401 'not-signed-in' first.
describe("authorizeBlobUpload", () => {
  const run = async (uid: string, users: Record<string, BlobUserDoc>, over: { pathname?: string; clientPayload?: string | null; config?: PageAccessConfig | null; contentType?: string; size?: number } = {}) =>
    authorizeBlobUpload({
      uid,
      pathname: over.pathname ?? (await pathFor(uid)),
      clientPayload: over.clientPayload === undefined ? payload() : over.clientPayload,
      contentType: over.contentType,
      size: over.size,
      deps: makeDeps(users, over.config ?? null),
    });

  it("accepts any team member on a custom form and returns the token constraints", async () => {
    const r = await run("u1", { u1: member() });
    expect(r).toMatchObject({ ok: true, maximumSizeInBytes: MAX_IMAGE_BYTES, addRandomSuffix: false, allowOverwrite: false });
    if (!r.ok) throw new Error("unreachable");
    expect(r.allowedContentTypes).toEqual(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
    expect(JSON.parse(r.tokenPayload)).toMatchObject({ uid: "u1", formId: "custom-form-1", teamId: TEAM });
  });

  it("rejects an unknown user", async () => {
    expect(await run("ghost", {})).toMatchObject({ ok: false, status: 403, code: "unknown-user" });
  });

  it("rejects a user with no team", async () => {
    expect(await run("u1", { u1: member({ teamId: undefined }) })).toMatchObject({ ok: false, code: "wrong-team" });
  });

  it("rejects another team's teamId (path and payload agree, but the user isn't on that team)", async () => {
    const r = await run("u1", { u1: member({ teamId: "other" }) });
    expect(r).toMatchObject({ ok: false, status: 403, code: "wrong-team" });
  });

  it("rejects a payload the server can't read, and a bad path", async () => {
    expect(await run("u1", { u1: member() }, { clientPayload: null })).toMatchObject({ ok: false, status: 400, code: "bad-payload" });
    expect(await run("u1", { u1: member() }, { pathname: "../../x.jpg" })).toMatchObject({ ok: false, status: 400, code: "bad-path" });
  });

  it("rejects a path that disagrees with the payload", async () => {
    const users = { u1: member() };
    for (const over of [{ eventCode: "USCAXYZ" }, { teamNumber: "999" }, { kind: "lead" }]) {
      expect(await run("u1", users, { clientPayload: payload(over) }), JSON.stringify(over)).toMatchObject({ ok: false, code: "path-mismatch" });
    }
    // Same user, path built for a different team folder than the payload (and than their own team).
    expect(await run("u1", users, { pathname: await pathFor("u1", { teamId: "other" }) })).toMatchObject({ ok: false, code: "path-mismatch" });
  });

  it("rejects someone else's uidTag", async () => {
    const users = { u1: member(), u2: member() };
    expect(await run("u1", users, { pathname: await pathFor("u2") })).toMatchObject({ ok: false, status: 403, code: "not-your-path" });
  });

  describe("page access for the form's page", () => {
    const pit = { clientPayload: payload({ formId: "pit-scout-v1" }) };

    it("denies a plain match scout on the pit scout form", async () => {
      expect(await run("u1", { u1: member() }, pit)).toMatchObject({ ok: false, status: 403, code: "no-page-access" });
    });
    it("allows a pit scout, as a primary or a secondary role", async () => {
      expect(await run("u1", { u1: member({ primaryRole: "pit-scout" }) }, pit)).toMatchObject({ ok: true });
      expect(await run("u1", { u1: member({ secondaryRoles: ["pit-scout"] }) }, pit)).toMatchObject({ ok: true });
    });
    it("allows after an explicit member grant", async () => {
      const config = setMemberPageState(defaultPageAccessConfig(), "u1", "pit-scout-form", "grant");
      expect(await run("u1", { u1: member() }, { ...pit, config })).toMatchObject({ ok: true });
    });
    it("allows after a role grant in the config", async () => {
      const config = setRoleGrant(defaultPageAccessConfig(), "match-scout", "pit-scout-form", true);
      expect(await run("u1", { u1: member() }, { ...pit, config })).toMatchObject({ ok: true });
    });
    it("denies an explicit deny even for the page's own role", async () => {
      const config = setMemberPageState(defaultPageAccessConfig(), "u1", "pit-scout-form", "deny");
      expect(await run("u1", { u1: member({ primaryRole: "pit-scout" }) }, { ...pit, config })).toMatchObject({ ok: false, code: "no-page-access" });
    });
    it("always allows an admin or the team owner", async () => {
      expect(await run("u1", { u1: member({ isAdmin: true }) }, pit)).toMatchObject({ ok: true });
      expect(await run("u1", { u1: member({ isOwner: true }) }, pit)).toMatchObject({ ok: true });
    });
    it("treats an unknown stored role as the default role instead of crashing", async () => {
      expect(await run("u1", { u1: member({ primaryRole: "wizard", secondaryRoles: ["pit-scout", 7] }) }, pit)).toMatchObject({ ok: true });
    });
  });

  it("rejects a wrong content type or an oversize file when the caller knows them", async () => {
    const users = { u1: member() };
    expect(await run("u1", users, { contentType: "image/svg+xml" })).toMatchObject({ ok: false, status: 415, code: "bad-type" });
    expect(await run("u1", users, { contentType: "image/jpeg", size: MAX_IMAGE_BYTES + 1 })).toMatchObject({ ok: false, status: 413, code: "too-large" });
    expect(await run("u1", users, { contentType: "image/jpeg", size: 1000 })).toMatchObject({ ok: true });
  });
});

describe("blobPathnameFromUrl", () => {
  it("extracts the pathname from a store URL", () => {
    expect(blobPathnameFromUrl("https://abc123.public.blob.vercel-storage.com/pit/t/E/1/aaaaaaaaaa-" + RANDOM + ".jpg")).toBe(`pit/t/E/1/aaaaaaaaaa-${RANDOM}.jpg`);
  });
  it("refuses other hosts, schemes, queries and garbage", () => {
    for (const url of ["https://evil.com/pit/x.jpg", "http://abc.public.blob.vercel-storage.com/x.jpg", "https://abc.public.blob.vercel-storage.com/x.jpg?token=1", "https://blob.vercel-storage.com.evil.com/x.jpg", "nope", ""]) {
      expect(blobPathnameFromUrl(url), url).toBeNull();
    }
  });
});

describe("authorizeBlobDelete", () => {
  const urlFor = async (uid: string, over: Partial<typeof loc> = {}) => `https://store1.public.blob.vercel-storage.com/${await pathFor(uid, over)}`;
  const run = async (uid: string, url: string, users: Record<string, BlobUserDoc>) => authorizeBlobDelete({ uid, url, deps: { getUser: async (u) => users[u] ?? null } });

  it("allows deleting your own file", async () => {
    expect(await run("u1", await urlFor("u1"), { u1: member() })).toMatchObject({ ok: true });
  });
  it("refuses someone else's file", async () => {
    expect(await run("u1", await urlFor("u2"), { u1: member(), u2: member() })).toMatchObject({ ok: false, status: 403, code: "not-yours" });
  });
  it("lets an admin or the owner delete a teammate's file", async () => {
    expect(await run("a", await urlFor("u2"), { a: member({ isAdmin: true }) })).toMatchObject({ ok: true });
    expect(await run("a", await urlFor("u2"), { a: member({ isOwner: true }) })).toMatchObject({ ok: true });
  });
  it("refuses another team's file, even for an admin", async () => {
    expect(await run("a", await urlFor("u2", { teamId: "other" }), { a: member({ isAdmin: true }) })).toMatchObject({ ok: false, code: "wrong-team" });
    expect(await run("u1", await urlFor("u1", { teamId: "other" }), { u1: member() })).toMatchObject({ ok: false, code: "wrong-team" });
  });
  it("refuses a user with no doc or no team", async () => {
    expect(await run("ghost", await urlFor("u1"), {})).toMatchObject({ ok: false, code: "unknown-user" });
    expect(await run("u1", await urlFor("u1"), { u1: member({ teamId: "" }) })).toMatchObject({ ok: false, code: "wrong-team" });
  });
  it("refuses a non-blob URL and an unparseable path", async () => {
    const users = { u1: member({ isAdmin: true }) };
    expect(await run("u1", "https://evil.com/x.jpg", users)).toMatchObject({ ok: false, status: 400, code: "bad-url" });
    expect(await run("u1", "https://store1.public.blob.vercel-storage.com/random/file.jpg", users)).toMatchObject({ ok: false, status: 400, code: "bad-path" });
    expect(await run("u1", "garbage", users)).toMatchObject({ ok: false, code: "bad-url" });
  });
});
