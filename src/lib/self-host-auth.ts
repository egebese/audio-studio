import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const STUDIO_SESSION_COOKIE = "studio_session";
export const STUDIO_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const MIN_SESSION_SECRET_BYTES = 32;
const DEFAULT_THROTTLE_FAILURES = 5;
const DEFAULT_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_THROTTLE_ENTRIES = 1024;
const MAX_FORWARDED_HEADER_LENGTH = 512;

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

export type EnabledStudioAuthConfig = {
  mode: "enabled";
  password: string;
  sessionSecret: string;
};

export type StudioAuthConfig =
  | EnabledStudioAuthConfig
  | { mode: "disabled" }
  | { mode: "invalid" };

export type LoginThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type LoginThrottle = {
  check(key: string, now?: number): LoginThrottleDecision;
  recordFailure(key: string, now?: number): void;
  clear(key: string): void;
};

function hasStrongSessionSecret(secret: string | undefined): secret is string {
  return Boolean(
    secret &&
      Buffer.byteLength(secret, "utf8") >= MIN_SESSION_SECRET_BYTES &&
      !/^(.+)\1+$/.test(secret)
  );
}

export function readStudioAuthConfig(
  env: AuthEnvironment = process.env
): StudioAuthConfig {
  if (env.NODE_ENV === "development" && env.STUDIO_AUTH_DISABLED === "true") {
    return { mode: "disabled" };
  }

  const password = env.STUDIO_PASSWORD;
  const sessionSecret = env.STUDIO_SESSION_SECRET;
  if (!password?.trim() || !hasStrongSessionSecret(sessionSecret)) {
    return { mode: "invalid" };
  }

  return { mode: "enabled", password, sessionSecret };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyStudioPassword(
  candidate: string,
  config: EnabledStudioAuthConfig
): boolean {
  return timingSafeEqual(digest(candidate), digest(config.password));
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

function signaturesMatch(expected: Buffer, actual: Buffer | null): boolean {
  const hasExpectedLength = actual?.length === expected.length;
  const comparable = hasExpectedLength ? actual : Buffer.alloc(expected.length);
  return timingSafeEqual(expected, comparable) && hasExpectedLength;
}

export function createStudioSessionToken(
  config: EnabledStudioAuthConfig,
  now = Date.now()
): string {
  const issuedAt = Math.floor(now / 1000);
  const payload = encodeBase64Url(
    JSON.stringify({
      v: 1,
      iat: issuedAt,
      exp: issuedAt + STUDIO_SESSION_TTL_SECONDS
    })
  );
  return `${payload}.${encodeBase64Url(sign(payload, config.sessionSecret))}`;
}

export function verifyStudioSessionToken(
  token: string,
  config: EnabledStudioAuthConfig,
  now = Date.now()
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, encodedSignature] = parts;
  const payloadBytes = decodeBase64Url(encodedPayload);
  const signature = decodeBase64Url(encodedSignature);
  const expectedSignature = sign(encodedPayload, config.sessionSecret);
  if (!payloadBytes || !signaturesMatch(expectedSignature, signature)) return false;

  try {
    const payload = JSON.parse(payloadBytes.toString("utf8")) as {
      v?: unknown;
      iat?: unknown;
      exp?: unknown;
    };
    if (
      payload.v !== 1 ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp)
    ) {
      return false;
    }

    const issuedAt = payload.iat as number;
    const expiresAt = payload.exp as number;
    const nowSeconds = Math.floor(now / 1000);
    return (
      issuedAt <= nowSeconds &&
      expiresAt > nowSeconds &&
      expiresAt > issuedAt &&
      expiresAt - issuedAt <= STUDIO_SESSION_TTL_SECONDS
    );
  } catch {
    return false;
  }
}

function requestUsesHttps(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  const forwardedHeader = request.headers.get("x-forwarded-proto");
  if (
    !forwardedHeader ||
    forwardedHeader.length > MAX_FORWARDED_HEADER_LENGTH
  ) {
    return false;
  }
  const forwardedProto = forwardedHeader.split(",").at(-1)?.trim().toLowerCase();
  return forwardedProto === "https";
}

function cookieSecuritySuffix(request: Request): string {
  return requestUsesHttps(request) ? "; Secure" : "";
}

export function serializeStudioSessionCookie(
  token: string,
  request: Request,
  now = Date.now()
): string {
  const expires = new Date(
    now + STUDIO_SESSION_TTL_SECONDS * 1000
  ).toUTCString();
  return [
    `${STUDIO_SESSION_COOKIE}=${token}`,
    `Max-Age=${STUDIO_SESSION_TTL_SECONDS}`,
    `Expires=${expires}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/"
  ].join("; ") + cookieSecuritySuffix(request);
}

export function serializeClearedStudioSessionCookie(request: Request): string {
  return [
    `${STUDIO_SESSION_COOKIE}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/"
  ].join("; ") + cookieSecuritySuffix(request);
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isStudioSessionAuthorized(
  token: string | undefined,
  env: AuthEnvironment = process.env,
  now = Date.now()
): boolean {
  const config = readStudioAuthConfig(env);
  if (config.mode === "disabled") return true;
  return Boolean(
    config.mode === "enabled" &&
      token &&
      verifyStudioSessionToken(token, config, now)
  );
}

export function isStudioRequestAuthorized(
  request: Request,
  env: AuthEnvironment = process.env,
  now = Date.now()
): boolean {
  return isStudioSessionAuthorized(
    readCookie(request, STUDIO_SESSION_COOKIE),
    env,
    now
  );
}

export function requireStudioApiAuth(
  request: Request,
  env: AuthEnvironment = process.env,
  now = Date.now()
): Response | null {
  if (isStudioRequestAuthorized(request, env, now)) return null;
  return Response.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: { "cache-control": "no-store" }
    }
  );
}

function forwardedIp(request: Request): string | undefined {
  const forwardedHeader = request.headers.get("x-forwarded-for");
  const forwardedChain =
    forwardedHeader &&
    forwardedHeader.length <= MAX_FORWARDED_HEADER_LENGTH
      ? forwardedHeader.split(",")
      : [];
  const forwarded = forwardedChain.at(-1)?.trim();
  if (forwarded && forwarded.length <= 64 && isIP(forwarded)) return forwarded;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && realIp.length <= 64 && isIP(realIp)) return realIp;
  return undefined;
}

export function getLoginThrottleKey(request: Request): string {
  return `ip:${forwardedIp(request) ?? "unknown"}`;
}

export function createLoginThrottle(
  options: {
    maxFailures?: number;
    windowMs?: number;
    maxEntries?: number;
  } = {}
): LoginThrottle {
  const maxFailures = Math.max(
    1,
    Math.floor(options.maxFailures ?? DEFAULT_THROTTLE_FAILURES)
  );
  const windowMs = Math.max(
    1,
    Math.floor(options.windowMs ?? DEFAULT_THROTTLE_WINDOW_MS)
  );
  const maxEntries = Math.max(
    1,
    Math.floor(options.maxEntries ?? DEFAULT_THROTTLE_ENTRIES)
  );
  const entries = new Map<string, { failures: number; resetAt: number }>();

  function cleanup(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    check(key, now = Date.now()) {
      cleanup(now);
      const entry = entries.get(key);
      if (!entry || entry.failures < maxFailures) return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      };
    },
    recordFailure(key, now = Date.now()) {
      cleanup(now);
      const current = entries.get(key);
      if (current) {
        current.failures += 1;
        return;
      }
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { failures: 1, resetAt: now + windowMs });
    },
    clear(key) {
      entries.delete(key);
    }
  };
}
