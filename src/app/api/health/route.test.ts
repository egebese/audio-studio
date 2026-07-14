import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const AUTH_ENV_KEYS = [
  "FAL_KEY",
  "NODE_ENV",
  "STUDIO_PASSWORD",
  "STUDIO_SESSION_SECRET",
  "STUDIO_AUTH_DISABLED"
] as const;
const originalEnv = Object.fromEntries(
  AUTH_ENV_KEYS.map((key) => [key, process.env[key]])
);
const TEST_KEY_MATERIAL = [
  "j7bR4L9f2Qx8Wm5K",
  "p3Tn6Yv1Hs0DcUaZ"
].join("");

function setRuntimeEnv(values: Partial<Record<(typeof AUTH_ENV_KEYS)[number], string>>) {
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

beforeEach(() => setRuntimeEnv({}));

afterEach(() => {
  for (const key of AUTH_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

describe("GET /api/health", () => {
  it("reports ready when provider and production auth config are valid", async () => {
    setRuntimeEnv({
      NODE_ENV: "production",
      FAL_KEY: "example",
      STUDIO_PASSWORD: "example",
      STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
    });

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      falKeyConfigured: true,
      authMode: "enabled"
    });
  });

  it("reports not ready without FAL_KEY", async () => {
    setRuntimeEnv({
      NODE_ENV: "production",
      STUDIO_PASSWORD: "example",
      STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
    });

    const response = GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      falKeyConfigured: false,
      authMode: "enabled"
    });
  });

  it("reports not ready for missing or weak production auth", async () => {
    setRuntimeEnv({
      NODE_ENV: "production",
      FAL_KEY: "example",
      STUDIO_PASSWORD: "example",
      STUDIO_SESSION_SECRET: ["too", "short"].join("-")
    });

    const response = GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      falKeyConfigured: true,
      authMode: "invalid"
    });
  });

  it("accepts the explicit development-only auth bypass", async () => {
    setRuntimeEnv({
      NODE_ENV: "development",
      FAL_KEY: "example",
      STUDIO_AUTH_DISABLED: "true"
    });

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      falKeyConfigured: true,
      authMode: "disabled"
    });
  });
});
