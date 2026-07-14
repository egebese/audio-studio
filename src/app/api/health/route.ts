import { readStudioAuthConfig } from "@/lib/self-host-auth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const falKeyConfigured = Boolean(process.env.FAL_KEY?.trim());
  const auth = readStudioAuthConfig();
  const ready = falKeyConfigured && auth.mode !== "invalid";

  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      falKeyConfigured,
      authMode: auth.mode
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" }
    }
  );
}
