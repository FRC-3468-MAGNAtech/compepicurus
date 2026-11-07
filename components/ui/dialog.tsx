"use client";

import { createContext, useContext, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { spring } from "@/lib/motion";
import { portalContainer } from "@/lib/portal-container";
import { cn } from "@/lib/utils";

// Radix's own Presence (used internally by Dialog.Portal/Overlay/Content)
// only recognizes CSS animations/transitions, not Framer Motion's
// WAAPI-driven exit animation — without forceMount it unmounts the dialog
// the instant `open` goes false, cutting the exit animation off mid-play.
// forceMount bypasses that; we track `open` ourselves and let
// AnimatePresence own the mount/unmount lifecycle instead.
const DialogOpenContext = createContext(false);

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : internalOpen;

  return (
    <DialogOpenContext.Provider value={resolvedOpen}>
      <DialogPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(v) => {
          if (!isControlled) setInternalOpen(v);
          onOpenChange?.(v);
        }}
        {...props}
      />
    </DialogOpenContext.Provider>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const open = useContext(DialogOpenContext);

  return (
    <DialogPrimitive.Portal forceMount container={portalContainer()}>
      <AnimatePresence>
        {open && (
          <>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="fixed inset-0 z-50 bg-black/50 scrim-blur"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content forceMount asChild {...props}>
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 16 }}
                transition={spring}
                className={cn(
                  "glass-strong fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 shadow-2xl",
                  // P17: on a phone the dialog is a bottom sheet — full width, pinned to the bottom edge, rounded on top only, at most
                  // 92% of the *dynamic* viewport (so the on-screen keyboard and browser toolbars can't push it off screen), scrolling
                  // inside, with the home-indicator safe area below its content. The solid .glass-strong/.glass-overlay backing is unchanged.
                  "max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:max-h-[92dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-b-none max-sm:rounded-t-[28px] max-sm:px-5 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
                  className
                )}
              >
                {children}
                <DialogPrimitive.Close asChild>
                  <button
                    className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-white/10 hover:text-[var(--foreground)]"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DialogPrimitive.Close>
              </motion.div>
            </DialogPrimitive.Content>
          </>
        )}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  );
}

export const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />
);

export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("mt-1 text-sm text-[var(--muted-foreground)]", className)} {...props} />
);
