"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Focus, GripHorizontal, Maximize2, MessageSquareText, Minimize2, PanelRightOpen, X } from "lucide-react";
import { useMediaQuery } from "@/lib/use-media-query";
import { useImmersive } from "@/lib/shell-immersive";
import { useWorkspacePrefs } from "@/lib/workspace/use-workspace-prefs";
import {
  COLLAPSED_STRIP_PX,
  DIVIDER_PX,
  FORM_DEFAULT_FRACTION,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  clampFormWidth,
  clampSplit,
  fitContain,
  formWidthLimits,
  fractionToWidth,
  phoneVideoHeight,
  shortcutFor,
  stepFormWidth,
  stepSplit,
  widthToFraction,
} from "@/lib/workspace/layout";
import { StickyNotesList } from "@/components/forms/sticky-notes-panel";
import type { StickyNote } from "@/lib/forms/types";
import { noteCount } from "@/lib/sticky-notes";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

// P24: the one layout every practice-scouting screen shares (solo practice, Live, lobby): a big centered video, a resizable form that scrolls inside its own
// panel with the action bar pinned under it, a Focus mode, workspace fullscreen, and a comments drawer. The page itself doesn't scroll. The screens give it
// content (the video node, the form node, the action buttons); everything about size, scrolling, persistence and shortcuts lives here, so a fix is made once.
//
//  - Tablet and desktop (>= 768px): video pane | draggable divider | form panel. The video is the largest 16:9 that fits its pane (ResizeObserver), centered.
//    The divider is a keyboard-operable separator (arrows, Home/End, double-click resets); the width is remembered per user.
//  - Phones: the video pinned on top, a drag handle (and its keyboard equivalent), the form below; the video can shrink to a mini player.
//  - Nothing here touches playback: no pause control is added, nothing covers the player's own controls (the drawer pushes the video aside instead of overlapping it),
//    and the comments drawer never takes focus unless it's opened. Competitive's no-pause rule lives in the player and is unchanged.

/** P28: the drawer holds the same sticky notes as every other form (one mechanism); the entry's `comments` text is derived from them. */
export type WorkspaceComments = { notes: StickyNote[]; onChange: (notes: StickyNote[]) => void; /** "Robot 1: #1234" */ label: string };

export type ScoutingWorkspaceProps = {
  /** The video (or stream) node. It is placed in a 16:9 box the workspace sizes; put overlays (a "Ready?" cover) inside it. `null` for a screen with no video. */
  video: ReactNode;
  /** Small text on the video pane's toolbar (e.g. "Competitive: video can't be paused"). */
  videoNote?: ReactNode;
  /** The scouting form. */
  form: ReactNode;
  /** The buttons of the action bar pinned under the form (two children sit left and right; one sits right). */
  actions: ReactNode;
  /** Shown above the action bar inside the form panel (an error banner). */
  notice?: ReactNode;
  /** Turns on the comments drawer. */
  comments?: WorkspaceComments | null;
  /** Pointer events in the video pane that mustn't reach the player while dragging are handled internally; this is for the page's own testing hooks. */
  testId?: string;
};

const WIDE_QUERY = "(min-width: 768px)";
const DRAWER_PX = 340;
const TAB_PX = 36;

/** The largest 16:9 box that fits the pane, centered, resized smoothly with it. */
function VideoStage({ children, dragging, className }: { children: ReactNode; dragging: boolean; className?: string }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const next = fitContain(r.width, r.height);
      setBox((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={paneRef} data-testid="workspace-video-pane" className={cn("relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-black/25", className)}>
      <div
        data-testid="workspace-video-box"
        className={cn("relative overflow-hidden rounded-xl", !dragging && "transition-[width,height] duration-100 ease-out")}
        style={{ width: box.width, height: box.height, visibility: box.width === 0 ? "hidden" : "visible" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The comments drawer's contents (P28): which robot, and the robot's sticky notes: the same note cards as every other form (add, colour, pin, delete). Opened on
 * purpose (the tab, the C key) it puts the cursor in the first note, starting one when there are none; closed, it never takes focus. The first note's text box keeps
 * the old `comments-input` test id.
 */
function CommentsPanel({ comments, onClose, className, autoFocusKey }: { comments: WorkspaceComments; onClose: () => void; className?: string; autoFocusKey: number }) {
  return (
    <section aria-label="Comments" data-testid="comments-drawer" className={cn("glass-overlay flex flex-col gap-2 border border-[var(--glass-border)] p-3", className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" data-testid="comments-robot">
          {comments.label}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close comments" className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StickyNotesList notes={comments.notes} onChange={comments.onChange} firstInputTestId="comments-input" focusKey={autoFocusKey} />
      </div>
      <p className="text-[11px] text-[var(--muted-foreground)]">Saved with this robot&apos;s entry. The video keeps playing.</p>
    </section>
  );
}

export function ScoutingWorkspace({ video, videoNote, form, actions, notice, comments = null, testId = "scouting-workspace" }: ScoutingWorkspaceProps) {
  const wide = useMediaQuery(WIDE_QUERY);
  const { setImmersive } = useImmersive();
  const { formFraction, setFormFraction, phoneSplit, setPhoneSplit } = useWorkspacePrefs();

  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowSize, setRowSize] = useState({ width: 0, height: 0 });
  const [top, setTop] = useState(0);
  const [focus, setFocus] = useState(false);
  const [mini, setMini] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [focusTicks, setFocusTicks] = useState(0);
  const [dragPx, setDragPx] = useState<number | null>(null);
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const hasVideo = video !== null && video !== undefined;
  const hasComments = !!comments;
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled === true;

  // --- the page doesn't scroll: the workspace takes the rest of the window ---------------------------------------------
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      window.scrollTo(0, 0);
      setTop(root.getBoundingClientRect().top + window.scrollY);
      // A window too short to fit a usable workspace keeps its page scroll rather than clipping it.
      if (window.innerHeight >= 520) document.documentElement.dataset.workspace = "1";
      else delete document.documentElement.dataset.workspace;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    window.addEventListener("resize", measure);
    // `overflow: hidden` stops the wheel and touch but not scrollIntoView or focus: anything that nudges the page is put back.
    const keepTop = () => {
      if (document.documentElement.dataset.workspace && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", keepTop, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", keepTop);
      delete document.documentElement.dataset.workspace;
    };
  }, [focus]);

  // --- the form column's size (tablet and desktop) ------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRowSize((p) => (p.width === Math.round(r.width) && p.height === Math.round(r.height) ? p : { width: Math.round(r.width), height: Math.round(r.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide]);

  const containerW = rowSize.width;
  const formPx = dragPx ?? fractionToWidth(formFraction, containerW);
  const limits = formWidthLimits(containerW);
  const splitNow = dragSplit ?? phoneSplit;

  // --- Focus mode, fullscreen, shortcuts ----------------------------------------------------------------------------------
  useEffect(() => {
    setImmersive(focus && wide);
    return () => setImmersive(false);
  }, [focus, wide, setImmersive]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const openComments = useCallback(() => {
    setCommentsOpen(true);
    setFocusTicks((n) => n + 1);
  }, []);

  // A closed drawer is hidden but still mounted: if the cursor was in its text box, let go of it, so the shortcuts (C) work again and the hidden box can't hold the keyboard.
  useEffect(() => {
    if (commentsOpen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-testid="comments-drawer"]')) active.blur();
  }, [commentsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a dialog (the break menu, a confirm) owns the keyboard while it's open
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const action = shortcutFor({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, defaultPrevented: e.defaultPrevented, target: e.target as HTMLElement | null }, commentsOpen);
      if (!action) return;
      if (action === "focus") {
        if (wide) setFocus((v) => !v);
      } else if (action === "comments") {
        if (hasComments) {
          e.preventDefault(); // the "c" shouldn't also land in the text box that opens
          openComments();
        }
      } else if (action === "close-comments") {
        setCommentsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commentsOpen, hasComments, wide, openComments]);

  // --- divider dragging ------------------------------------------------------------------------------------------------------
  const dragStart = useRef<{ pointerId: number } | null>(null);
  // The latest dragged value, kept synchronously: a fast drag can end (pointerup) before React has re-rendered the last move, and the saved width must be the last one.
  const latestPx = useRef<number | null>(null);
  const latestSplit = useRef<number | null>(null);
  const onDividerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerId: e.pointerId };
    latestPx.current = formPx;
    setDragPx(formPx);
  };
  const onDividerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = clampFormWidth(rect.right - e.clientX - DIVIDER_PX / 2, rect.width);
    latestPx.current = next;
    setDragPx(next);
  };
  const onDividerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const last = latestPx.current;
    latestPx.current = null;
    if (last !== null) setFormFraction(widthToFraction(last, rowRef.current?.getBoundingClientRect().width || containerW));
    setDragPx(null);
  };
  const onDividerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = stepFormWidth(formPx, e.key, containerW, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    setFormFraction(widthToFraction(next, containerW));
  };

  // --- phone handle ---------------------------------------------------------------------------------------------------------------
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mini) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pointerId: e.pointerId };
    latestSplit.current = phoneSplit;
    setDragSplit(phoneSplit);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const next = clampSplit((e.clientY - rect.top) / rect.height);
    latestSplit.current = next;
    setDragSplit(next);
  };
  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const last = latestSplit.current;
    latestSplit.current = null;
    if (last !== null) setPhoneSplit(last);
    setDragSplit(null);
  };
  const onHandleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = stepSplit(splitNow, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    setPhoneSplit(next);
  };

  const dragging = dragPx !== null || dragSplit !== null;
  const commentsDot = !!comments && noteCount(comments.notes) > 0;

  const toolbar = (
    <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 px-1">
      <div className="min-w-0 truncate text-xs text-[var(--muted-foreground)]">{videoNote}</div>
      <div className="flex shrink-0 items-center gap-1">
        {wide && (
          <button type="button" data-testid="workspace-focus" aria-pressed={focus} aria-label={focus ? "Leave focus mode (F)" : "Focus mode (F)"} title={focus ? "Leave focus mode (F)" : "Focus mode (F)"} onClick={() => setFocus((v) => !v)} className={cn("flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium hover:bg-white/10", focus && "bg-white/10")}>
            <Focus className="h-4 w-4" /> <span className="hidden xl:inline">Focus</span>
          </button>
        )}
        {canFullscreen && (
          <button type="button" data-testid="workspace-fullscreen" aria-pressed={fullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen (video and form)"} onClick={toggleFullscreen} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium hover:bg-white/10">
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} <span className="hidden xl:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
          </button>
        )}
      </div>
    </div>
  );

  /** The form panel: the form scrolls in its own box, the action bar is pinned under it. `overlay` (the phone's comments sheet) sits on the scroll box, so it never covers the bar. */
  const formPanel = (overlay?: ReactNode) => (
    <div data-testid="workspace-form-panel" className="flex h-full min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div data-testid="workspace-form-scroll" className="h-full overflow-y-auto overscroll-contain pb-2 pr-1">
          {form}
        </div>
        {overlay}
      </div>
      {notice}
      <div data-testid="workspace-actions" className="glass-strong mt-2 flex shrink-0 items-center justify-between gap-3 rounded-full px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl [&>:only-child]:ml-auto">
        {actions}
      </div>
    </div>
  );

  const commentsTab = hasComments && hasVideo && (
    <button
      type="button"
      data-testid="comments-tab"
      aria-expanded={commentsOpen}
      aria-controls="workspace-comments"
      aria-label={commentsOpen ? "Close comments (Esc)" : "Open comments (C)"}
      title={commentsOpen ? "Close comments (Esc)" : "Comments (C)"}
      onClick={() => (commentsOpen ? setCommentsOpen(false) : openComments())}
      className="relative flex shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/[0.06] hover:bg-white/10"
      style={{ width: TAB_PX }}
    >
      <MessageSquareText className="h-4 w-4" />
      <span className="text-[11px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">Comments</span>
      {commentsDot && <span data-testid="comments-dot" className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)] ring-2 ring-[var(--background)]" aria-label="Has comments" />}
    </button>
  );

  // While a divider is being dragged nothing on the page may be selected or start a native drag (that would swallow the pointer events).
  const rootClass = cn("relative flex min-h-0 flex-col gap-2 overflow-hidden", fullscreen && "bg-[var(--background)] p-3", dragging && "select-none");
  const rootStyle = { height: fullscreen ? "100dvh" : `max(420px, calc(100dvh - ${top}px - 0.75rem))` };

  // ----------------------------------------------------------------------------------------------------------------------------------------
  if (!wide) {
    // PHONE: the video pinned on top, a handle, then the form (scrolling inside its panel) with the action bar pinned at the bottom.
    const videoH = phoneVideoHeight(rowSize.height || 600, splitNow, mini);
    return (
      <div ref={rootRef} data-testid={testId} data-layout="phone" className={rootClass} style={rootStyle}>
        <div ref={rowRef} className="absolute inset-0 -z-10" aria-hidden />
        {hasVideo && (
          <div data-testid="workspace-phone-video" className="flex shrink-0 flex-col" style={{ height: videoH || undefined }}>
            <VideoStage dragging={dragging} className="flex-1">
              {video}
            </VideoStage>
          </div>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col gap-2">
          {hasVideo && (
            <div className="flex shrink-0 items-center gap-1">
              {hasComments && (
                <button type="button" data-testid="comments-tab" aria-expanded={commentsOpen} aria-label={commentsOpen ? "Close comments" : "Open comments"} onClick={() => (commentsOpen ? setCommentsOpen(false) : openComments())} className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08]">
                  <MessageSquareText className="h-5 w-5" />
                  {commentsDot && <span data-testid="comments-dot" className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)] ring-2 ring-[var(--background)]" aria-label="Has comments" />}
                </button>
              )}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the video"
                aria-valuemin={Math.round(SPLIT_MIN * 100)}
                aria-valuemax={Math.round(SPLIT_MAX * 100)}
                aria-valuenow={Math.round(splitNow * 100)}
                tabIndex={0}
                data-testid="workspace-handle"
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                onKeyDown={onHandleKey}
                onDoubleClick={() => setPhoneSplit(SPLIT_DEFAULT)}
                className={cn("group flex h-11 flex-1 cursor-row-resize touch-none items-center justify-center rounded-full outline-none hover:bg-white/10 focus-visible:bg-white/10", dragSplit !== null && "bg-white/10 shadow-[0_0_18px_2px_rgba(var(--glow),0.45)]", mini && "cursor-default")}
              >
                <GripHorizontal className="h-5 w-5 text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]" />
              </div>
              <button type="button" data-testid="workspace-mini" aria-pressed={mini} aria-label={mini ? "Expand video" : "Shrink video to a mini player"} onClick={() => setMini((v) => !v)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08]">
                {mini ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
              </button>
            </div>
          )}
          {formPanel(
            comments && commentsOpen ? (
              <motion.div id="workspace-comments" data-testid="comments-sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring} className="absolute inset-x-0 bottom-0 z-30 max-h-[85%] overflow-y-auto rounded-3xl shadow-2xl">
                <CommentsPanel comments={comments} onClose={() => setCommentsOpen(false)} autoFocusKey={focusTicks} className="rounded-3xl" />
              </motion.div>
            ) : null
          )}
        </div>
      </div>
    );
  }

  // TABLET and DESKTOP
  return (
    <div ref={rootRef} data-testid={testId} data-layout="wide" data-focus={focus ? "1" : "0"} className={rootClass} style={rootStyle}>
      <div ref={rowRef} className="flex min-h-0 flex-1 gap-0">
        {hasVideo && (
          <div className="flex min-h-0 min-w-0 flex-1 gap-2">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
              {toolbar}
              <VideoStage dragging={dragging}>{video}</VideoStage>
            </div>
            {hasComments && (
              <>
                <motion.div id="workspace-comments" initial={false} animate={{ width: commentsOpen ? DRAWER_PX : 0, opacity: commentsOpen ? 1 : 0 }} transition={dragging ? { duration: 0 } : spring} className="min-h-0 shrink-0 overflow-hidden" style={{ visibility: commentsOpen ? "visible" : "hidden" }}>
                  <div style={{ width: DRAWER_PX }} className="h-full">
                    <CommentsPanel comments={comments} onClose={() => setCommentsOpen(false)} autoFocusKey={focusTicks} className="h-full rounded-2xl" />
                  </div>
                </motion.div>
                {commentsTab}
              </>
            )}
          </div>
        )}
        {!hasVideo && (
          <div className="sr-only" aria-hidden>
            {toolbar}
          </div>
        )}

        {hasVideo && !focus && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the form"
            aria-valuemin={limits.min}
            aria-valuemax={limits.max}
            aria-valuenow={formPx}
            tabIndex={0}
            data-testid="workspace-divider"
            title="Drag to resize. Double-click to reset."
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            onKeyDown={onDividerKey}
            onDoubleClick={() => setFormFraction(FORM_DEFAULT_FRACTION)}
            className="group relative flex shrink-0 cursor-col-resize touch-none select-none items-center justify-center outline-none"
            style={{ width: DIVIDER_PX }}
          >
            <span className={cn("h-16 w-1 rounded-full bg-[var(--glass-border)] transition-all group-hover:h-24 group-hover:bg-[var(--color-primary)] group-hover:shadow-[0_0_14px_2px_rgba(var(--glow),0.6)] group-focus-visible:h-24 group-focus-visible:bg-[var(--color-primary)] group-focus-visible:shadow-[0_0_14px_2px_rgba(var(--glow),0.6)]", dragPx !== null && "h-28 bg-[var(--color-primary)] shadow-[0_0_18px_3px_rgba(var(--glow),0.7)]")} />
          </div>
        )}

        {/* The form panel stays mounted in Focus mode (hidden), so nothing typed is lost; the strip brings it back. */}
        <div data-testid="workspace-form-column" className={cn("min-h-0 shrink-0", hasVideo && focus && "hidden", !hasVideo && "flex-1")} style={hasVideo ? { width: formPx } : undefined}>
          {formPanel()}
        </div>
        {hasVideo && focus && (
          <button type="button" data-testid="workspace-form-strip" aria-label="Show the form (F)" title="Show the form (F)" onClick={() => setFocus(false)} className="glass-card ml-2 flex shrink-0 flex-col items-center justify-center gap-3 rounded-2xl hover:bg-white/10" style={{ width: COLLAPSED_STRIP_PX }}>
            <PanelRightOpen className="h-5 w-5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">Form</span>
          </button>
        )}
      </div>
    </div>
  );
}
