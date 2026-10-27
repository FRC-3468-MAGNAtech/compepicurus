import { describe, expect, it } from "vitest";
import type { FtcEvent } from "@/lib/ftc/types";
import { matchEventFromText } from "./matching";

function event(overrides: Partial<FtcEvent> & { code: string; name: string }): FtcEvent {
  return {
    season: 2026,
    dateStart: "2026-01-01",
    dateEnd: "2026-01-01",
    city: null,
    stateProv: null,
    country: null,
    venue: null,
    website: null,
    timezone: null,
    status: "in-progress",
    ...overrides,
  };
}

const EVENTS = [
  event({ code: "USWABON1", name: "Rookie Rumble" }),
  event({ code: "USCAFOO1", name: "Foothill Qualifier" }),
];

describe("matchEventFromText", () => {
  it("is confident when the event code literally appears in the text", () => {
    const result = matchEventFromText("Live from USWABON1 today!", EVENTS);
    expect(result?.event.code).toBe("USWABON1");
    expect(result?.confident).toBe(true);
  });

  it("is confident on a strong name-word overlap", () => {
    const result = matchEventFromText("FTC Rookie Rumble LIVE STREAM", EVENTS);
    expect(result?.event.code).toBe("USWABON1");
    expect(result?.confident).toBe(true);
  });

  it("is not confident on a weak overlap", () => {
    const result = matchEventFromText("Some Rumble in the jungle", EVENTS);
    expect(result?.confident).toBe(false);
  });

  it("returns null when nothing matches at all", () => {
    expect(matchEventFromText("completely unrelated text", EVENTS)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchEventFromText("", EVENTS)).toBeNull();
    expect(matchEventFromText("Rookie Rumble", [])).toBeNull();
  });
});
