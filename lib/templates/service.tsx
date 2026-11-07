"use client";

import { createContext, useContext } from "react";
import type { Form } from "@/lib/forms/types";
import type { FormTemplate, TemplateContent } from "@/lib/templates/build";

// P23: what the template screens need from the outside world, as one interface, so the screens don't know whether templates live in Firestore (the
// real account: lib/templates/firestore-service.tsx) or in memory (the Playwright fixture: lib/templates/memory-service.ts). Reads are live lists;
// every write is one user action.

export type TemplateInput = { form: Form; name: string; description: string; tags: string[] };

export type TemplateReport = { teamId: string; reason: string; at?: number };

export type TemplateService = {
  loaded: boolean;
  /** Everything public. */
  publicTemplates: FormTemplate[];
  /** This account's templates, in any state. */
  mine: FormTemplate[];
  /** The platform owner sees the review queue. */
  isPlatformOwner: boolean;
  /** Waiting for a first review (platform owners only; empty for everyone else). */
  queue: FormTemplate[];
  /** This account's id, to tell "mine" from "theirs" on a public template. */
  teamId: string | null;

  getTemplate(id: string): Promise<FormTemplate | null>;

  // the author, while private
  create(input: TemplateInput): Promise<string>;
  update(id: string, input: TemplateInput): Promise<void>;
  remove(id: string): Promise<void>;
  // the author, through the server
  requestPublish(id: string): Promise<void>;
  /** A new version of a public template, held for review while the approved one stays live. */
  sendUpdate(id: string, input: TemplateInput): Promise<void>;
  unpublish(id: string): Promise<void>;
  // anyone on an account
  report(id: string, reason: string): Promise<void>;
  /** Fetches a template to copy and counts the use (once per account). */
  use(id: string): Promise<FormTemplate>;
  // the platform owner
  getPendingUpdate(id: string): Promise<(TemplateContent & { version: number }) | null>;
  getReports(id: string): Promise<TemplateReport[]>;
  approve(id: string): Promise<void>;
  reject(id: string, reason: string): Promise<void>;
  takeDown(id: string, reason: string): Promise<void>;
  setOfficial(id: string, official: boolean): Promise<void>;
  dismissReports(id: string): Promise<void>;
  seedOfficial(): Promise<{ id: string; result: string }[]>;
};

export const TemplatesContext = createContext<TemplateService | null>(null);

export function useTemplates(): TemplateService {
  const ctx = useContext(TemplatesContext);
  if (!ctx) throw new Error("useTemplates must be used inside a TemplatesProvider.");
  return ctx;
}
