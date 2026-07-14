import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as describeAsset } from "./assets/describe/route";
import { POST as planCinematic } from "./cinematic/plan/route";
import { GET as readJob } from "./jobs/[id]/route";
import { GET as listJobs, POST as createJob } from "./jobs/route";
import { POST as enhancePrompt } from "./prompts/enhance/route";
import { POST as upload } from "./upload/route";

const AUTH_ENV_KEYS = [
  "NODE_ENV",
  "STUDIO_PASSWORD",
  "STUDIO_SESSION_SECRET",
  "STUDIO_AUTH_DISABLED"
] as const;
const originalEnv = Object.fromEntries(
  AUTH_ENV_KEYS.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: "production" });
});

afterEach(() => {
  for (const key of AUTH_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

describe("cost-bearing API routes", () => {
  it("rejects unauthenticated requests before route-specific work", async () => {
    const cases: Array<[string, () => Response | Promise<Response>]> = [
      [
        "GET /api/jobs",
        () => listJobs(new Request("http://studio.test/api/jobs"))
      ],
      [
        "POST /api/jobs",
        () =>
          createJob(
            new Request("http://studio.test/api/jobs", { method: "POST" })
          )
      ],
      [
        "GET /api/jobs/[id]",
        () =>
          readJob(new Request("http://studio.test/api/jobs/missing"), {
            params: { id: "missing" }
          })
      ],
      [
        "POST /api/upload",
        () =>
          upload(
            new Request("http://studio.test/api/upload", { method: "POST" })
          )
      ],
      [
        "POST /api/prompts/enhance",
        () =>
          enhancePrompt(
            new Request("http://studio.test/api/prompts/enhance", {
              method: "POST"
            })
          )
      ],
      [
        "POST /api/assets/describe",
        () =>
          describeAsset(
            new Request("http://studio.test/api/assets/describe", {
              method: "POST"
            })
          )
      ],
      [
        "POST /api/cinematic/plan",
        () =>
          planCinematic(
            new Request("http://studio.test/api/cinematic/plan", {
              method: "POST"
            })
          )
      ]
    ];

    for (const [name, call] of cases) {
      const response = await call();
      expect(response.status, name).toBe(401);
      await expect(response.json(), name).resolves.toEqual({
        error: "Unauthorized"
      });
    }
  });
});
