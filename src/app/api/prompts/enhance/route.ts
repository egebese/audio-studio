import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { getModel } from "@/lib/model-catalog";
import { cleanModelOutput, extractText } from "@/lib/llm-text";
import { lintPrompt } from "@/lib/prompt-intelligence";
import { requireStudioApiAuth } from "@/lib/self-host-auth";

const seedSceneSystem = `You are a prompt engineer for bytedance/seed-audio-1.0 scene prompts.
Turn the user's loose request into ONE finished audio scene prompt only. No markdown. No explanation.
The prompt must render voices, music, SFX and ambience in one call.
Hard rules:
- 2048 characters max.
- English or Chinese only.
- No famous people, public figures, copyrighted characters, branded IP, or imitation requests.
- Start with concrete ambience/SFX in square brackets.
- Use named speakers, delivery verbs, and quoted dialogue: Name (...) says/reports: "Line."
- No orphan quotes. Every quoted line must be directly attached to a named speaker.
- Every introduced speaker has parenthesized voice attributes: gender/age, explicit accent, timbre, one emotion, pace.
- Preserve requested roles, scene order, gender, and character identity details when safe.
- If race or ethnicity is requested, keep it as character identity, not as an accent. Use a geographic accent like American, British, or neutral.
- Example: "sports reporter which is also black male" becomes "Sports Reporter (young adult Black male, American accent, ...)".
- If there is no VOICES list, never use @Audio tags.
- Name SFX/music concretely in square brackets. Never write vague [music], [sound], [noise], or [sfx].
- Do not label transitions as "Transition SFX"; write the actual cue, like [clean broadcast whoosh].
- If reference voices are listed as @Audio1, @Audio2, every spoken line by that speaker must include "voiced by @AudioN".
Output the final scene prompt only.`;

const seedTtsSystem = `You are a prompt engineer for bytedance/seed-audio-1.0 plain speech prompts (no music, no SFX, no ambience).
Turn the user's raw text or loose request into ONE finished speech prompt. Output the prompt only. No markdown. No explanation.
Format (always this shape, repeated per spoken segment):
Speaker (gender, age, ACCENT, timbre, single emotion, pace) <delivery verb>: "Line."
Hard rules:
- 2048 characters max. Target under ~2 minutes of speech. English or Chinese only.
- Speech only: no background music, no ambience, no sound effects, no bracketed scene cues of any kind.
- Default is ONE speaker. BUT if the user's request describes multiple speakers, segments, or handoffs, include EVERY requested speaker in the requested order. NEVER drop, merge, or reorder requested speakers or segments.
- Every speaker keeps parenthesized voice attributes with an explicit accent (American accent, British accent, neutral accent, ...) EVERY time they speak. Never write "no accent" or other negative voice instructions.
- Preserve requested roles, segment order, gender, and character identity details. If race or ethnicity is requested, keep it as character identity, not as an accent: "sports reporter which is also black male" becomes "The sports reporter (young adult Black male, American accent, ...)".
- Each speaker keeps ONE consistent emotion, timbre, and pace.
- If the user supplies exact text to speak, keep their wording verbatim inside the quotes (fix only obvious typos). If it is a loose idea or only describes the structure, write short finished lines for every requested segment.
- No famous people, public figures, copyrighted characters, branded IP, or imitation requests. Invent original speakers.
- If reference voices are listed as @Audio1, @Audio2, ..., every line spoken by that speaker must include "voiced by @AudioN" right after the parenthesized attributes. Treat any "@Name" in the request as that reference voice. Never invent @Audio tags that are not listed.
- Attribute menu: timbre crystalline/gravelly/raspy/booming/airy/breathy/resonant; emotion calm/grave/playful/tender/exhilarated/weary; pace slow deliberate/measured/medium/fast/clipped; verbs says/narrates/announces/reports/whispers/murmurs/proclaims.
Example (single voice):
The narrator (middle-aged male, British accent, warm resonant, calm, measured) narrates: "Every great library begins with a single shelf, and every shelf with a single book."
Example (requested handoffs — every requested speaker kept, in order):
The news presenter (middle-aged male, American accent, resonant, composed, medium) announces: "Good evening. Storm cleanup continues across the harbor district — but first, the game everyone is talking about." The sports reporter (young adult Black male, American accent, bright energetic, upbeat, fast) reports: "Thanks, Alan. The Harbor City Comets pulled off a stunner tonight, thirty-one to twenty-eight in the final second." The weather presenter (adult female, American accent, warm clear, friendly, measured) says: "And that winning streak comes with sunshine — clear skies and a mild breeze through the weekend."
Output the finished prompt only.`;

const genericAudioSystem = `Rewrite the user's loose audio request into one concise production-ready prompt for the selected audio model.
Output the prompt only. Preserve intent, remove typos, add concrete sonic details, avoid famous people, copyrighted characters, branded IP, and imitation requests.`;

function removeUnusedVoiceTags(prompt: string): string {
  return prompt.replace(/\s*voiced by @Audio\d+/g, "").replace(/\s*@Audio\d+/g, "");
}

async function runFalLlm(system: string, user: string): Promise<string> {
  const result = await fal.subscribe("fal-ai/any-llm", {
    input: {
      model: process.env.AUDIO_STUDIO_PROMPT_MODEL ?? "openai/gpt-4o",
      prompt: `${system}\n\n${user}`
    }
  });
  return extractText(result);
}

async function runOpenAi(system: string, user: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.AUDIO_STUDIO_PROMPT_MODEL ?? "gpt-4o-mini",
      temperature: 0.25,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenAI failed with ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function POST(request: Request) {
  const unauthorized = requireStudioApiAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as
    | { modelId?: string; raw?: string; voiceNames?: string[] }
    | null;

  if (!body?.modelId || typeof body.raw !== "string") {
    return NextResponse.json({ error: "modelId and raw are required" }, { status: 400 });
  }

  const model = getModel(body.modelId);
  if (!model?.enhancesPrompt) {
    return NextResponse.json({ error: "model does not support prompt enhancement" }, { status: 422 });
  }

  const voiceNames = Array.isArray(body.voiceNames)
    ? body.voiceNames.filter((name): name is string => typeof name === "string").slice(0, 3)
    : [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!process.env.FAL_KEY && !apiKey) {
    return NextResponse.json({ error: "FAL_KEY or OPENAI_API_KEY is required for prompt enhancement" }, { status: 503 });
  }

  const voices = voiceNames.length
    ? `\nVOICES: [${voiceNames.map((name, i) => `@Audio${i + 1} = ${name}`).join(", ")}]`
    : "";
  const system =
    model.task === "scene" ? seedSceneSystem : model.id === "seed-tts" ? seedTtsSystem : genericAudioSystem;
  const user = `MODEL: ${model.label} / ${model.task}${voices}\nREQUEST: ${body.raw}`;

  try {
    const llmText = process.env.FAL_KEY ? await runFalLlm(system, user) : await runOpenAi(system, user, apiKey!);
    const output = cleanModelOutput(llmText);
    const enhanced = voiceNames.length ? output : removeUnusedVoiceTags(output);
    if (!enhanced) throw new Error("LLM returned an empty prompt");

    const lint = lintPrompt(model.id, enhanced);
    if (lint.blocked) {
      return NextResponse.json({ error: lint.warnings[0] ?? "Prompt failed validation", warnings: lint.warnings }, { status: 422 });
    }

    return NextResponse.json({ enhanced, source: "llm", warnings: lint.warnings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
