import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { extractText } from "@/lib/llm-text";
import { validateCinematicSpec, type CinematicSpec } from "@/lib/cinematic-spec";
import {
  buildCinematicPlannerSystem,
  normalizeCharacterNames
} from "@/lib/cinematic-plan-prompt";
import { requireStudioApiAuth } from "@/lib/self-host-auth";

// The LLM authors a full cinematic-piece SPEC (JSON) from a loose brief. The client
// runner executes whichever optional elements fit: anchor/cloned VO, extensions,
// score/beds, and a closing line. Uses a strong Claude model on fal any-llm with
// generic planner examples spanning cinematic, game, and podcast shapes.

function parseSpecJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM output contained no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function planOnce(
  brief: string,
  characterNames: string[],
  correction?: string
): Promise<CinematicSpec> {
  const result = await fal.subscribe("fal-ai/any-llm", {
    input: {
      model: process.env.AUDIO_STUDIO_CINEMATIC_MODEL ?? "anthropic/claude-sonnet-4.5",
      system_prompt: buildCinematicPlannerSystem(characterNames),
      prompt: `BRIEF: ${brief}${correction ? `\n\nYour previous output was rejected: ${correction}. Return corrected JSON only.` : ""}`,
      temperature: 0.7
    }
  });
  return validateCinematicSpec(parseSpecJson(extractText(result)), {
    characterNames
  });
}

export async function POST(request: Request) {
  const unauthorized = requireStudioApiAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as {
    brief?: string;
    characterNames?: unknown;
  } | null;
  const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
  if (!brief) return NextResponse.json({ error: "A brief is required" }, { status: 400 });
  if (brief.length > 2000) return NextResponse.json({ error: "Brief is too long (2000 char max)" }, { status: 400 });
  let characterNames: string[];
  try {
    characterNames = normalizeCharacterNames(body?.characterNames);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
  if (!process.env.FAL_KEY) return NextResponse.json({ error: "FAL_KEY is required to plan a piece" }, { status: 503 });

  try {
    let spec: CinematicSpec;
    try {
      spec = await planOnce(brief, characterNames);
    } catch (first) {
      spec = await planOnce(
        brief,
        characterNames,
        first instanceof Error ? first.message : String(first)
      );
    }
    return NextResponse.json({ spec });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
