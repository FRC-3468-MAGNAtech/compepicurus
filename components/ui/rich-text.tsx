import { Fragment, useMemo, type ReactNode } from "react";
import { parseRichText, type RichNode } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

function renderNodes(nodes: RichNode[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>;
      case "bold":
        return <strong key={i} className="font-semibold text-[var(--foreground)]">{renderNodes(node.children)}</strong>;
      case "italic":
        return <em key={i}>{renderNodes(node.children)}</em>;
      case "link":
        // parseRichText only emits links whose URL passed isSafeHttpsUrl().
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline decoration-[var(--color-accent)]/40 underline-offset-2 transition-colors hover:decoration-[var(--color-accent)]">
            {renderNodes(node.children)}
          </a>
        );
    }
  });
}

/**
 * Renders admin-written text with the safe minimal markup (**bold**, *italic*,
 * [label](https://link)) as plain React elements — no `dangerouslySetInnerHTML`
 * anywhere, so anything else an editor types (`<script>`, `<img onerror=…>`) is
 * just escaped text. See lib/rich-text.ts.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const nodes = useMemo(() => parseRichText(text), [text]);
  return <span className={cn("break-words", className)}>{renderNodes(nodes)}</span>;
}
