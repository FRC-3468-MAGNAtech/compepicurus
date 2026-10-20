"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { spring } from "@/lib/motion";

export function CommentCell({ text, forceExpanded }: { text: string; forceExpanded: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = forceExpanded || expanded;

  if (!text.trim()) {
    return <span className="text-[var(--muted-foreground)]">-</span>;
  }

  return (
    <motion.div layout transition={spring} className="w-full py-1">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={isExpanded ? "block w-full whitespace-pre-wrap text-left" : "block w-full truncate text-left"}
      >
        {text}
      </button>
    </motion.div>
  );
}
