// Safe minimal markup for admin-written text (P14): **bold**, *italic* (or
// _italic_), and [label](https://link). Nothing here ever produces HTML.
//
// The text is parsed into a small whitelist token tree (text / bold / italic /
// link) that `components/ui/rich-text.tsx` renders as React elements — so a `<`
// in the input is just a character React escapes, and there is no HTML string
// to sanitize in the first place. That is deliberately stricter than "write HTML,
// then sanitize it": the only thing an editor can express is these four nodes,
// and the only URLs that become links are https ones. Pure and tested.

export type RichNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: RichNode[] }
  | { type: "italic"; children: RichNode[] }
  | { type: "link"; href: string; children: RichNode[] };

const MAX_URL_LENGTH = 2048;

/**
 * True only for an absolute `https:` URL with a host and no embedded
 * credentials, no whitespace or control characters, and a sane length. Used for
 * every link an admin can enter (changelog text, credits entries, logos) — never
 * `javascript:`, `data:`, `http:`, or protocol-relative `//host`.
 */
export function isSafeHttpsUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  // Whitespace and control characters (incl. the tab/newline tricks used to smuggle schemes) are never valid.
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
  // Canonical form only: the URL parser would "repair" `https:/host` or `https:host` into a valid URL.
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

const ESCAPABLE = new Set(["\\", "*", "_", "[", "]", "(", ")"]);
const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);

/** `[label](url)` starting at `start` (which holds "["): the label, url, and index just past ")". */
function matchLink(s: string, start: number): { label: string; url: string; end: number } | null {
  const close = s.indexOf("]", start + 1);
  if (close < 0 || s[close + 1] !== "(") return null;
  const endParen = s.indexOf(")", close + 2);
  if (endParen < 0) return null;
  const label = s.slice(start + 1, close);
  if (label.length === 0) return null;
  return { label, url: s.slice(close + 2, endParen), end: endParen + 1 };
}

function parseInline(s: string, allowLinks: boolean): RichNode[] {
  const nodes: RichNode[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];

    // Backslash escapes a markup character: \* \_ \[ ...
    if (c === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
      buffer += s[i + 1];
      i += 2;
      continue;
    }

    if (allowLinks && c === "[") {
      const link = matchLink(s, i);
      // An unsafe URL isn't a link at all — the whole thing stays visible, inert text.
      if (link && isSafeHttpsUrl(link.url)) {
        flush();
        nodes.push({ type: "link", href: link.url, children: parseInline(link.label, false) });
        i = link.end;
        continue;
      }
    }

    if (c === "*" && s[i + 1] === "*") {
      const close = s.indexOf("**", i + 2);
      if (close > i + 2) {
        flush();
        nodes.push({ type: "bold", children: parseInline(s.slice(i + 2, close), allowLinks) });
        i = close + 2;
        continue;
      }
    }

    if (c === "*" || c === "_") {
      // `_` only starts italics at a word boundary, so snake_case_names stay plain.
      const boundaryOk = c === "*" || !isWordChar(s[i - 1]);
      if (boundaryOk && s[i + 1] !== c && s[i + 1] !== " ") {
        let close = i + 1;
        while (close < s.length) {
          close = s.indexOf(c, close);
          if (close < 0) break;
          if (s[close - 1] !== " " && s[close + 1] !== c && (c === "*" || !isWordChar(s[close + 1]))) break;
          close += 1;
        }
        if (close > i + 1) {
          flush();
          nodes.push({ type: "italic", children: parseInline(s.slice(i + 1, close), allowLinks) });
          i = close + 1;
          continue;
        }
      }
    }

    buffer += c;
    i += 1;
  }
  flush();
  return nodes;
}

/** Parses admin text into the whitelist token tree. Never throws; unmatched markers stay literal. */
export function parseRichText(text: string): RichNode[] {
  return parseInline(text, true);
}

/** The text with all markup removed (a link becomes its label) — for search and plain-text previews. */
export function richTextToPlain(text: string): string {
  const walk = (nodes: RichNode[]): string => nodes.map((n) => (n.type === "text" ? n.text : walk(n.children))).join("");
  return walk(parseRichText(text));
}

/** Every `[label](url)` in the text whose URL isn't a safe https link — for editor validation, since such a link would render as plain text. */
export function findUnsafeLinks(text: string): string[] {
  const unsafe: string[] = [];
  for (const m of text.matchAll(/\[[^\]]+\]\(([^)]*)\)/g)) {
    if (!isSafeHttpsUrl(m[1])) unsafe.push(m[1]);
  }
  return unsafe;
}
