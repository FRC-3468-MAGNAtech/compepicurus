import { describe, expect, it } from "vitest";
import { embedUrlFor, parseStreamUrl } from "./stream";

describe("parseStreamUrl", () => {
  it("parses a standard YouTube watch URL", () => {
    expect(parseStreamUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      platform: "youtube",
      id: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("parses a youtu.be short link", () => {
    expect(parseStreamUrl("https://youtu.be/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
  });

  it("parses a /live/ YouTube URL", () => {
    expect(parseStreamUrl("https://www.youtube.com/live/dQw4w9WgXcQ")?.platform).toBe("youtube");
  });

  it("parses a Twitch channel URL", () => {
    expect(parseStreamUrl("https://www.twitch.tv/firstinspires")).toEqual({
      platform: "twitch",
      id: "firstinspires",
      url: "https://www.twitch.tv/firstinspires",
    });
  });

  it("returns null for an unrecognized link", () => {
    expect(parseStreamUrl("https://example.com/stream")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseStreamUrl("  https://youtu.be/dQw4w9WgXcQ  ")?.id).toBe("dQw4w9WgXcQ");
  });
});

describe("embedUrlFor", () => {
  it("builds a YouTube embed URL", () => {
    const url = embedUrlFor({ platform: "youtube", id: "abc12345678", url: "" });
    expect(url).toContain("youtube.com/embed/abc12345678");
  });

  it("builds a Twitch embed URL with the given parent domain", () => {
    const url = embedUrlFor({ platform: "twitch", id: "firstinspires", url: "" }, "compepicurus.app");
    expect(url).toContain("channel=firstinspires");
    expect(url).toContain("parent=compepicurus.app");
  });
});
