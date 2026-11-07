"use client";

import { createContext, useContext } from "react";
import type { FormIssue } from "@/lib/forms/validate";
import type { Form } from "@/lib/forms/types";

// P22: the builder's shared state, so the palette, canvas, inspector and panels don't pass a dozen props around. `update` is the only way the
// form changes: it records an undo step (edits to the same thing in quick succession share a `coalesceKey` and become one step).

export type BuilderSelection = { kind: "field"; id: string } | { kind: "section"; id: string } | { kind: "form" };

export type BuilderApi = {
  form: Form;
  update: (fn: (f: Form) => Form, coalesceKey?: string) => void;
  selection: BuilderSelection;
  select: (s: BuilderSelection) => void;
  /** Every key that has appeared in a published version (renaming one leaves an alias so old entries still read). */
  publishedKeys: ReadonlySet<string>;
  issues: FormIssue[];
  /** Phones: the structure is read-only (no adding, moving or deleting), simple field edits only. */
  compact: boolean;
  /** Entries that exist for this form, for "this affects N entries" notes. */
  entryCount: number;
};

export const BuilderContext = createContext<BuilderApi | null>(null);

export function useBuilder(): BuilderApi {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error("useBuilder must be used inside the Form Builder.");
  return ctx;
}
