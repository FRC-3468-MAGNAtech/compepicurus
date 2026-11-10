import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/roles";
import { dashboardRegistry } from "./registry";

// Structural guarantees for the dashboard registry (P13).
describe("dashboardRegistry", () => {
  it("has widgets for every role in the roles config", () => {
    expect(Object.keys(dashboardRegistry).sort()).toEqual(ROLES.map((r) => r.id).sort());
    for (const role of ROLES) expect(dashboardRegistry[role.id].length).toBeGreaterThan(0);
  });

  it("gives every widget a unique id within its role, a title, a valid size, and a render function", () => {
    for (const [role, widgets] of Object.entries(dashboardRegistry)) {
      const ids = widgets.map((w) => w.id);
      expect(new Set(ids).size, `duplicate widget id in ${role}`).toBe(ids.length);
      for (const w of widgets) {
        expect(w.title.trim()).not.toBe("");
        expect(["small", "medium", "wide"]).toContain(w.size);
        expect(typeof w.render).toBe("function");
      }
    }
  });

  it("renders each widget to an element without needing any data (it is the widget that reads the context)", () => {
    for (const widgets of Object.values(dashboardRegistry)) {
      for (const w of widgets) expect(w.render()).toBeTruthy();
    }
  });

  it("gives the roles whose feature doesn't exist exactly one 'Coming soon' card, and every other role none", () => {
    const soon = (role: string) => dashboardRegistry[role as keyof typeof dashboardRegistry].filter((w) => w.id.endsWith("-soon")).length;
    expect(soon("pit-scout")).toBe(0); // P29: the pit forms exist now
    expect(soon("judge-awards")).toBe(1);
    expect(soon("media")).toBe(1);
    for (const role of ["match-scout", "pit-scout", "pit-team", "drive-team", "lead-scout", "lead-strategist", "team-coach"]) expect(soon(role), role).toBe(0);
  });

  it("every role has at most one Coming-soon card", () => {
    for (const widgets of Object.values(dashboardRegistry)) {
      expect(widgets.filter((w) => w.id.endsWith("-soon")).length).toBeLessThanOrEqual(1);
    }
  });
});
