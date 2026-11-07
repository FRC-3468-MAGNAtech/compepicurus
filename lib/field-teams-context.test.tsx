import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldTeamsContext, buildFieldTeamsValue, useActiveFieldTeam, useFieldTeams, useIsOurTeam } from "./field-teams-context";
import type { FieldTeam } from "./field-teams";

const A: FieldTeam = { id: "ft-35792", number: 35792, name: "Alpha" };
const B: FieldTeam = { id: "fteam_b", number: 35794, name: "Beta" };

type Input = Parameters<typeof buildFieldTeamsValue>[0];
const build = (over: Partial<Input> = {}) => buildFieldTeamsValue({ loaded: true, team: { fieldTeams: [A, B], accountName: " Our Org " }, ...over });

// A probe that prints what the three hooks return, rendered under the real context (no Firebase involved).
function Probe() {
  const { fieldTeams, assignedFieldTeams, accountName } = useFieldTeams();
  const { activeFieldTeam, canSwitch, loaded } = useActiveFieldTeam();
  const isOurs = useIsOurTeam();
  return (
    <p>
      {JSON.stringify({
        all: fieldTeams.map((t) => t.number),
        assigned: assignedFieldTeams.map((t) => t.number),
        active: activeFieldTeam?.number ?? null,
        canSwitch,
        loaded,
        accountName,
        ours: [35792, 35794, 254].map((n) => isOurs(n)),
      })}
    </p>
  );
}

function probe(value: ReturnType<typeof build> | null) {
  const html = renderToStaticMarkup(
    value ? (
      <FieldTeamsContext.Provider value={value}>
        <Probe />
      </FieldTeamsContext.Provider>
    ) : (
      <Probe />
    )
  );
  return JSON.parse(html.replace(/^<p>|<\/p>$/g, "").replace(/&quot;/g, '"'));
}

describe("field team hooks", () => {
  it("defaults the active team to the user's first assigned team", () => {
    expect(probe(build()).active).toBe(35792);
    expect(probe(build({ userFieldTeamIds: ["fteam_b"] })).active).toBe(35794);
  });

  it("uses the persisted choice (users/{uid}.activeFieldTeamId) while assigned to it", () => {
    const r = probe(build({ savedActiveId: "fteam_b", userFieldTeamIds: ["ft-35792", "fteam_b"] }));
    expect(r.active).toBe(35794);
    expect(r.canSwitch).toBe(true);
  });

  it("falls back to another assigned team when the one being viewed is removed", () => {
    const before = build({ savedActiveId: "fteam_b", userFieldTeamIds: ["ft-35792", "fteam_b"] });
    expect(probe(before).active).toBe(35794);
    // an admin removes FTC 35794 from the account (the user's saved id and assignment still mention it)
    const after = buildFieldTeamsValue({
      loaded: true,
      team: { fieldTeams: [A] },
      savedActiveId: "fteam_b",
      userFieldTeamIds: ["ft-35792", "fteam_b"],
    });
    const r = probe(after);
    expect(r.active).toBe(35792);
    expect(r.canSwitch).toBe(false);
  });

  it("offers a switcher only when assigned to more than one team", () => {
    expect(probe(build({ userFieldTeamIds: ["ft-35792"] })).canSwitch).toBe(false);
    expect(probe(build({ userFieldTeamIds: [] })).canSwitch).toBe(true); // none recorded = all teams
  });

  it("isOurTeam is true for every FTC team on the account, however it is assigned", () => {
    expect(probe(build({ userFieldTeamIds: ["ft-35792"] })).ours).toEqual([true, true, false]);
  });

  it("reads the legacy single number until the migration has run", () => {
    const r = probe(buildFieldTeamsValue({ loaded: true, team: { number: 3468, name: "Old" } }));
    expect(r.all).toEqual([3468]);
    expect(r.active).toBe(3468);
  });

  it("trims the account name, and returns an empty value outside the provider", () => {
    expect(probe(build()).accountName).toBe("Our Org");
    const empty = probe(null);
    expect(empty).toMatchObject({ all: [], assigned: [], active: null, canSwitch: false, ours: [false, false, false] });
  });
});
