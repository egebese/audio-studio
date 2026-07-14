import { normalizeCinematicCharacterNames } from "./cinematic-cast";
import type { CinematicSpec } from "./cinematic-spec";

const EXAMPLES: CinematicSpec[] = [
  {
    name: "TRAILER — The Last Ember",
    voiceTrackName: "Scene",
    anchor: { prompt: 'The narrator (adult male, American accent, deep epic cinematic movie-trailer voice, slow, resonant) narrates: "Every legend begins with a single spark."' },
    voice: [
      { model: "seed-tts", clone: true, gap: 0.5, tail: 0.4, prompt: 'The narrator (voiced by @Audio1) narrates: "In an age of ash and ruin... one ember refused to die."' },
      {
        model: "seed-scene",
        climax: true,
        gap: 0.7,
        tail: 1.4,
        prompt:
          '[A scorched throne room, distant fires crackling, wind moaning through broken stone.] A young queen (adult female, American accent, defiant, trembling but strong) says: "You burned my whole world. I have nothing left to lose." A dark warlord (adult male, American accent, deep, cold, cruel, echoing) replies: "Then at last, you understand fear." [a sudden swell of orchestral brass; a blade rings from its sheath].'
      },
      { model: "seed-tts", clone: true, gap: 0.6, tail: 1.0, prompt: 'The narrator (voiced by @Audio1) narrates: "This winter, the last ember burns. THE LAST EMBER."' }
    ],
    score: { prompt: "epic dark fantasy movie-trailer orchestral score, ominous low brass and pounding taiko drums building to a massive heroic brass and choir climax, then a long ring-out", seconds: 34 },
    layers: [{ model: "eleven-sfx", name: "Impact", duck: "impact", place: "climax", text: "a huge cinematic braam impact and a metal sword unsheathing ring", seconds: 3 }],
    outro: { prompt: 'The narrator (voiced by @Audio1) narrates: "Some fires refuse to die."', gap: 0.7 }
  },
  {
    name: "GAME — Ashfall",
    voiceTrackName: "Scene",
    anchor: { prompt: 'The narrator (adult male, American accent, epic game-trailer voice, powerful, resonant, driving) narrates: "Some thrones are earned in fire."' },
    voice: [
      {
        model: "seed-scene",
        climax: true,
        gap: 0.5,
        tail: 1.4,
        prompt:
          '[A crumbling coliseum under a blood-red sky, embers drifting, a low earth-shaking rumble.] A warrior (adult female, American accent, breathless, defiant) shouts: "Whatever you are, I have come too far to kneel!" An ancient titan (a colossal, deep, guttural, reverberating inhuman voice, slow and menacing) booms: "Then you will fall, like all the others." [a titanic footstep quakes the ground; stone shatters].'
      },
      { model: "seed-tts", clone: true, gap: 0.8, tail: 1.0, prompt: 'The narrator (voiced by @Audio1) narrates: "Rise, or be forgotten. ASHFALL."' }
    ],
    score: { prompt: "intense epic video-game boss-battle orchestral score, aggressive low brass, pounding war percussion, a driving choir, relentless and heroic", seconds: 30 },
    layers: [
      { model: "mmaudio", name: "Arena ambience", duck: "ambience", place: "bed", prompt: "a massive echoing stone arena, low seismic rumble, crumbling rock, distant fire and wind", seconds: 12 },
      { model: "eleven-sfx", name: "Impact", duck: "impact", place: "climax", text: "a colossal stone impact quake and a deep monstrous roar", seconds: 4 }
    ]
  },
  {
    name: "PODCAST — The Late Shift",
    voiceTrackName: "Show",
    anchor: { prompt: 'The host (adult female, American accent, warm wry, relaxed, conversational) narrates: "Welcome back to the show."' },
    voice: [
      {
        model: "seed-scene",
        gap: 0.4,
        useAnchor: true,
        prompt:
          '[A cozy late-night radio studio, faint warm room tone, a soft coffee cup set down on the desk.] The host (voiced by @Audio1) says: "It is past midnight, and honestly, that is when the best stories finally show up." A caller (adult male, British accent, dry, amused, heard through a phone line) replies: "Which is exactly why I never call before the moon is up."'
      },
      { model: "seed-tts", clone: true, gap: 0.5, prompt: 'The host (voiced by @Audio1) narrates: "Tonight: the neighbor who mailed himself across the country, and lived to explain why. Stay with us."' }
    ],
    layers: [{ model: "mmaudio", name: "Studio bed", duck: "ambience", place: "bed", prompt: "a warm late-night radio studio room tone with a soft lo-fi jazz bed underneath", seconds: 12 }]
  }
];

const BASE_SYSTEM = `You are the creative director and audio producer for a text-to-audio studio. Turn the user's BRIEF into ONE finished audio piece as a single JSON SPEC. Output ONLY the JSON object — no markdown fences, no prose.

Build WHATEVER the brief calls for — a cinematic trailer, a two-host podcast, a radio ad, a guided meditation, a news bulletin, a character dialogue scene, a soundscape, an audiobook passage. Include ONLY the elements that fit that piece. A trailer wants a score and a big climax; a podcast wants none of that. Match the genre, not a fixed template.

SCHEMA (every string English only; anchor, score and outro are OPTIONAL — omit any that doesn't fit):
{
  "name": "SHORT TITLE — Subtitle",
  "voiceTrackName": "Scene" | "Narration" | "Voiceover" | "Show" | "Guide" | ...,
  "anchor": { "prompt": "The narrator (age, EXPLICIT accent, timbre, one emotion, pace) narrates: \\"one short establishing line.\\"" },
  "voice": [
    { "model": "seed-tts" | "seed-scene", "prompt": "...", "clone": true, "useAnchor": false, "climax": false, "gap": 0.5, "tail": 0.3, "extend": { "seconds": 8, "direction": "continue the same calm mood" } }
  ],
  "score": { "prompt": "music bed description", "seconds": 30 },
  "layers": [
    { "model": "mmaudio", "name": "Ambience", "duck": "ambience", "place": "bed", "prompt": "continuous ambience", "seconds": 12 },
    { "model": "eleven-sfx", "name": "Impact", "duck": "impact", "place": "climax", "text": "a one-shot sound", "seconds": 3 }
  ],
  "outro": { "prompt": "a closing line that fits the piece", "gap": 0.7 }
}

RULES:
- "voice" is required (1-4 segments). "anchor", "score", "outro" and "layers" are optional — include each ONLY if it serves the piece.
- CONSISTENT VOICE (optional): when a narrator/host recurs across lines, add an "anchor" (the full voice descriptor lives there), then every seed-tts line in that voice uses "clone": true written as 'The narrator (voiced by @Audio1)'. To reuse that voice for a character in a seed-scene, set "useAnchor": true and write '(voiced by @Audio1)'. If you DO NOT include an anchor, never write @Audio tags at all. Never invent tags beyond @Audio1.
- SCENES: use seed-scene for dialogue/characters. Start with a concrete [bracketed environment + ambience], then Named speakers with (age, EXPLICIT accent, timbre, one emotion, pace) and quoted dialogue, plus [bracketed sound events]. Every speaker needs an explicit accent.
- CLIMAX (optional): for dramatic pieces, one segment may set "climax": true (the loudest beat) with a "tail" ~1.2 to keep the payoff. Calm pieces have no climax.
- "extend" (optional): add to a segment only when a moment should breathe longer (a slow narration/reflective beat). Continues the same voice. Never extend punchy one-liners.
- LAYERS (0-4): continuous backgrounds → mmaudio, place "bed", duck "ambience". One-shot hits → eleven-sfx, place "climax"/"start", duck "impact" (punchy) or "foley" (soft).
- "outro" is just a fitting CLOSING LINE if the piece wants one (a sign-off, a tagline). It is NOT required, and it must NOT be a meta line about the audio being written/AI/not-recorded unless the brief explicitly asks for that.
- English only. No famous people, real public figures, copyrighted characters, or branded IP — invent originals.
- Keep it buildable: 1-4 voice segments, 0-4 layers, score 24-45 seconds when present.

Study these examples — a rich cinematic trailer, a game cutscene, and a lean podcast with NO score and NO closing line. Match the quality AND pick the shape that fits the brief:

${EXAMPLES.map((example, index) => `EXAMPLE ${index + 1}:\n${JSON.stringify(example, null, 2)}`).join("\n\n")}

Output the JSON object only.`;

export const normalizeCharacterNames = normalizeCinematicCharacterNames;

export function buildCinematicPlannerSystem(characterNames: string[]): string {
  const names = normalizeCharacterNames(characterNames);
  if (!names.length) return BASE_SYSTEM;

  return `${BASE_SYSTEM}

CAST MODE:
- AVAILABLE CAST: ${names.map((name) => `@${name}`).join(", ")}
- Do not create an anchor. Do not set clone or useAnchor.
- Use only the available cast for every speaking role; do not invent unsupplied speaking characters.
- Put the exact @Character alias in every relevant Seed prompt, including each speaker definition.
- Narration is allowed only through a supplied @Narrator character.`;
}
