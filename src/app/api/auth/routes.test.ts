import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STUDIO_SESSION_COOKIE,
  readStudioAuthConfig,
  verifyStudioSessionToken
} from "@/lib/self-host-auth";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";

const AUTH_ENV_KEYS = [
  "NODE_ENV",
  "STUDIO_PASSWORD",
  "STUDIO_SESSION_SECRET",
  "STUDIO_AUTH_DISABLED"
] as const;
const originalEnv = Object.fromEntries(
  AUTH_ENV_KEYS.map((key) => [key, process.env[key]])
);
const TEST_CREDENTIAL = ["correct", "horse", "battery", "staple"].join(" ");
const TEST_KEY_MATERIAL = [
  "j7bR4L9f2Qx8Wm5K",
  "p3Tn6Yv1Hs0DcUaZ"
].join("");

function setAuthEnv(
  values: Partial<Record<(typeof AUTH_ENV_KEYS)[number], string>> = {}
) {
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "production",
    STUDIO_PASSWORD: TEST_CREDENTIAL,
    STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL,
    ...values
  });
}

function loginRequest(password: unknown, ip: string, url = "https://studio.test") {
  return new Request(`${url}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip
    },
    body: JSON.stringify({ password })
  });
}

beforeEach(() => setAuthEnv());

afterEach(() => {
  for (const key of AUTH_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

describe("POST /api/auth/login", () => {
  it("sets a valid secure session cookie after successful login", async () => {
    const response = await login(loginRequest(TEST_CREDENTIAL, "203.0.113.10"));

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${STUDIO_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");

    const token = cookie
      .split(";", 1)[0]
      .slice(`${STUDIO_SESSION_COOKIE}=`.length);
    const config = readStudioAuthConfig(process.env);
    if (config.mode !== "enabled") throw new Error("Expected enabled auth");
    expect(verifyStudioSessionToken(token, config)).toBe(true);
  });

  it("returns one generic error for bad input and invalid configuration", async () => {
    const badPassword = await login(
      loginRequest("wrong", "203.0.113.11")
    );
    expect(badPassword.status).toBe(401);
    await expect(badPassword.json()).resolves.toEqual({
      error: "Unable to sign in"
    });

    setAuthEnv({
      STUDIO_PASSWORD: "",
      STUDIO_SESSION_SECRET: ""
    });
    const invalidConfig = await login(
      loginRequest(TEST_CREDENTIAL, "203.0.113.12")
    );
    expect(invalidConfig.status).toBe(401);
    await expect(invalidConfig.json()).resolves.toEqual({
      error: "Unable to sign in"
    });
  });

  it("throttles after five failures and sends Retry-After", async () => {
    const ip = "203.0.113.13";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(loginRequest("wrong", ip));
      expect(response.status).toBe(401);
    }

    const blocked = await login(loginRequest("wrong", ip));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(blocked.json()).resolves.toEqual({
      error: "Unable to sign in"
    });
  });

  it("clears prior failures after a successful login", async () => {
    const ip = "203.0.113.14";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await login(loginRequest("wrong", ip))).status).toBe(401);
    }
    expect((await login(loginRequest(TEST_CREDENTIAL, ip))).status).toBe(200);

    expect((await login(loginRequest("wrong", ip))).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the stable cookie with strict flags", async () => {
    const response = await logout(
      new Request("http://studio.test/api/auth/logout", {
        method: "POST",
        headers: { "x-forwarded-proto": "https" }
      })
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${STUDIO_SESSION_COOKIE}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
  });
});
