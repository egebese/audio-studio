import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/self-host-auth";
import { createJob, listJobs, runJob, validateJobRequest } from "@/server/jobs";

export async function GET(request: Request) {
  const unauthorized = requireStudioApiAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(request: Request) {
  const unauthorized = requireStudioApiAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => null)) as
    | {
        modelId?: string;
        operation?: string;
        input?: Record<string, unknown>;
        sourceAssetIds?: string[];
      }
    | null;

  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const error = validateJobRequest(body);
  if (error) return NextResponse.json({ error }, { status: 422 });
  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: "FAL_KEY is required for live model jobs" }, { status: 503 });
  }

  const job = createJob({
    modelId: body.modelId!,
    operation: body.operation!,
    input: body.input ?? {},
    sourceAssetIds: body.sourceAssetIds ?? []
  });
  // ponytail: fire-and-forget suits the local dev server; use waitUntil if this ever deploys serverless
  void runJob(job.id);
  return NextResponse.json({ job });
}
