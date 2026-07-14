import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { cleanModelOutput, extractText } from "@/lib/llm-text";
import { requireStudioApiAuth } from "@/lib/self-host-auth";

const system = `Return a 3-5 word Title Case name describing this generated audio. No quotes, no punctuation, no explanation.`;

function tidyTitle(text: string): string {
  return cleanModelOutput(text)
    .replace(/["'`.,:;!?]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

async function runFalLlm(prompt: string): Promise<string> {
  const result = await fal.subscribe("fal-ai/any-llm", {
    input: {
      model: process.env.AUDIO_STUDIO_NAME_MODEL ?? "openai/gpt-4o-mini",
      prompt: `${system}\n\nAUDIO PROMPT: ${prompt}`
    }
  });
  return extractText(result);
}

async function runOpenAi(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.AUDIO_STUDIO_NAME_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 30,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `AUDIO PROMPT: ${prompt}` }
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

  const body = (await request.json().catch(() => null)) as { prompt?: string } | null;
  if (!body?.prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!process.env.FAL_KEY && !apiKey) {
    return NextResponse.json({ error: "FAL_KEY or OPENAI_API_KEY is required" }, { status: 503 });
  }

  try {
    const raw = process.env.FAL_KEY ? await runFalLlm(body.prompt) : await runOpenAi(body.prompt, apiKey!);
    const title = tidyTitle(raw);
    if (!title) throw new Error("LLM returned an empty title");
    return NextResponse.json({ title });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
