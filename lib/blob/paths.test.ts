import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  BlobPathError,
  MAX_IMAGE_BYTES,
  buildBlobPath,
  isAllowedImageType,
  parseBlobPath,
  randomHex,
  sanitizeSegment,
  uidTagOf,
  validateUploadRequest,
} from "@/lib/blob/paths";

const RANDOM = "0123456789abcdef0123456789abcdef";
const base = { kind: "pit", teamId: "teamABC123", eventCode: "USCAABC", teamNumber: "12345", uid: "user-1", random: RANDOM };

describe("sanitizeSegment", () => {
  it("keeps only letters, digits, underscore and hyphen", () => {
    expect(sanitizeSegment("a b/c.d?e&f%20g", 50)).toBe("abcdef20g");
    expect(sanitizeSegment("Tëam_1-2", 50)).toBe("Tam_1-2");
  });
  it("never lets dots or slashes through", () => {
    expect(sanitizeSegment("../../etc/passwd", 50)).toBe("etcpasswd");
    expect(sanitizeSegment("..", 50)).toBe("");
    expect(sanitizeSegment("a\\b", 50)).toBe("ab");
  });
  it("caps the length and tolerates non-strings", () => {
    expect(sanitizeSegment("x".repeat(100), 8)).toBe("xxxxxxxx");
    expect(sanitizeSegment(undefined, 8)).toBe("");
    expect(sanitizeSegment(12345, 8)).toBe("12345");
  });
});

describe("uidTagOf", () => {
  it("is 10 hex chars, stable, and differs per uid", async () => {
    const a = await uidTagOf("user-1");
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(await uidTagOf("user-1")).toBe(a);
    expect(await uidTagOf("user-2")).not.toBe(a);
  });
  it("matches a known SHA-256 prefix", async () => {
    // sha256("abc") = ba7816bf8f01cfea...
    expect(await uidTagOf("abc")).toBe("ba7816bf8f");
  });
});

describe("buildBlobPath", () => {
  it("builds kind/teamId/eventCode/teamNumber/uidTag-random.jpg", async () => {
    const path = await buildBlobPath(base);
    expect(path).toBe(`pit/teamABC123/USCAABC/12345/${await uidTagOf("user-1")}-${RANDOM}.jpg`);
  });
  it("accepts a numeric team number", async () => {
    expect(await buildBlobPath({ ...base, teamNumber: 12345 })).toContain("/12345/");
  });
  it("sanitizes every segment and survives traversal attempts", async () => {
    const path = await buildBlobPath({ ...base, kind: "../pit", teamId: "a/../b", eventCode: "US CA", teamNumber: "1.2.3" });
    expect(path.split("/")).toHaveLength(5);
    expect(path).not.toContain("..");
    expect(parseBlobPath(path)).not.toBeNull();
  });
  it("refuses a segment that sanitizes to nothing", async () => {
    await expect(buildBlobPath({ ...base, kind: ".." })).rejects.toBeInstanceOf(BlobPathError);
    await expect(buildBlobPath({ ...base, teamId: "///" })).rejects.toBeInstanceOf(BlobPathError);
    await expect(buildBlobPath({ ...base, uid: "" })).rejects.toBeInstanceOf(BlobPathError);
  });
  it("refuses an invalid injected random", async () => {
    await expect(buildBlobPath({ ...base, random: "short" })).rejects.toBeInstanceOf(BlobPathError);
    await expect(buildBlobPath({ ...base, random: "../" + "a".repeat(20) })).rejects.toBeInstanceOf(BlobPathError);
  });
  it("is random and unique per call by default", async () => {
    const { random: _unused, ...noRandom } = base;
    void _unused;
    const paths = await Promise.all(Array.from({ length: 50 }, () => buildBlobPath(noRandom)));
    expect(new Set(paths).size).toBe(50);
    for (const p of paths) expect(parseBlobPath(p)).not.toBeNull();
  });
  it("randomHex is at least 16 hex chars", () => {
    expect(randomHex()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("parseBlobPath", () => {
  it("round-trips", async () => {
    const path = await buildBlobPath(base);
    expect(parseBlobPath(path)).toEqual({
      kind: "pit",
      teamId: "teamABC123",
      eventCode: "USCAABC",
      teamNumber: "12345",
      uidTag: await uidTagOf("user-1"),
      file: `${await uidTagOf("user-1")}-${RANDOM}.jpg`,
    });
  });
  it("rejects anything that isn't exactly our shape", async () => {
    const good = await buildBlobPath(base);
    const bad = [
      "",
      "../" + good,
      good.replace("pit/", "pit/../"),
      "/" + good,
      good + "/",
      good.replace(".jpg", ".png"),
      good.replace(".jpg", ".jpg.exe"),
      good.replace("pit/", "pit//"),
      good.replace(/[0-9a-f]{10}-/, "ZZZZZZZZZZ-"),
      good.replace(RANDOM, "abc"),
      good.replace(RANDOM, RANDOM.toUpperCase()),
      "a/b/c/d/e.jpg",
      good.replace("pit", "p it"),
      good.replace("pit", "pit.x"),
    ];
    for (const p of bad) expect(parseBlobPath(p), p).toBeNull();
  });
  it("rejects a non-string", () => {
    expect(parseBlobPath(undefined as unknown as string)).toBeNull();
  });
});

describe("validateUploadRequest", () => {
  it("accepts a good path, type and size", async () => {
    const pathname = await buildBlobPath(base);
    for (const contentType of ALLOWED_IMAGE_TYPES) expect(validateUploadRequest({ pathname, contentType, size: 1000 })).toEqual({ ok: true });
    expect(validateUploadRequest({ pathname, contentType: "image/jpeg" })).toEqual({ ok: true });
    expect(validateUploadRequest({ pathname, contentType: "IMAGE/JPEG; charset=binary", size: MAX_IMAGE_BYTES })).toEqual({ ok: true });
  });
  it("rejects a bad path", () => {
    expect(validateUploadRequest({ pathname: "../x.jpg", contentType: "image/jpeg" })).toMatchObject({ ok: false, code: "bad-path" });
  });
  it("rejects the wrong type", async () => {
    const pathname = await buildBlobPath(base);
    for (const contentType of ["image/svg+xml", "text/html", "application/pdf", "", "image/gif"]) {
      expect(validateUploadRequest({ pathname, contentType }), contentType).toMatchObject({ ok: false, code: "bad-type" });
    }
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
  });
  it("rejects an oversize or nonsense size", async () => {
    const pathname = await buildBlobPath(base);
    expect(validateUploadRequest({ pathname, contentType: "image/jpeg", size: MAX_IMAGE_BYTES + 1 })).toMatchObject({ ok: false, code: "too-large" });
    expect(validateUploadRequest({ pathname, contentType: "image/jpeg", size: NaN })).toMatchObject({ ok: false, code: "too-large" });
    expect(validateUploadRequest({ pathname, contentType: "image/jpeg", size: -1 })).toMatchObject({ ok: false, code: "too-large" });
  });
});
