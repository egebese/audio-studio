import {
  createLoginThrottle,
  createStudioSessionToken,
  getLoginThrottleKey,
  readStudioAuthConfig,
  serializeStudioSessionCookie,
  verifyStudioPassword
} from "@/lib/self-host-auth";

const loginThrottle = createLoginThrottle();

function errorResponse(
  status: 401 | 429,
  retryAfterSeconds?: number
): Response {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(retryAfterSeconds);
  }
  return Response.json(
    { error: "Unable to sign in" },
    { status, headers }
  );
}

export async function POST(request: Request): Promise<Response> {
  const now = Date.now();
  const throttleKey = getLoginThrottleKey(request);
  const decision = loginThrottle.check(throttleKey, now);
  if (!decision.allowed) {
    return errorResponse(429, decision.retryAfterSeconds);
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const password = body?.password;
  const config = readStudioAuthConfig();

  if (config.mode === "disabled") {
    loginThrottle.clear(throttleKey);
    return Response.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const passwordMatches =
    config.mode === "enabled" &&
    typeof password === "string" &&
    password.length <= 4096 &&
    verifyStudioPassword(password, config);
  if (!passwordMatches) {
    loginThrottle.recordFailure(throttleKey, now);
    return errorResponse(401);
  }

  loginThrottle.clear(throttleKey);
  const token = createStudioSessionToken(config, now);
  return Response.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": serializeStudioSessionCookie(token, request, now)
      }
    }
  );
}
