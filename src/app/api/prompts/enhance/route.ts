import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { getModel } from "@/lib/model-catalog";
import { lintPrompt } from "@/lib/prompt-intelligence";

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

const genericAudioSystem = `Rewrite the user's loose audio request into one concise production-ready prompt for the selected audio model.
Output the prompt only. Preserve intent, remove typos, add concrete sonic details, avoid famous people, copyrighted characters, branded IP, and imitation requests.`;

function cleanModelOutput(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function removeUnusedVoiceTags(prompt: string): string {
  return prompt.replace(/\s*voiced by @Audio\d+/g, "").replace(/\s*@Audio\d+/g, "");
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).find(Boolean) ?? "";
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["output", "text", "response", "content", "message", "data"]) {
    const text = extractText(record[key]);
    if (text) return text;
  }
  return extractText(record.choices);
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
  const system = model.task === "scene" ? seedSceneSystem : genericAudioSystem;
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
