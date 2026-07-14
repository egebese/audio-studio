// Decoupled client-side job runner: POST /api/jobs, poll until done, return the output.
// Unlike studio's submitModelJob it carries no UI state, so the cinematic runner can call
// it many times over.

import { getModel } from "@/lib/model-catalog";
import type { Job, ModelOutput } from "@/lib/types";

const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60_000;

export async function runClientJob(modelId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ModelOutput> {
  const model = getModel(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId, operation: model.task, input }),
    signal
  });
  const data = (await response.json().catch(() => null)) as { job?: Job; error?: string } | null;
  if (!response.ok || !data?.job) throw new Error(data?.error ?? `${modelId} rejected (${response.status})`);

  let job = data.job;
  const started = Date.now();
  while (job.status !== "done" && job.status !== "error") {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`${modelId}: timed out`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const poll = await fetch(`/api/jobs/${job.id}`, { signal });
    if (!poll.ok) throw new Error(`${modelId}: job lost (dev server restarted?)`);
    const polled = (await poll.json()) as { job?: Job };
    if (polled.job) job = polled.job;
  }
  if (job.status === "error") throw new Error(job.error ?? `${modelId}: job failed`);
  const output = job.outputs?.[0];
  if (!output) throw new Error(`${modelId}: no output`);
  return output;
}
