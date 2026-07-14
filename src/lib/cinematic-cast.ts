import type { Asset, Voice } from "@/lib/types";
import {
  findMentionedTargets,
  replaceMentionsWithAudioTags,
  stripUnknownMentionMarkers
} from "@/lib/mentions";

export const MAX_CINEMATIC_CAST = 3;
export const MAX_SEED_REFERENCE_SECONDS = 30;

export interface ComposeCharacter {
  id: string;
  name: string;
  voiceId: string;
}

export interface CinematicCastRef {
  id: string;
  name: string;
  url: string;
  duration: number;
}

export type CharacterAliasResult =
  | { valid: true; name: string }
  | { valid: false; reason: string };

export interface ComposeCharacterValidation {
  id: string;
  valid: boolean;
  normalizedName?: string;
  nameError?: string;
  voiceError?: string;
}

export function normalizeCharacterAlias(value: unknown): CharacterAliasResult {
  if (typeof value !== "string" || !value.trim()) {
    return { valid: false, reason: "is required" };
  }
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
    return {
      valid: false,
      reason: "may contain only letters, numbers, spaces, apostrophes, hyphens, and underscores"
    };
  }

  const name = value.trim().replace(/\p{Zs}+/gu, " ");
  if (Array.from(name).length > 40) {
    return { valid: false, reason: "must be 40 characters or fewer" };
  }
  if (
    !/^[\p{L}\p{N}_'’ -]+$/u.test(name) ||
    !/[\p{L}\p{N}]/u.test(name)
  ) {
    return {
      valid: false,
      reason: "may contain only letters, numbers, spaces, apostrophes, hyphens, and underscores"
    };
  }
  if (/^Audio\d+$/iu.test(name)) {
    return { valid: false, reason: "is reserved" };
  }
  return { valid: true, name };
}

export function validateComposeCharacters(
  rows: ComposeCharacter[]
): ComposeCharacterValidation[] {
  const aliases = rows.map((row) => normalizeCharacterAlias(row.name));
  const aliasCounts = new Map<string, number>();

  aliases.forEach((alias) => {
    if (!alias.valid) return;
    const key = alias.name.toLocaleLowerCase();
    aliasCounts.set(key, (aliasCounts.get(key) ?? 0) + 1);
  });

  return rows.map((row, index) => {
    const alias = aliases[index];
    const duplicated =
      alias.valid && (aliasCounts.get(alias.name.toLocaleLowerCase()) ?? 0) > 1;
    const nameError = !alias.valid
      ? `Alias ${alias.reason}`
      : duplicated
        ? "Alias is duplicated"
        : undefined;
    const voiceError = row.voiceId.trim() ? undefined : "Saved voice is required";
    return {
      id: row.id,
      valid: !nameError && !voiceError,
      ...(alias.valid ? { normalizedName: alias.name } : {}),
      ...(nameError ? { nameError } : {}),
      ...(voiceError ? { voiceError } : {})
    };
  });
}

export function normalizeCinematicCharacterNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    const result = normalizeCharacterAlias(item);
    if (!result.valid) continue;
    const key = result.name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(result.name);
    if (names.length === MAX_CINEMATIC_CAST) break;
  }
  return names;
}

export function resolveComposeCast(
  rows: ComposeCharacter[],
  voices: Voice[],
  assets: Asset[]
): CinematicCastRef[] {
  if (rows.length > MAX_CINEMATIC_CAST) {
    throw new Error(`Compose supports up to ${MAX_CINEMATIC_CAST} characters`);
  }

  const seen = new Set<string>();
  return rows.map((row) => {
    const alias = normalizeCharacterAlias(row.name);
    const voiceId = row.voiceId.trim();
    if ((!alias.valid && alias.reason === "is required") || !voiceId) {
      throw new Error("Each character needs a name and saved voice");
    }
    if (!alias.valid) {
      throw new Error(
        `Character name ${JSON.stringify(row.name.trim())} ${alias.reason}`
      );
    }
    const name = alias.name;

    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new Error(`Character name "${name}" is duplicated`);
    }
    seen.add(key);

    const voice = voices.find((item) => item.id === voiceId);
    const asset = voice ? assets.find((item) => item.id === voice.refAssetId) : undefined;
    if (!voice || !asset) {
      throw new Error(`@${name} has no available voice reference`);
    }
    if (asset.duration > MAX_SEED_REFERENCE_SECONDS) {
      throw new Error(
        `@${name} reference is over ${MAX_SEED_REFERENCE_SECONDS}s. Save a shorter region as that voice.`
      );
    }

    return { id: row.id, name, url: asset.url, duration: asset.duration };
  });
}

export function resolvePromptCast(
  prompt: string,
  cast: CinematicCastRef[]
): { prompt: string; audioUrls: string[] } {
  const mentioned = findMentionedTargets(prompt, cast);
  const rewritten = replaceMentionsWithAudioTags(prompt, mentioned);
  return {
    prompt: stripUnknownMentionMarkers(rewritten),
    audioUrls: mentioned.map((item) => item.url)
  };
}
