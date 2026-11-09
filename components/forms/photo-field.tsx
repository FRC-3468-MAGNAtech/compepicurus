"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, RefreshCw, TriangleAlert, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePhotoUploads, type PhotoTarget } from "@/components/forms/photo-upload";
import type { ImageValue } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

/**
 * P27: the `image` field. Photos are shrunk in the browser (1600 px, JPEG), queued in IndexedDB and uploaded to Vercel Blob in the background, so they
 * survive a reload and bad Wi-Fi. Each shows its state: Waiting (offline or queued), Uploading, Failed (tap to retry), or done (a thumbnail). The field's
 * value is the finished photos; pending ones are in `pendingIds` for the form to hand to `attachWhenDone` if it is submitted first.
 * Without an upload provider (the builder's preview) it shows a placeholder: uploads work in the live form.
 */
export function PhotoField({
  label,
  fieldKey,
  value,
  maxCount,
  capture,
  required,
  disabled,
  target,
  onChange,
  onPendingChange,
}: {
  label: string;
  fieldKey: string;
  value: ImageValue[];
  maxCount: number;
  capture?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Where the photos go. Null until the form knows (an event and team are chosen). */
  target: PhotoTarget | null;
  onChange: (value: ImageValue[]) => void;
  /** The queue ids still uploading for this field (so a submit can attach them to the entry afterwards). */
  onPendingChange?: (ids: string[]) => void;
}) {
  const uploads = usePhotoUploads();
  const instance = useId();
  const fieldRef = `photo:${instance}:${fieldKey}`;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const merged = useRef(new Set<string>());
  const sessionUploaded = useRef(new Set<string>());
  const mine = (uploads?.items ?? []).filter((i) => i.fieldRef === fieldRef);
  const pending = mine.filter((i) => i.status !== "done");

  // a finished upload becomes part of the field's value, then leaves the queue
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  useEffect(() => {
    if (!uploads) return;
    const finished = mine.filter((i) => i.status === "done" && i.result && !merged.current.has(i.id));
    if (finished.length === 0) return;
    for (const i of finished) {
      merged.current.add(i.id);
      sessionUploaded.current.add(i.result!.url);
    }
    onChange([...valueRef.current, ...finished.map((i) => i.result!)].slice(0, maxCount));
    for (const i of finished) void uploads.discard(i.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads?.items]);

  const pendingKey = pending.map((i) => i.id).join(",");
  useEffect(() => {
    onPendingChange?.(pendingKey ? pendingKey.split(",") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  if (!uploads || !target) {
    return (
      <p className="glass-card flex items-center gap-2 px-4 py-3 text-sm text-[var(--muted-foreground)]" data-testid="photo-placeholder">
        <Camera className="h-4 w-4 shrink-0" aria-hidden />
        {!uploads ? "Photos upload in the live form." : "Choose the event and team first, then add photos."}
      </p>
    );
  }

  const room = maxCount - value.length - pending.length;
  const add = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      try {
        await uploads.addPhoto(file, target, fieldRef);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That photo couldn't be added.");
      }
    }
    if (input.current) input.current.value = "";
  };

  const remove = (photo: ImageValue) => {
    onChange(value.filter((p) => p.url !== photo.url));
    // A photo uploaded during this visit and now removed is deleted from storage; one from an already-saved entry is cleaned up when the entry is saved or deleted.
    if (sessionUploaded.current.has(photo.url)) void uploads.deleteUploaded(photo.url).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-2" data-testid={`photo-field-${fieldKey}`}>
      <div className="flex flex-wrap gap-2">
        {value.map((p) => (
          <div key={p.url} className="glass-card relative h-24 w-24 overflow-hidden rounded-2xl" data-testid="photo-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element -- a Vercel Blob URL on a host we don't configure for next/image */}
            <img src={p.url} alt={`${label}: photo`} loading="lazy" className="h-full w-full object-cover" />
            {!disabled && (
              <button type="button" onClick={() => remove(p)} aria-label="Remove this photo" className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {pending.map((i) => (
          <div key={i.id} className="glass-card flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl p-1 text-center text-[11px]" data-testid="photo-pending" data-status={i.status}>
            {i.status === "failed" ? (
              <>
                <TriangleAlert className="h-5 w-5 text-amber-300" aria-hidden />
                <span>Failed</span>
                <button type="button" onClick={() => uploads.retryNow()} className="inline-flex items-center gap-1 underline">
                  <RefreshCw className="h-3 w-3" /> Retry
                </button>
              </>
            ) : i.status === "uploading" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                {uploads.online ? <Loader2 className="h-5 w-5 animate-pulse" aria-hidden /> : <WifiOff className="h-5 w-5" aria-hidden />}
                <span>{uploads.online ? "Waiting…" : "Waiting for connection"}</span>
              </>
            )}
          </div>
        ))}
        {room > 0 && !disabled && (
          <Button type="button" variant="glass" className={cn("h-24 w-24 flex-col gap-1 rounded-2xl text-xs")} onClick={() => input.current?.click()} disabled={!uploads.ready} data-testid="photo-add">
            {capture ? <Camera className="h-5 w-5" aria-hidden /> : <ImagePlus className="h-5 w-5" aria-hidden />}
            {capture ? "Take photo" : "Add photo"}
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" {...(capture ? { capture: "environment" as const } : {})} multiple={maxCount > 1} hidden aria-label={`${label}: choose a photo`} data-testid="photo-input" onChange={(e) => void add(e.target.files)} />
      <p className="text-xs text-[var(--muted-foreground)]">
        {value.length + pending.length} of {maxCount} photo{maxCount === 1 ? "" : "s"}
        {required && value.length === 0 && pending.length === 0 ? " · at least one is required" : ""}
        {!uploads.online ? " · offline: photos upload when you're back online" : ""}
      </p>
      {error && (
        <p role="alert" className="text-xs font-medium text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
