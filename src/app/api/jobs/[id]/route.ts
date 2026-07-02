import { NextResponse } from "next/server";
import { readJob } from "@/server/jobs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const job = readJob(params.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
