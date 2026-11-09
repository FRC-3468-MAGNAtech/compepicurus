import { isSystemField, type Form, type FormField, type FormGroup, type FormSection, type GroupRepeat } from "@/lib/forms/types";

// P27: per-team repeating groups. A group with `repeat: { source: 'allianceTeams', maxSlots }` is drawn once per team of the chosen
// alliance, and its fields are stored by slot: `t1_notes`, `t1_team`, `t2_notes`, ... Pure.

/** The storage key of a field in slot `slot` (1-based): `t2_notes`. */
export const slotKey = (slot: number, key: string): string => `t${slot}_${key}`;

/** `t2_notes` -> `{ slot: 2, key: "notes" }`; anything else -> null. */
export function parseSlotKey(storageKey: string): { slot: number; key: string } | null {
  const m = /^t([1-9])_(.+)$/.exec(storageKey);
  return m ? { slot: Number(m[1]), key: m[2] } : null;
}

export type RepeatGroup = FormGroup & { repeat: GroupRepeat };

/** The repeating group a field sits in, or null. */
export function repeatGroupOf(section: Pick<FormSection, "groups">, field: Pick<FormField, "groupId">): RepeatGroup | null {
  if (!field.groupId) return null;
  const group = section.groups?.find((g) => g.id === field.groupId);
  return group?.repeat ? (group as RepeatGroup) : null;
}

/** Every value a form stores: a plain field is one slot-less value, a field in a repeating group is one value per slot up to `maxSlots`. */
export type ValueSlot = { storageKey: string; field: FormField; section: FormSection; slot: number | null };

/**
 * The storage slots of a form's value fields, in render order. System pickers (event, match, alliance, team, scout) live on the entry itself
 * and are not values, except a `teamPicker` inside a repeating group, which holds each slot's team (`t1_team`).
 */
export function valueSlots(form: Pick<Form, "sections">): ValueSlot[] {
  const out: ValueSlot[] = [];
  for (const section of form.sections) {
    for (const field of section.fields) {
      const group = repeatGroupOf(section, field);
      const system = isSystemField(field);
      if (group) {
        for (let slot = 1; slot <= group.repeat.maxSlots; slot++) out.push({ storageKey: slotKey(slot, field.key), field, section, slot });
      } else if (!system) out.push({ storageKey: field.key, field, section, slot: null });
    }
  }
  return out;
}

/** How many boxes to draw for an alliance of `teamCount` teams: that many, at least 1 and at most the group's maximum. */
export const slotCountFor = (teamCount: number, maxSlots: number): number => Math.max(1, Math.min(maxSlots, Math.trunc(teamCount) || 1));

/** The largest slot count any repeating group of the form allows (0 when it has none). */
export function maxRepeatSlots(form: Pick<Form, "sections">): number {
  let max = 0;
  for (const s of form.sections) for (const g of s.groups ?? []) if (g.repeat) max = Math.max(max, g.repeat.maxSlots);
  return max;
}

/** Does the form have a repeating group? */
export const hasRepeatGroup = (form: Pick<Form, "sections">): boolean => maxRepeatSlots(form) > 0;
