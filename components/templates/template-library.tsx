"use client";

import { useMemo, useState } from "react";
import { Download, Eye, Flag, Globe2, Pencil, RefreshCw, Rocket, Search, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelectRow } from "@/components/forms/builder/controls";
import { TemplateCard } from "@/components/templates/template-card";
import { ConfirmDialog, ReasonDialog, TemplateDetailsDialog, TemplatePreviewDialog, UpdateFromFormDialog, UseTemplateDialog } from "@/components/templates/template-dialogs";
import { exportFormJson } from "@/lib/forms/portable";
import { downloadTextFile } from "@/lib/download";
import { filterTemplates, templateTags, type FormTemplate, type TemplateSort } from "@/lib/templates/build";
import { useTemplates } from "@/lib/templates/service";
import type { Form } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P23: the template library (Admin Panel > Forms > Templates, and "From template" in New form): Public templates and My templates, with search, tag
// filters and sorting. A template can be previewed (the real form, test fill), used (a new draft form in this account, remembering its source), and
// exported. Your own can be edited, updated from a form (a new version), asked to be made public (the platform owner reviews it), unpublished and deleted.
// Anyone else's public template can be reported.

type Dialog =
  | { kind: "preview" | "use" | "edit" | "update" | "publish" | "unpublish" | "delete" | "report"; t: FormTemplate }
  | null;

export function TemplateLibrary({
  forms,
  onUse,
  tab: controlledTab,
  onTabChange,
}: {
  /** This account's forms, for "Update from a form". */
  forms: { id: string; name: string; form: Form | null }[];
  /** Makes a draft form from a template (the caller saves it and opens the builder). */
  onUse: (t: FormTemplate, name: string) => Promise<void>;
  tab?: "public" | "mine";
  onTabChange?: (tab: "public" | "mine") => void;
}) {
  const svc = useTemplates();
  const [innerTab, setInnerTab] = useState<"public" | "mine">("public");
  const tab = controlledTab ?? innerTab;
  const setTab = (t: "public" | "mine") => (onTabChange ? onTabChange(t) : setInnerTab(t));
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<TemplateSort>("newest");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = tab === "public" ? svc.publicTemplates : svc.mine;
  const tags = useMemo(() => templateTags(source), [source]);
  const shown = useMemo(() => filterTemplates(source, { q, tag, sort }), [source, q, tag, sort]);
  const close = () => setDialog(null);

  const guard = async (fn: () => Promise<void>, done: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      throw e;
    }
  };

  const exportJson = (t: FormTemplate) => downloadTextFile(`${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "template"}.form.json`, exportFormJson(t.form), "application/json");

  const actions = (t: FormTemplate) => {
    const own = t.ownerTeamId === svc.teamId;
    const btn = (label: string, icon: typeof Eye, onClick: () => void, opts: { aria?: string; variant?: "glass" | "ghost" | "primary" | "danger"; disabled?: boolean } = {}) => {
      const Icon = icon;
      return (
        <Button key={label} size="sm" variant={opts.variant ?? "glass"} className="gap-1.5" aria-label={opts.aria ?? `${label} ${t.name}`} disabled={opts.disabled} onClick={onClick}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </Button>
      );
    };
    const list = [btn("Preview", Eye, () => setDialog({ kind: "preview", t })), btn("Use template", Sparkles, () => setDialog({ kind: "use", t }), { variant: "primary", aria: `Use template ${t.name}` }), btn("Export JSON", Download, () => exportJson(t), { aria: `Export ${t.name} as JSON` })];
    if (tab === "public" && !own) list.push(btn("Report", Flag, () => setDialog({ kind: "report", t }), { variant: "ghost", aria: `Report ${t.name}` }));
    if (own) {
      if (t.visibility === "private" || t.visibility === "rejected") {
        list.push(btn("Edit details", Pencil, () => setDialog({ kind: "edit", t })));
        list.push(btn("Update from a form", RefreshCw, () => setDialog({ kind: "update", t })));
        list.push(btn("Request to publish", Rocket, () => setDialog({ kind: "publish", t }), { aria: `Request to publish ${t.name} publicly` }));
        list.push(btn("Delete", Trash2, () => setDialog({ kind: "delete", t }), { variant: "ghost" }));
      } else if (t.visibility === "public") {
        list.push(btn("Send an update", RefreshCw, () => setDialog({ kind: "update", t }), { aria: `Send an update to ${t.name}` }));
        list.push(btn("Unpublish", Undo2, () => setDialog({ kind: "unpublish", t }), { variant: "ghost" }));
      } else {
        list.push(btn("Unpublish", Undo2, () => setDialog({ kind: "unpublish", t }), { variant: "ghost", aria: `Withdraw ${t.name} from review` }));
      }
    }
    return list;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="template-library">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "public" | "mine")}>
        <TabsList>
          <TabsTrigger value="public">Public templates</TabsTrigger>
          <TabsTrigger value="mine">My templates{svc.mine.length > 0 ? ` (${svc.mine.length})` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input aria-label="Search templates" placeholder="Search name, description, tags, author…" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-44">
          <SelectRow label="Sort by" value={sort} onChange={(v) => v && setSort(v)} options={[{ value: "newest", label: "Newest" }, { value: "popular", label: "Most used" }]} />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
          {tags.map(({ tag: t, count }) => (
            <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)} className={cn("min-h-9 rounded-full border px-3 text-xs font-medium", tag === t ? "border-transparent text-[var(--color-primary-foreground)]" : "border-[var(--glass-border)] text-[var(--muted-foreground)]")} style={tag === t ? { background: "var(--theme-gradient)" } : undefined}>
              {t} <span className="opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {!svc.loaded ? (
        <div className="glass-card h-32 animate-pulse" />
      ) : shown.length === 0 ? (
        <p className="glass-card flex items-center gap-2 p-6 text-sm text-[var(--muted-foreground)]" data-testid="templates-empty">
          <Globe2 className="h-4 w-4" />
          {source.length === 0 ? (tab === "public" ? "No public templates yet." : "You haven't saved any templates. Use “Save as template” on one of your forms.") : "Nothing matches that search."}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={tab === "public" ? "Public templates" : "My templates"}>
          {shown.map((t) => (
            <li key={t.id}>
              <TemplateCard t={t} showStatus={tab === "mine"} actions={actions(t)} />
            </li>
          ))}
        </ul>
      )}

      <TemplatePreviewDialog
        template={dialog?.kind === "preview" ? dialog.t : null}
        onClose={close}
        footer={
          dialog?.kind === "preview" && (
            <Button className="gap-2" onClick={() => setDialog({ kind: "use", t: dialog.t })}>
              <Sparkles className="h-4 w-4" /> Use template
            </Button>
          )
        }
      />
      <UseTemplateDialog template={dialog?.kind === "use" ? dialog.t : null} onClose={close} onUse={onUse} />
      <TemplateDetailsDialog
        open={dialog?.kind === "edit"}
        onClose={close}
        title="Edit template details"
        intro="Changes the name, description and tags. The form inside stays as it is; use “Update from a form” to change that."
        confirmLabel="Save"
        initial={dialog?.kind === "edit" ? { name: dialog.t.name, description: dialog.t.description, tags: dialog.t.tags } : { name: "", description: "", tags: [] }}
        onSave={(v) => dialog?.kind === "edit" ? guard(() => svc.update(dialog.t.id, { form: dialog.t.form, ...v }), "Saved.") : Promise.resolve()}
      />
      <UpdateFromFormDialog
        template={dialog?.kind === "update" ? dialog.t : null}
        forms={forms}
        onClose={close}
        onUpdate={(t, form) => {
          const input = { form, name: t.name, description: t.description, tags: t.tags };
          return guard(() => (t.visibility === "public" ? svc.sendUpdate(t.id, input) : svc.update(t.id, input)), t.visibility === "public" ? "Sent for review. The current public version stays live until it's approved." : "Template updated.");
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "publish"}
        onClose={close}
        title="Request to publish publicly?"
        description={
          <>
            The platform owner reviews every public template before anyone else can see it. While it waits you can&apos;t edit it, and you can withdraw it at any time. Your account can have up to 5 requests waiting, and 3 can be sent per hour.
          </>
        }
        confirmLabel="Send for review"
        onConfirm={() => (dialog?.kind === "publish" ? guard(() => svc.requestPublish(dialog.t.id), "Sent for review. You'll be told when there's a decision.") : Promise.resolve())}
      />
      <ConfirmDialog
        open={dialog?.kind === "unpublish"}
        onClose={close}
        title="Unpublish this template?"
        description="It goes back to being private to your account. Accounts that already used it keep their copies."
        confirmLabel="Unpublish"
        onConfirm={() => (dialog?.kind === "unpublish" ? guard(() => svc.unpublish(dialog.t.id), "It's private again.") : Promise.resolve())}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onClose={close}
        title="Delete this template?"
        description="It's removed for good. Forms you made from it are not affected."
        confirmLabel="Delete"
        danger
        onConfirm={() => (dialog?.kind === "delete" ? guard(() => svc.remove(dialog.t.id), "Deleted.") : Promise.resolve())}
      />
      <ReasonDialog
        open={dialog?.kind === "report"}
        onClose={close}
        title="Report this template"
        description="Tell the platform owner what's wrong (spam, a bad link, something inappropriate). One report per account."
        label="What's the problem?"
        confirmLabel="Send report"
        onConfirm={(reason) => (dialog?.kind === "report" ? guard(() => svc.report(dialog.t.id, reason), "Thanks: the platform owner will take a look.") : Promise.resolve())}
      />
    </div>
  );
}
