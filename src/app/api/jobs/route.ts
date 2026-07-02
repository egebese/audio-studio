import { NextResponse } from "next/server";
import { createJob, listJobs, runJob, validateJobRequest } from "@/server/jobs";

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(request: Request) {
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
  const finished = await runJob(job.id);
  return NextResponse.json({ job: finished });
}
