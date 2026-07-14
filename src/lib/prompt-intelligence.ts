import { getModel } from "./model-catalog";

const famousTerms = [
  "taylor swift",
  "drake",
  "beyonce",
  "mickey mouse",
  "spongebob",
  "batman",
  "elon musk",
  "donald trump",
  "joe biden"
];

const vagueAudioTerms = ["music", "sound", "noise", "sfx"];
const accentTerms = ["american", "british", "neutral", "spanish", "french", "german", "japanese", "chinese"];
const seedPromptLimit = 2048;

export interface PromptLintResult {
  warnings: string[];
  blocked: boolean;
}

function searchable(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i");
}

function stripVoiceDirective(raw: string): string {
  return raw.replace(/\bvoices\s*:\s*\[[^\]]+\]\.?\s*/i, "").trim();
}

function cleanRequest(raw: string): string {
  return stripVoiceDirective(raw)
    .replace(/\s+/g, " ")
    .replace(/^create\s+|^make\s+|^generate\s+/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

function clipPhrase(text: string, max = 118): string {
  const clean = text.replace(/"/g, "'").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/g, "").trim();
}

function userLine(raw: string, fallback: string): string {
  const clean = clipPhrase(cleanRequest(raw));
  if (!clean) return fallback;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function clampSeedPrompt(prompt: string): string {
  if (prompt.length <= seedPromptLimit) return prompt;
  const clipped = prompt.slice(0, seedPromptLimit - 29).replace(/\s+\S*$/g, "").trim();
  return `${clipped} [music resolves].`;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function voiceRoster(raw: string, voiceNames: string[]): string[] {
  if (voiceNames.length > 0) return voiceNames.map(normalizeVoiceName).filter(Boolean).slice(0, 3);

  return [...raw.matchAll(/@Audio(\d+)\s*=\s*([A-Za-z][A-Za-z0-9 _-]{0,32})/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => normalizeVoiceName(match[2]))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeVoiceName(name: string): string {
  const cleaned = name.replace(/\([^)]*\)/g, "").replace(/[^A-Za-z0-9 _-]/g, "").trim();
  return cleaned.split(/\s+/).slice(0, 2).join(" ") || "Speaker";
}

function buildSeedCastPrompt(raw: string, voices: string[]): string {
  const idea = userLine(raw, "The story takes a sharp, funny turn");
  const first = voices[0] ?? "Host";
  const second = voices[1] ?? "Guest";

  if (voices.length === 1) {
    return clampSeedPrompt(
      `[Close studio room tone, soft console hum, a low cinematic pulse.] ${first} (American accent, warm resonant, focused, measured, voiced by @Audio1) says: "${idea}. Listen closely - this is where the moment changes." [subtle riser swells, single low impact, music resolves].`
    );
  }

  return clampSeedPrompt(
    `[Warm studio room tone, faint equipment hum, a coffee mug clinks down.] ${first} (American accent, smooth confident, playful, medium pace, voiced by @Audio1) says: "Set the scene for me - ${idea.toLowerCase()}." ${second} (American accent, bright clear, nervous, quick pace, voiced by @Audio2) replies: "I thought I had it under control, and then everything tilted sideways." ${first} (American accent, smooth confident, playful, medium pace, voiced by @Audio1) chuckles: "That is exactly where the good part starts." ${second} (American accent, bright clear, nervous, quick pace, voiced by @Audio2) says: "Fine, but if this goes on tape, I am blaming you." [both laugh; chair creaks; room tone fades].`
  );
}

function buildSeedScenePrompt(raw: string): string {
  const text = searchable(cleanRequest(raw));
  const idea = userLine(raw, "Everything changes in one breath");

  if (includesAny(text, ["goal", "stadium", "commentator", "match", "football", "soccer", "gol", "mac", "spiker"])) {
    return clampSeedPrompt(
      `[Inside a packed night stadium, crowd roar pounds under sharp whistle blasts and distant drums.] The commentator (middle-aged male, British accent, rich resonant, wildly exhilarated, fast rising cadence) shouts: "Past one, past two - she buries it in the top corner! The whole stadium is shaking!" [crowd roar erupts, camera shutters rattle, final whistle cuts through and fades].`
    );
  }

  if (includesAny(text, ["sci-fi", "sci fi", "space", "planet", "earth", "trailer", "uzay", "gezegen", "dunya", "fragman"])) {
    return clampSeedPrompt(
      `[Tense cinematic synth pad over a low sub-bass drone, distant alarm blips.] A narrator (female, American accent, low resonant, grave, measured) says: "The oceans climbed, the skies burned, and our maps stopped meaning home." [a PA crackles] A commander (male, American accent, deep resonant, urgent, clipped) announces: "Launch crews, seal the ring. New Haven is our last window." [engine roar spools up] The narrator (female, American accent, low resonant, hopeful, measured) says: "One distant world. One final chance." [music surges, then resolves into fading telemetry beeps].`
    );
  }

  if (includesAny(text, ["news", "presenter", "presentor", "reporter", "sport", "sports", "weather", "haber", "spor", "hava"])) {
    return clampSeedPrompt(
      `[Live TV newsroom ambience, soft teleprompter clicks, restrained news sting.] Marcus Reed (middle-aged male, American accent, polished resonant, calm, measured) says: "Good evening. We begin with the headlines before handing off to the field." [clean broadcast whoosh] Jamal Price (young adult Black male, American accent, bright energetic, exhilarated, fast pace) reports: "The stadium is still shaking after a finish nobody here will forget." [crowd roar rises under his mic] Maya Cole (middle-aged female, American accent, warm precise, reassuring, medium pace) says: "And after tonight's showers, the morning clears with cooler air moving in." [soft weather bed resolves].`
    );
  }

  if (includesAny(text, ["podcast", "host", "interview", "embarrassing", "story", "sohbet", "konus"])) {
    return clampSeedPrompt(
      `[Warm podcast studio room tone, faint equipment hum, a coffee mug clinks down.] Dex (young adult male, American accent, smooth warm, playful, medium pace) says: "Alright - most embarrassing thing that ever happened to you. Go." Robin (young adult female, American accent, bright airy, nervous, quick pace) groans: "You absolutely do not want this on tape." Dex (young adult male, American accent, smooth warm, playful, medium pace) chuckles: "Too late, I am invested." [both laugh; room tone fades under a soft vinyl bumper].`
    );
  }

  if (includesAny(text, ["horror", "basement", "door", "monster", "suspense", "korku", "bodrum", "kapi"])) {
    return clampSeedPrompt(
      `[Old basement ambience, rain tapping a small window, low bowed-metal drone.] Mara (young adult female, American accent, breathy, panicked, slow deliberate) whispers: "The door was open when I came down here." [floorboard creaks] Eli (young adult male, American accent, raspy, fearful, clipped) murmurs: "Then why can I hear it knocking from the inside?" [three hollow knocks; drone drops to silence].`
    );
  }

  if (includesAny(text, ["two", "dialogue", "conversation", "argue", "argument", "talk", "iki", "tartisma"])) {
    return clampSeedPrompt(
      `[Small apartment kitchen ambience, refrigerator hum, rain against the fire escape.] Ava (young adult female, American accent, clear crystalline, tense, clipped) says: "${idea}." Milo (young adult male, American accent, gravelly, weary, slow deliberate) replies: "Then say it plainly, because I am done guessing." [ceramic cup touches the counter; low piano note fades].`
    );
  }

  return clampSeedPrompt(
    `[Quiet production studio room tone, soft control-room clicks, a low cinematic pulse.] A narrator (middle-aged female, American accent, resonant, focused, measured) says: "${idea}. Listen for the turn - the room knows before anyone speaks." [subtle riser swells, single low impact, music resolves into warm tape hiss].`
  );
}

export function lintPrompt(modelId: string, prompt: string): PromptLintResult {
  const lower = prompt.toLowerCase();
  const warnings: string[] = [];
  let blocked = famousTerms.some((term) => lower.includes(term));

  if (prompt.length > seedPromptLimit && modelId.startsWith("seed-")) {
    warnings.push("Seed Audio prompts must stay under 2048 characters.");
    blocked = true;
  }
  if (blocked) {
    warnings.push("Avoid famous people, public figures, copyrighted characters, and branded IP.");
  }
  if (modelId.includes("scene") && !accentTerms.some((term) => lower.includes(term))) {
    warnings.push("Scene prompts should include an explicit accent for every speaker.");
  }
  if (modelId.includes("scene") && !/^\s*\[[^\]]+\]/.test(prompt)) {
    warnings.push("Seed scene prompts should start with a concrete bracketed environment and ambience cue.");
  }
  if (modelId.includes("scene") && !/"[^"]+"/.test(prompt)) {
    warnings.push("Seed scene prompts should include finished quoted dialogue, not only instructions.");
  }
  if (modelId === "seed-cast-scene" && /@Audio\d+/.test(prompt) && !/voiced by @Audio\d+/.test(prompt)) {
    warnings.push("Cast scenes must tag every spoken line with voiced by @AudioN.");
  }
  if (modelId === "seed-tts" && !accentTerms.some((term) => lower.includes(term))) {
    warnings.push("Seed TTS prompts should include an explicit accent in the voice spec.");
  }
  if (modelId === "seed-tts" && !/"[^"]+"/.test(prompt)) {
    warnings.push("Seed TTS prompts should carry the spoken text in quotes after the voice spec.");
  }
  if (modelId === "seed-tts" && /\[[^\]]+\]/.test(prompt)) {
    warnings.push("Plain TTS should not include bracketed scene, music, or SFX cues.");
  }
  if (vagueAudioTerms.some((term) => lower.trim() === term || lower.includes(`[${term}]`))) {
    warnings.push("Name SFX and music concretely instead of using generic labels.");
  }
  if (/\b(no accent|without accent|do not sound)\b/i.test(prompt)) {
    warnings.push("Negative voice instructions often backfire; describe the desired voice directly.");
  }

  return { warnings, blocked };
}

export function enhancePrompt(modelId: string, raw: string, voiceNames: string[] = []): string {
  const model = getModel(modelId);
  const text = raw.trim();
  if (!text) return "";

  if (model?.task === "scene") {
    const voices = voiceRoster(raw, voiceNames);
    return voices.length > 0 ? buildSeedCastPrompt(text, voices) : buildSeedScenePrompt(text);
  }

  if (model?.id === "seed-tts") {
    const line = text.replace(/"/g, "'");
    return `The narrator (middle-aged male, American accent, warm resonant, calm, measured) narrates: "${line}"`;
  }

  if (model?.task === "sfx") {
    return `${text}, close-mic detail, clear transient, natural decay, no music bed, no dialogue`;
  }

  if (model?.task === "music") {
    return `${text}, clear genre, instrumentation, tempo, mood, arrangement arc, clean mix, no copyrighted melody`;
  }

  if (model?.task === "restyle") {
    return text.replace(/\b(ignore|say|repeat after me)\b/gi, "").trim();
  }

  return text;
}
