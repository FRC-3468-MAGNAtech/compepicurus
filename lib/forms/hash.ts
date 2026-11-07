// P21: a stable content hash of a form, so an override can tell when the code-defined built-in it was copied from has changed since.

/** JSON with object keys sorted, so equal forms always serialise identically (and undefined fields vanish, as they do in Firestore). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 64-bit FNV-1a over the canonical JSON, as 16 hex characters. Not cryptographic: it only has to notice that something changed. */
export function contentHash(value: unknown): string {
  const text = canonicalJson(value);
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c >>> 3) ^ h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** The fields of a form that define its behaviour (not who made it or when), so cosmetic metadata changes don't count as "the built-in changed". */
export function formContentHash(form: { sections: unknown; scoringEnabled: unknown; keyAliases?: unknown; phaseLabels?: unknown; version?: unknown }): string {
  return contentHash({ sections: form.sections, scoringEnabled: form.scoringEnabled, keyAliases: form.keyAliases ?? null, phaseLabels: form.phaseLabels ?? null });
}
