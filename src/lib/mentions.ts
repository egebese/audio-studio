/*
 * Voice @mentions in prompts. Mentions are written as "@Voice Name" — no quoting
 * syntax; matching is done against the known voice-name set (longest match wins),
 * so names with spaces work and unknown @words stay plain text.
 */

export interface MentionTarget {
  id: string;
  name: string;
}

export interface MentionQuery {
  /* Index of the "@" that starts the query. */
  start: number;
  /* Text typed after the "@" up to the caret. */
  text: string;
}

const maxMentionVoices = 3;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  return !/[\p{L}\p{N}_]/u.test(text[index]);
}

/* Voices mentioned as @Name, in order of first appearance, deduped, capped at 3. */
export function findMentionedTargets<T extends MentionTarget>(text: string, targets: T[]): T[] {
  if (!text.includes("@") || !targets.length) return [];
  const targetNames = new Set<string>();
  const uniqueTargets = targets.filter((target) => {
    const key = target.name.trim().toLocaleLowerCase();
    if (!key || targetNames.has(key)) return false;
    targetNames.add(key);
    return true;
  });
  const sorted = uniqueTargets.sort((a, b) => b.name.length - a.name.length);
  const found: Array<{ target: T; index: number }> = [];
  const seen = new Set<string>();
  // Longest names scan first and claim their "@" position, so "@Warm Narrator Deep"
  // never doubles as a "@Warm Narrator" mention.
  const claimedAt = new Set<number>();

  for (const target of sorted) {
    const name = target.name.trim();
    if (!name || seen.has(target.id)) continue;
    const pattern = new RegExp(`@${escapeRegExp(name)}`, "gi");
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (claimedAt.has(index)) continue;
      if (index > 0 && /[\p{L}\p{N}_]/u.test(text[index - 1])) continue;
      if (!isBoundary(text, index + match[0].length)) continue;
      claimedAt.add(index);
      seen.add(target.id);
      found.push({ target, index });
      break;
    }
  }

  return found
    .sort((a, b) => a.index - b.index)
    .slice(0, maxMentionVoices)
    .map((entry) => entry.target);
}

/* Rewrites @Name → @AudioN following the order of `targets`. */
export function replaceMentionsWithAudioTags(text: string, targets: MentionTarget[]): string {
  const targetNames = new Set<string>();
  const entries: Array<{ name: string; tag: string }> = [];
  targets.forEach((target) => {
    const name = target.name.trim();
    const key = name.toLocaleLowerCase();
    if (!name || targetNames.has(key)) return;
    targetNames.add(key);
    entries.push({ name, tag: `@Audio${entries.length + 1}` });
  });
  if (!entries.length) return text;

  const tagsByName = new Map(
    entries.map((entry) => [entry.name.toLocaleLowerCase(), entry.tag])
  );
  const alternatives = entries
    .sort((a, b) => b.name.length - a.name.length);
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])@(${alternatives.map((entry) => escapeRegExp(entry.name)).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu"
  );
  return text.replace(pattern, (_match, prefix: string, name: string) => {
    return `${prefix}${tagsByName.get(name.toLocaleLowerCase())}`;
  });
}

export function stripUnknownMentionMarkers(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}_])@(?!Audio\d+\b)/gu, "$1");
}

/*
 * Detects an in-progress mention at the caret ("@" plus what was typed after it).
 * Returns null when the caret is not inside a mention being typed.
 */
export function mentionQueryAtCaret(text: string, caret: number): MentionQuery | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  const query = upToCaret.slice(at + 1);
  if (query.length > 40 || query.includes("\n") || query.includes("@")) return null;
  if (at > 0 && /[\p{L}\p{N}]/u.test(upToCaret[at - 1])) return null;
  return { start: at, text: query };
}

export function insertMention(text: string, query: MentionQuery, name: string): { text: string; caret: number } {
  const before = text.slice(0, query.start);
  const after = text.slice(query.start + 1 + query.text.length);
  const hasSeparator = /^\s/u.test(after);
  const mention = `@${name}${hasSeparator ? "" : " "}`;
  return {
    text: `${before}${mention}${after}`,
    caret: before.length + mention.length + (hasSeparator ? 1 : 0)
  };
}
