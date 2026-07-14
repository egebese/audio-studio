import { describe, expect, it } from "vitest";
import {
  STUDIO_SESSION_COOKIE,
  STUDIO_SESSION_TTL_SECONDS,
  createLoginThrottle,
  createStudioSessionToken,
  getLoginThrottleKey,
  readStudioAuthConfig,
  requireStudioApiAuth,
  serializeStudioSessionCookie,
  verifyStudioPassword,
  verifyStudioSessionToken,
  type EnabledStudioAuthConfig
} from "./self-host-auth";

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const TEST_CREDENTIAL = ["correct", "horse", "battery", "staple"].join(" ");
const TEST_KEY_MATERIAL = [
  "j7bR4L9f2Qx8Wm5K",
  "p3Tn6Yv1Hs0DcUaZ"
].join("");
const LOW_ENTROPY_KEY_MATERIAL = ["password", "password", "password", "password"].join("");

function enabledConfig(): EnabledStudioAuthConfig {
  const config = readStudioAuthConfig({
    NODE_ENV: "production",
    STUDIO_PASSWORD: TEST_CREDENTIAL,
    STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
  });
  if (config.mode !== "enabled") throw new Error("Expected enabled auth config");
  return config;
}

function requestWithToken(token: string, url = "http://studio.test/"): Request {
  return new Request(url, {
    headers: { cookie: `${STUDIO_SESSION_COOKIE}=${token}` }
  });
}

describe("studio auth configuration", () => {
  it("enables auth when password and a strong session secret are configured", () => {
    expect(enabledConfig().mode).toBe("enabled");
  });

  it("fails closed when auth values are missing or weak", () => {
    expect(readStudioAuthConfig({ NODE_ENV: "production" }).mode).toBe("invalid");
    expect(
      readStudioAuthConfig({
        NODE_ENV: "production",
        STUDIO_PASSWORD: TEST_CREDENTIAL,
        STUDIO_SESSION_SECRET: ["too", "short"].join("-")
      }).mode
    ).toBe("invalid");
    expect(
      readStudioAuthConfig({
        NODE_ENV: "development",
        STUDIO_PASSWORD: " ",
        STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
      }).mode
    ).toBe("invalid");
  });

  it("rejects long but predictably repeated session secrets", () => {
    expect(
      readStudioAuthConfig({
        NODE_ENV: "production",
        STUDIO_PASSWORD: TEST_CREDENTIAL,
        STUDIO_SESSION_SECRET: LOW_ENTROPY_KEY_MATERIAL
      }).mode
    ).toBe("invalid");
  });

  it("allows explicit bypass in development and rejects it in production", () => {
    expect(
      readStudioAuthConfig({
        NODE_ENV: "development",
        STUDIO_AUTH_DISABLED: "true"
      }).mode
    ).toBe("disabled");
    expect(
      readStudioAuthConfig({
        NODE_ENV: "production",
        STUDIO_AUTH_DISABLED: "true"
      }).mode
    ).toBe("invalid");
  });

  it("fails closed when bypass is requested outside explicit development", () => {
    expect(
      readStudioAuthConfig({
        STUDIO_AUTH_DISABLED: "true"
      }).mode
    ).toBe("invalid");
    expect(
      readStudioAuthConfig({
        NODE_ENV: "staging",
        STUDIO_AUTH_DISABLED: "true"
      }).mode
    ).toBe("invalid");
  });

  it("ignores the bypass switch in production when valid auth is configured", () => {
    expect(
      readStudioAuthConfig({
        NODE_ENV: "production",
        STUDIO_AUTH_DISABLED: "true",
        STUDIO_PASSWORD: TEST_CREDENTIAL,
        STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
      }).mode
    ).toBe("enabled");
  });
});

describe("studio session tokens", () => {
  it("accepts a valid signed token during its seven-day lifetime", () => {
    const config = enabledConfig();
    const token = createStudioSessionToken(config, NOW);

    expect(verifyStudioSessionToken(token, config, NOW)).toBe(true);
    expect(
      verifyStudioSessionToken(
        token,
        config,
        NOW + STUDIO_SESSION_TTL_SECONDS * 1000 - 1
      )
    ).toBe(true);
  });

  it("rejects an expired token", () => {
    const config = enabledConfig();
    const token = createStudioSessionToken(config, NOW);

    expect(
      verifyStudioSessionToken(
        token,
        config,
        NOW + STUDIO_SESSION_TTL_SECONDS * 1000
      )
    ).toBe(false);
  });

  it("rejects a tampered token", () => {
    const config = enabledConfig();
    const token = createStudioSessionToken(config, NOW);
    const [payload, signature] = token.split(".");
    const replacement = signature.endsWith("A") ? "B" : "A";

    expect(
      verifyStudioSessionToken(
        `${payload}.${signature.slice(0, -1)}${replacement}`,
        config,
        NOW
      )
    ).toBe(false);
  });

  it("rejects malformed tokens", () => {
    const config = enabledConfig();

    for (const token of ["", "not-a-token", "a.b.c", "*.signature", "e30.bad"]) {
      expect(verifyStudioSessionToken(token, config, NOW)).toBe(false);
    }
  });

  it("rejects a token issued in the future", () => {
    const config = enabledConfig();
    const token = createStudioSessionToken(config, NOW + 1000);

    expect(verifyStudioSessionToken(token, config, NOW)).toBe(false);
  });

  it("checks passwords without accepting near matches", () => {
    const config = enabledConfig();

    expect(verifyStudioPassword(TEST_CREDENTIAL, config)).toBe(true);
    expect(verifyStudioPassword("correct horse battery staplf", config)).toBe(false);
    expect(verifyStudioPassword("", config)).toBe(false);
  });
});

describe("studio session cookie", () => {
  it("uses stable strict HttpOnly cookie flags", () => {
    const cookie = serializeStudioSessionCookie(
      "signed-token",
      new Request("http://studio.test/"),
      NOW
    );

    expect(cookie).toContain(`${STUDIO_SESSION_COOKIE}=signed-token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${STUDIO_SESSION_TTL_SECONDS}`);
    expect(cookie).not.toContain("Secure");
  });

  it("keeps direct HTTPS authoritative", () => {
    expect(
      serializeStudioSessionCookie(
        "token",
        new Request("https://studio.test/", {
          headers: { "x-forwarded-proto": "https, http" }
        }),
        NOW
      )
    ).toContain("Secure");
  });

  it("uses the rightmost forwarding hop for the Secure flag", () => {
    expect(
      serializeStudioSessionCookie(
        "token",
        new Request("http://studio.test/", {
          headers: { "x-forwarded-proto": "http, https" }
        }),
        NOW
      )
    ).toContain("Secure");
    expect(
      serializeStudioSessionCookie(
        "token",
        new Request("http://studio.test/", {
          headers: { "x-forwarded-proto": "https, http" }
        }),
        NOW
      )
    ).not.toContain("Secure");
  });

  it("ignores malformed and oversized forwarding headers", () => {
    for (const forwardedProto of [
      "https, ftp",
      `https,${"x".repeat(512)}`
    ]) {
      expect(
        serializeStudioSessionCookie(
          "token",
          new Request("http://studio.test/", {
            headers: { "x-forwarded-proto": forwardedProto }
          }),
          NOW
        )
      ).not.toContain("Secure");
    }
  });
});

describe("API authorization", () => {
  it("returns a generic JSON 401 for an unauthenticated request", async () => {
    const env = {
      NODE_ENV: "production",
      STUDIO_PASSWORD: TEST_CREDENTIAL,
      STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
    };
    const response = requireStudioApiAuth(
      new Request("https://studio.test/api/jobs"),
      env,
      NOW
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("authorizes a valid cookie and the explicit development bypass", () => {
    const config = enabledConfig();
    const token = createStudioSessionToken(config, NOW);

    expect(
      requireStudioApiAuth(
        requestWithToken(token, "https://studio.test/api/jobs"),
        {
          NODE_ENV: "production",
          STUDIO_PASSWORD: config.password,
          STUDIO_SESSION_SECRET: config.sessionSecret
        },
        NOW
      )
    ).toBeNull();
    expect(
      requireStudioApiAuth(
        new Request("http://studio.test/api/jobs"),
        {
          NODE_ENV: "development",
          STUDIO_AUTH_DISABLED: "true"
        },
        NOW
      )
    ).toBeNull();
  });
});

describe("login throttling", () => {
  it("blocks after the configured number of failures and reports retry time", () => {
    const throttle = createLoginThrottle({
      maxFailures: 2,
      windowMs: 10_000,
      maxEntries: 10
    });

    expect(throttle.check("client", 0)).toEqual({ allowed: true });
    throttle.recordFailure("client", 0);
    throttle.recordFailure("client", 1000);

    expect(throttle.check("client", 1000)).toEqual({
      allowed: false,
      retryAfterSeconds: 9
    });
    expect(throttle.check("client", 10_000)).toEqual({ allowed: true });
  });

  it("clears failures after a successful login", () => {
    const throttle = createLoginThrottle({
      maxFailures: 1,
      windowMs: 10_000,
      maxEntries: 10
    });
    throttle.recordFailure("client", 0);
    expect(throttle.check("client", 1).allowed).toBe(false);

    throttle.clear("client");

    expect(throttle.check("client", 1)).toEqual({ allowed: true });
  });

  it("evicts old entries to stay bounded", () => {
    const throttle = createLoginThrottle({
      maxFailures: 1,
      windowMs: 10_000,
      maxEntries: 2
    });
    throttle.recordFailure("oldest", 0);
    throttle.recordFailure("middle", 1);
    throttle.recordFailure("newest", 2);

    expect(throttle.check("oldest", 3)).toEqual({ allowed: true });
    expect(throttle.check("middle", 3).allowed).toBe(false);
    expect(throttle.check("newest", 3).allowed).toBe(false);
  });

  it("uses only the validated nearest address from forwarding headers", () => {
    expect(
      getLoginThrottleKey(
        new Request("http://studio.test/api/auth/login", {
          headers: {
            "x-forwarded-for": "203.0.113.7, 10.0.0.2",
            "x-real-ip": "198.51.100.9"
          }
        })
      )
    ).toBe("ip:10.0.0.2");
    expect(
      getLoginThrottleKey(
        new Request("http://studio.test/api/auth/login", {
          headers: {
            "x-forwarded-for": "not-an-ip",
            "x-real-ip": "198.51.100.9"
          }
        })
      )
    ).toBe("ip:198.51.100.9");
    expect(
      getLoginThrottleKey(
        new Request("http://studio.test/api/auth/login", {
          headers: { "x-forwarded-for": "not-an-ip" }
        })
      )
    ).toBe("ip:unknown");
  });
});
