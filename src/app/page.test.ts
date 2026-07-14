import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createStudioSessionToken, readStudioAuthConfig } from "@/lib/self-host-auth";
import Page from "./page";

vi.mock("@/components/studio", () => ({
  Studio: () => null
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn()
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  })
}));
vi.stubGlobal("React", React);

const AUTH_ENV_KEYS = [
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

beforeEach(() => {
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "production",
    STUDIO_PASSWORD: "example",
    STUDIO_SESSION_SECRET: TEST_KEY_MATERIAL
  });
  vi.mocked(cookies).mockReturnValue({
    get: vi.fn(() => undefined)
  } as never);
  vi.mocked(redirect).mockClear();
});

afterEach(() => {
  for (const key of AUTH_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

describe("studio page auth gate", () => {
  it("redirects before rendering when the session is missing", () => {
    expect(() => Page()).toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renders with a valid session", () => {
    const config = readStudioAuthConfig(process.env);
    if (config.mode !== "enabled") throw new Error("Expected enabled auth");
    const token = createStudioSessionToken(config);
    vi.mocked(cookies).mockReturnValue({
      get: vi.fn(() => ({ name: "studio_session", value: token }))
    } as never);

    expect(() => Page()).not.toThrow();
    expect(redirect).not.toHaveBeenCalled();
  });
});
