import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/self-host-auth";
import { readJob } from "@/server/jobs";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const unauthorized = requireStudioApiAuth(request);
  if (unauthorized) return unauthorized;

  const job = readJob(params.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
