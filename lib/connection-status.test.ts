import { describe, expect, it } from "vitest";
import { connectionNotice, connectionStatus } from "./connection-notice";

describe("connection status chip (P18)", () => {
  it("is always something: online when nothing is wrong", () => {
    const s = connectionStatus(connectionNotice(true, 0));
    expect(s.tone).toBe("online");
    expect(s.label).toBe("Online");
  });

  it("offline with nothing waiting, and with submissions waiting", () => {
    expect(connectionStatus(connectionNotice(false, 0))).toMatchObject({ tone: "offline", label: "Offline" });
    const waiting = connectionStatus(connectionNotice(false, 3));
    expect(waiting).toMatchObject({ tone: "offline", label: "Offline · 3" });
    expect(waiting.detail).toContain("3 submissions");
  });

  it("syncing shows the pending count", () => {
    expect(connectionStatus(connectionNotice(true, 2))).toMatchObject({ tone: "syncing", label: "Syncing 2" });
    expect(connectionStatus(connectionNotice(true, 1)).detail).toContain("1 submission ");
  });

  it("never reports a negative or fractional count", () => {
    expect(connectionStatus(connectionNotice(true, -4)).tone).toBe("online");
    expect(connectionStatus(connectionNotice(true, 2.9)).label).toBe("Syncing 2");
  });
});
