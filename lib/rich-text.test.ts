import { describe, expect, it } from "vitest";
import { findUnsafeLinks, isSafeHttpsUrl, parseRichText, richTextToPlain, type RichNode } from "./rich-text";

const text = (t: string): RichNode => ({ type: "text", text: t });
const bold = (...children: RichNode[]): RichNode => ({ type: "bold", children });
const italic = (...children: RichNode[]): RichNode => ({ type: "italic", children });
const link = (href: string, ...children: RichNode[]): RichNode => ({ type: "link", href, children });

describe("isSafeHttpsUrl", () => {
  it("accepts ordinary https URLs", () => {
    expect(isSafeHttpsUrl("https://example.com")).toBe(true);
    expect(isSafeHttpsUrl("https://example.com/a/b?c=d#e")).toBe(true);
    expect(isSafeHttpsUrl("https://sub.example.co.uk:8443/x")).toBe(true);
  });

  it("rejects every other scheme", () => {
    for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://example.com", "file:///etc/passwd", "mailto:a@b.co", "blob:https://example.com/x", "vbscript:msgbox(1)"]) {
      expect(isSafeHttpsUrl(bad), bad).toBe(false);
    }
  });

  it("rejects scheme tricks, relative and protocol-relative URLs", () => {
    for (const bad of ["//example.com", "/relative/path", "example.com", "HTTPS//example.com", "https:/example.com", "https:example.com", "  https://example.com", "https://example.com ", "https://exa mple.com", "java\nscript:alert(1)", "https://example.com\n", "jav\tascript:alert(1)"]) {
      expect(isSafeHttpsUrl(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects credentials, empty hosts, junk, and absurd lengths", () => {
    expect(isSafeHttpsUrl("https://user:pass@example.com")).toBe(false);
    expect(isSafeHttpsUrl("https://user@example.com")).toBe(false);
    expect(isSafeHttpsUrl("https://")).toBe(false);
    expect(isSafeHttpsUrl("")).toBe(false);
    expect(isSafeHttpsUrl(`https://example.com/${"a".repeat(3000)}`)).toBe(false);
    expect(isSafeHttpsUrl(undefined as unknown as string)).toBe(false);
  });
});

describe("parseRichText", () => {
  it("leaves plain text alone", () => {
    expect(parseRichText("just words")).toEqual([text("just words")]);
    expect(parseRichText("")).toEqual([]);
  });

  it("parses bold and italic", () => {
    expect(parseRichText("a **bold** word")).toEqual([text("a "), bold(text("bold")), text(" word")]);
    expect(parseRichText("an *italic* word")).toEqual([text("an "), italic(text("italic")), text(" word")]);
    expect(parseRichText("an _italic_ word")).toEqual([text("an "), italic(text("italic")), text(" word")]);
  });

  it("nests bold and italic", () => {
    expect(parseRichText("**bold *and italic* inside**")).toEqual([bold(text("bold "), italic(text("and italic")), text(" inside"))]);
  });

  it("parses https links, with formatting inside the label", () => {
    expect(parseRichText("see [the docs](https://example.com/docs) now")).toEqual([text("see "), link("https://example.com/docs", text("the docs")), text(" now")]);
    expect(parseRichText("[**big** link](https://example.com)")).toEqual([link("https://example.com", bold(text("big")), text(" link"))]);
  });

  it("does not turn an unsafe URL into a link — it stays visible, inert text", () => {
    for (const bad of ["javascript:alert(1)", "http://example.com", "data:text/html,hi", "//evil.example", "https://u:p@evil.example"]) {
      const nodes = parseRichText(`[click](${bad})`);
      expect(nodes.every((n) => n.type === "text"), bad).toBe(true);
      expect(richTextToPlain(`[click](${bad})`)).toBe(`[click](${bad})`);
    }
  });

  it("never produces HTML: markup characters in the input stay plain text for React to escape", () => {
    const evil = `<script>alert("x")</script> <img src=x onerror=alert(1)> <b>not bold</b>`;
    expect(parseRichText(evil)).toEqual([text(evil)]);
    const nodes = parseRichText(`**<img src=x onerror=alert(1)>**`);
    expect(nodes).toEqual([bold(text("<img src=x onerror=alert(1)>"))]);
  });

  it("only ever emits the four whitelisted node types", () => {
    const seen = new Set<string>();
    const walk = (nodes: RichNode[]) => {
      for (const n of nodes) {
        seen.add(n.type);
        if (n.type !== "text") walk(n.children);
      }
    };
    walk(parseRichText("**a** *b* _c_ [d](https://example.com) <e> `f` # g > h"));
    expect([...seen].every((t) => ["text", "bold", "italic", "link"].includes(t))).toBe(true);
  });

  it("leaves unmatched markers literal and never throws", () => {
    expect(richTextToPlain("5 * 3 = 15")).toBe("5 * 3 = 15");
    expect(richTextToPlain("**unclosed bold")).toBe("**unclosed bold");
    expect(richTextToPlain("[no url]")).toBe("[no url]");
    expect(richTextToPlain("[label](https://example.com")).toBe("[label](https://example.com");
    expect(richTextToPlain("trailing *")).toBe("trailing *");
    expect(richTextToPlain("____")).toBe("____");
    expect(() => parseRichText("*_*[**](()\\")).not.toThrow();
  });

  it("keeps snake_case words and multiplication plain", () => {
    expect(richTextToPlain("use some_snake_case here")).toBe("use some_snake_case here");
    expect(parseRichText("some_snake_case")).toEqual([text("some_snake_case")]);
    expect(parseRichText("2 * 3 * 4").every((n) => n.type === "text")).toBe(true);
  });

  it("honours backslash escapes", () => {
    expect(parseRichText("\\*not italic\\*")).toEqual([text("*not italic*")]);
    expect(parseRichText("\\[not a link\\](https://example.com)")).toEqual([text("[not a link](https://example.com)")]);
  });

  it("handles a pathological long input quickly", () => {
    const start = Date.now();
    parseRichText("*".repeat(5000) + "_".repeat(5000) + "[".repeat(2000));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("richTextToPlain", () => {
  it("strips formatting and keeps a link's label", () => {
    expect(richTextToPlain("**Bold** and *italic* with [a link](https://example.com).")).toBe("Bold and italic with a link.");
  });
});

describe("findUnsafeLinks", () => {
  it("lists link URLs that wouldn't render as links", () => {
    expect(findUnsafeLinks("[ok](https://example.com) and [bad](javascript:alert(1)) and [also](http://example.com)")).toEqual(["javascript:alert(1", "http://example.com"]);
    expect(findUnsafeLinks("no links here, just *markup*")).toEqual([]);
    expect(findUnsafeLinks("[fine](https://example.com/a?b=c)")).toEqual([]);
  });
});
