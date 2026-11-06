import { describe, expect, it } from "vitest";
import { describeFirestoreError, failureDetails, failureExplanation } from "./firestore-errors";

const AT = new Date("2026-11-06T12:00:00.000Z");

describe("describeFirestoreError", () => {
  it("reads a Firestore permission error and keeps its message verbatim", () => {
    const f = describeFirestoreError("Couldn't load matches", { code: "permission-denied", message: "Missing or insufficient permissions." }, 'libraryMatches where seasonId == "biobuzz", published == true', AT);
    expect(f).toEqual({
      context: "Couldn't load matches",
      code: "permission-denied",
      message: "Missing or insufficient permissions.",
      path: 'libraryMatches where seasonId == "biobuzz", published == true',
      at: "2026-11-06T12:00:00.000Z",
    });
  });

  it("strips the firestore/ prefix from a code", () => {
    expect(describeFirestoreError("x", { code: "firestore/unavailable", message: "m" }, null, AT).code).toBe("unavailable");
  });

  it("copes with anything thrown: an Error, a string, undefined", () => {
    expect(describeFirestoreError("x", new Error("boom"), null, AT)).toMatchObject({ code: "unknown", message: "boom" });
    expect(describeFirestoreError("x", "plain text", null, AT).message).toBe("plain text");
    expect(describeFirestoreError("x", undefined, null, AT)).toMatchObject({ code: "unknown", message: "Unknown error" });
  });
});

describe("what the user is told", () => {
  it("explains a permission error as a rules/account problem for an admin, not as the user's fault", () => {
    expect(failureExplanation({ code: "permission-denied" })).toMatch(/rules/i);
  });

  it("tells a connection problem to try again, and a missing index to ask an admin", () => {
    expect(failureExplanation({ code: "unavailable" })).toMatch(/connection/i);
    expect(failureExplanation({ code: "failed-precondition" })).toMatch(/index/i);
  });

  it("has a sensible default", () => {
    expect(failureExplanation({ code: "something-new" })).toMatch(/try again/i);
  });

  it("Copy details includes everything an admin needs to find the failing query", () => {
    const text = failureDetails(describeFirestoreError("Couldn't load matches", { code: "permission-denied", message: "Missing or insufficient permissions." }, "libraryMatches where published == true", AT));
    expect(text).toContain("Couldn't load matches");
    expect(text).toContain("code: permission-denied");
    expect(text).toContain("message: Missing or insufficient permissions.");
    expect(text).toContain("path: libraryMatches where published == true");
    expect(text).toContain("at: 2026-11-06T12:00:00.000Z");
  });

  it("leaves out the path line when it isn't known", () => {
    expect(failureDetails(describeFirestoreError("x", new Error("m"), null, AT))).not.toContain("path:");
  });
});
