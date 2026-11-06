import { isSafeHttpsUrl } from "@/lib/rich-text";
import { parseYouTubeUrl } from "@/lib/library/youtube-url";

// Validation for the "Add manual event" / "Edit event" form (P15). Pure.

export type EventFormInput = {
  name: string;
  /** Blank = generate `MAN-…` from the name. Only used when creating. */
  code: string;
  date: string;
  sourceUrl: string;
  defaultVideoUrl: string;
};

export type EventFormErrors = Partial<Record<keyof EventFormInput, string>>;

export const MAX_EVENT_NAME = 120;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The checks that don't need the list of existing codes (that's `validateEventCode` in ids.ts). */
export function validateEventForm(input: EventFormInput): { ok: boolean; errors: EventFormErrors } {
  const errors: EventFormErrors = {};
  const name = input.name.trim();
  if (name === "") errors.name = "Give the event a name.";
  else if (name.length > MAX_EVENT_NAME) errors.name = `Keep the name under ${MAX_EVENT_NAME} characters.`;

  if (input.date.trim() !== "" && !isRealDate(input.date.trim())) errors.date = "Pick a valid date.";

  const source = input.sourceUrl.trim();
  if (source !== "" && !isSafeHttpsUrl(source)) errors.sourceUrl = "Use a full link starting with https://.";

  const video = input.defaultVideoUrl.trim();
  if (video !== "" && !parseYouTubeUrl(video)) errors.defaultVideoUrl = "That doesn't look like a YouTube link.";

  return { ok: Object.keys(errors).length === 0, errors };
}
