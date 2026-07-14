// Showcase persona cards: presentation-only metadata for demo projects, keyed by
// project id. Decoupled from ProjectSnapshot on purpose — no type/db migration.

export interface ShowcaseCard {
  persona: string;
  goal: string;
  shows: string[];
  steps: string[];
}

export type ShowcaseMap = Record<string, ShowcaseCard>;

// Validate + normalize raw showcase.json into a clean map (drops malformed entries).
export function parseShowcaseMap(raw: unknown): ShowcaseMap {
  if (!raw || typeof raw !== "object") return {};
  const out: ShowcaseMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<ShowcaseCard> | null;
    if (!v || typeof v.persona !== "string" || typeof v.goal !== "string") continue;
    const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    out[id] = { persona: v.persona, goal: v.goal, shows: strings(v.shows), steps: strings(v.steps) };
  }
  return out;
}

// ponytail: module-level promise cache — showcase.json is static, fetch once per session.
let cache: Promise<ShowcaseMap> | null = null;
export function loadShowcaseMap(): Promise<ShowcaseMap> {
  if (!cache) {
    cache = fetch("/showcase.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(parseShowcaseMap)
      .catch(() => ({}));
  }
  return cache;
}
