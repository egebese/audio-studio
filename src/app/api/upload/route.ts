import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { requireStudioApiAuth } from "@/lib/self-host-auth";

export async function POST(request: Request) {
  const unauthorized = requireStudioApiAuth(request);
  if (unauthorized) return unauthorized;

  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY is required for uploads" }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    const url = await fal.storage.upload(file);
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
