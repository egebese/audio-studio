import { serializeClearedStudioSessionCookie } from "@/lib/self-host-auth";

export function POST(request: Request): Response {
  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": serializeClearedStudioSessionCookie(request)
      }
    }
  );
}
