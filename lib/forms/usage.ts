// P22: how many scout entries use each form (and version): the Forms list's "entries" column, the archive-vs-delete rule, and the
// "this change affects N existing entries" warning on publish. Pure: the panel feeds it the team's entries.

export type FormUsage = {
  total: number;
  /** Entries per recorded `formVersion`. */
  byVersion: ReadonlyMap<number, number>;
  /** Entries saved before versions were recorded (they count in `total` too). */
  unversioned: number;
};

export function usageByForm(entries: readonly { formId: string; formVersion?: number }[]): Map<string, FormUsage> {
  const out = new Map<string, { total: number; byVersion: Map<number, number>; unversioned: number }>();
  for (const e of entries) {
    let u = out.get(e.formId);
    if (!u) {
      u = { total: 0, byVersion: new Map(), unversioned: 0 };
      out.set(e.formId, u);
    }
    u.total++;
    if (typeof e.formVersion === "number") u.byVersion.set(e.formVersion, (u.byVersion.get(e.formVersion) ?? 0) + 1);
    else u.unversioned++;
  }
  return out;
}

export const entryCount = (usage: ReadonlyMap<string, FormUsage>, formId: string): number => usage.get(formId)?.total ?? 0;

/** A form with entries can only be archived, never deleted (its entries must always resolve). The rules forbid deletes outright; this is what the UI tells the user. */
export const canDeleteForm = (usage: ReadonlyMap<string, FormUsage>, formId: string): boolean => entryCount(usage, formId) === 0;
