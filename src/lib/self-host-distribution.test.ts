import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const describePrivate = existsSync(
  join(projectRoot, "distribution/public-files.json")
)
  ? describe
  : describe.skip;
const fixtureRoots: string[] = [];

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readRootFile(relativePath: string): Promise<string> {
  return readFile(join(projectRoot, relativePath), "utf8");
}

function parseEnv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

function envLine(name: string, value: string): string {
  return `${name}=${value}`;
}

type InstallFixture = {
  root: string;
  bin: string;
  callsPath: string;
  env: NodeJS.ProcessEnv;
};

async function createInstallFixture(pullFails = false): Promise<InstallFixture> {
  const installPath = join(projectRoot, "install.sh");
  const composePath = join(projectRoot, "compose.yaml");
  expect(await pathExists(installPath), "install.sh should exist").toBe(true);
  expect(await pathExists(composePath), "compose.yaml should exist").toBe(true);

  const root = await mkdtemp(join(tmpdir(), "audio-studio-install-"));
  fixtureRoots.push(root);
  const bin = join(root, "bin");
  const callsPath = join(root, "docker-calls.log");
  await mkdir(bin);
  await Promise.all([
    copyFile(installPath, join(root, "install.sh")),
    copyFile(composePath, join(root, "compose.yaml")),
    writeFile(callsPath, "")
  ]);

  const fakeDocker = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_DOCKER_CALLS"
if [ "\${1-}" = "compose" ] && [ "\${2-}" = "pull" ] && [ "\${FAKE_PULL_FAIL-0}" = "1" ]; then
  exit 1
fi
if [ "\${1-}" = "compose" ] && [ "\${2-}" = "ps" ] && [ "\${3-}" = "-q" ]; then
  printf '%s\\n' "container-id"
fi
if [ "\${1-}" = "inspect" ]; then
  printf '%s\\n' "healthy"
fi
`;
  const fakeDockerPath = join(bin, "docker");
  await writeFile(fakeDockerPath, fakeDocker);
  await Promise.all([
    chmod(fakeDockerPath, 0o755),
    chmod(join(root, "install.sh"), 0o755)
  ]);

  return {
    root,
    bin,
    callsPath,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_DOCKER_CALLS: callsPath,
      FAKE_PULL_FAIL: pullFails ? "1" : "0"
    }
  };
}

function runInstaller(fixture: InstallFixture, input = "") {
  return spawnSync("sh", ["install.sh"], {
    cwd: fixture.root,
    env: fixture.env,
    input,
    encoding: "utf8"
  });
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describePrivate("self-host package artifacts", () => {
  it("targets Node 22 and builds Next standalone output", async () => {
    const packageJson = JSON.parse(await readRootFile("package.json")) as {
      engines?: { node?: string };
    };
    const packageLock = JSON.parse(await readRootFile("package-lock.json")) as {
      packages: Record<string, { engines?: { node?: string } }>;
    };
    const nextConfig = await readRootFile("next.config.mjs");

    expect(packageJson.engines?.node).toBe(">=22 <23");
    expect(packageLock.packages[""].engines?.node).toBe(">=22 <23");
    expect(nextConfig).toMatch(/\boutput:\s*["']standalone["']/);
  });

  it("builds a minimal non-root Node 22 standalone image", async () => {
    const dockerfilePath = join(projectRoot, "Dockerfile");
    expect(await pathExists(dockerfilePath), "Dockerfile should exist").toBe(true);
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const stages = dockerfile.match(/^FROM\s+/gm) ?? [];
    const nodeImages = dockerfile.match(/^FROM\s+node:22[^\s]*/gm) ?? [];
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM ") + 1);

    expect(stages.length).toBeGreaterThanOrEqual(4);
    expect(nodeImages.length).toBeGreaterThanOrEqual(2);
    expect(dockerfile).toMatch(/\bRUN npm ci\b/);
    expect(dockerfile).toMatch(/\bRUN npm run build\b/);
    expect(runtimeStage).toMatch(
      /COPY --from=builder .*\/app\/\.next\/standalone \.\//
    );
    expect(runtimeStage).toMatch(
      /COPY --from=builder .*\/app\/\.next\/static \.\/\.next\/static/
    );
    expect(runtimeStage).toMatch(/COPY --from=builder .*\/app\/public \.\/public/);
    expect(runtimeStage).toMatch(/^USER node$/m);
    expect(runtimeStage).toMatch(/\bNEXT_TELEMETRY_DISABLED=1\b/);
    expect(runtimeStage).toMatch(/\bHOSTNAME=0\.0\.0\.0\b/);
    expect(runtimeStage).toMatch(/\bPORT=3000\b/);
    expect(runtimeStage).toMatch(/CMD \["node",\s*"server\.js"\]/);
    expect(runtimeStage).not.toMatch(/\bnpm (?:ci|install)\b/);
    expect(dockerfile).not.toMatch(/\b(?:FAL_KEY|STUDIO_PASSWORD|STUDIO_SESSION_SECRET)\b/);
  });

  it("keeps private and local files out of the Docker build context", async () => {
    const ignorePath = join(projectRoot, ".dockerignore");
    expect(await pathExists(ignorePath), ".dockerignore should exist").toBe(true);
    const patterns = (await readFile(ignorePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    expect(patterns).toEqual(
      expect.arrayContaining([
        ".git",
        "node_modules",
        ".next",
        ".env",
        ".env.*",
        "!.env.example",
        "coverage",
        "test-results",
        "playwright-report",
        "promo/",
        "scripts/",
        ".claude/",
        ".playwright-mcp/",
        "public/_archive/",
        "distribution/"
      ])
    );
    expect(patterns).not.toContain("src/");
    expect(patterns).not.toContain("public/");
    expect(patterns).not.toContain("public/featured/");
    expect(patterns).not.toContain("public/showcase*.json");
  });

  it("defines one safely bound, stateless, health-checked Compose service", async () => {
    const composePath = join(projectRoot, "compose.yaml");
    expect(await pathExists(composePath), "compose.yaml should exist").toBe(true);
    const compose = await readFile(composePath, "utf8");
    const serviceNames = [...compose.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map(
      (match) => match[1]
    );

    expect(serviceNames).toEqual(["audio-studio"]);
    expect(compose).toContain(
      "image: ghcr.io/fal-ai-community/audio-studio:${AUDIO_STUDIO_VERSION:-latest}"
    );
    expect(compose).toMatch(/^\s{4}build:\s+\.$/m);
    expect(compose).toMatch(/^\s{4}env_file:\s+\.env$/m);
    expect(compose).toMatch(/^\s{6}NODE_ENV:\s+production$/m);
    expect(compose).toMatch(/^\s{4}init:\s+true$/m);
    expect(compose).toMatch(/^\s{4}restart:\s+unless-stopped$/m);
    expect(compose).toContain(
      '"${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}:3000"'
    );
    expect(compose).toContain("http://127.0.0.1:3000/api/health");
    expect(compose).not.toMatch(/^\s{4}volumes:/m);
    expect(compose).not.toMatch(/^volumes:/m);
    expect(compose).not.toMatch(/\bdepends_on:/);
  });

  it("documents safe explicit environment placeholders and defaults", async () => {
    const examplePath = join(projectRoot, ".env.example");
    expect(await pathExists(examplePath), ".env.example should exist").toBe(true);
    const contents = await readFile(examplePath, "utf8");
    const values = parseEnv(contents);

    expect([...values.keys()].sort()).toEqual(
      [
        "AUDIO_STUDIO_CINEMATIC_MODEL",
        "AUDIO_STUDIO_NAME_MODEL",
        "AUDIO_STUDIO_PROMPT_MODEL",
        "AUDIO_STUDIO_VERSION",
        "BIND_ADDRESS",
        "FAL_KEY",
        "OPENAI_API_KEY",
        "PORT",
        "STUDIO_PASSWORD",
        "STUDIO_SESSION_SECRET"
      ].sort()
    );
    expect(values.get("FAL_KEY")).toBe("your-fal-key");
    expect(values.get("STUDIO_PASSWORD")).toBe("changeme");
    expect(values.get("STUDIO_SESSION_SECRET")).toBe("replace-me");
    expect(values.get("OPENAI_API_KEY")).toBe("your-openai-api-key");
    expect(values.get("BIND_ADDRESS")).toBe("127.0.0.1");
    expect(values.get("PORT")).toBe("3000");
    expect(values.get("AUDIO_STUDIO_VERSION")).toBe("latest");
    expect(contents).toMatch(/FAL_KEY.+required/i);
    expect(contents).toMatch(/install\.sh.+generates.+STUDIO_PASSWORD/i);
    expect(contents).toMatch(/32[- ]byte.+STUDIO_SESSION_SECRET/i);
  });

  it("exports all public self-host artifacts while keeping distribution private", async () => {
    const manifest = JSON.parse(
      await readRootFile("distribution/public-files.json")
    ) as { required: string[]; optional: string[] };

    expect(manifest.required).toEqual(
      expect.arrayContaining([
        ".dockerignore",
        ".env.example",
        "Dockerfile",
        "compose.yaml",
        "install.sh"
      ])
    );
    expect([...manifest.required, ...manifest.optional]).not.toEqual(
      expect.arrayContaining(["distribution/**", "distribution/export-public.mjs"])
    );
  });
});

describePrivate("self-host installer", () => {
  it("is executable POSIX shell with strict secret-safe setup", async () => {
    const installPath = join(projectRoot, "install.sh");
    expect(await pathExists(installPath), "install.sh should exist").toBe(true);
    const source = await readFile(installPath, "utf8");
    const syntax = spawnSync("sh", ["-n", installPath], { encoding: "utf8" });
    const info = await lstat(installPath);

    expect(syntax.status, syntax.stderr).toBe(0);
    expect(info.mode & 0o111).not.toBe(0);
    expect(source.startsWith("#!/bin/sh\nset -eu\numask 077\n")).toBe(true);
    expect(source).toContain("/dev/urandom");
    expect(source).not.toMatch(/\b(?:echo|printf)\b[^\n]*(?:password|session_secret)\b/i);
  });

  it("creates a private env, starts the pulled image, and never prints secrets", async () => {
    const fixture = await createInstallFixture();
    const falKey = ["fal", "test", "0123456789abcdef0123456789abcdef"].join("_");

    const result = runInstaller(fixture, `${falKey}\n`);

    expect(result.status, result.stderr).toBe(0);
    const envContents = await readFile(join(fixture.root, ".env"), "utf8");
    const values = parseEnv(envContents);
    const password = values.get("STUDIO_PASSWORD") ?? "";
    const sessionSecret = values.get("STUDIO_SESSION_SECRET") ?? "";
    const envInfo = await lstat(join(fixture.root, ".env"));
    const output = `${result.stdout}${result.stderr}`;
    const calls = await readFile(fixture.callsPath, "utf8");

    expect(values.get("FAL_KEY")).toBe(falKey);
    expect(password).toMatch(/^[a-f0-9]{48}$/);
    expect(sessionSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(envInfo.mode & 0o777).toBe(0o600);
    expect(output).not.toContain(falKey);
    expect(output).not.toContain(password);
    expect(output).not.toContain(sessionSecret);
    expect(output).toContain("http://127.0.0.1:3000");
    expect(output).toMatch(/credentials.+\.env/i);
    expect(calls).toContain("compose version");
    expect(calls).toContain("compose pull audio-studio");
    expect(calls).not.toContain("compose build audio-studio");
    expect(calls).toContain("compose up -d --no-build");
  });

  it("builds locally after a failed image pull before starting without a rebuild", async () => {
    const fixture = await createInstallFixture(true);
    const falKey = ["fal", "test", "fedcba9876543210fedcba9876543210"].join("_");

    const result = runInstaller(fixture, `${falKey}\n`);

    expect(result.status, result.stderr).toBe(0);
    const calls = (await readFile(fixture.callsPath, "utf8")).trim().split("\n");
    const pullIndex = calls.indexOf("compose pull audio-studio");
    const buildIndex = calls.indexOf("compose build audio-studio");
    const upIndex = calls.indexOf("compose up -d --no-build");
    expect(pullIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(pullIndex);
    expect(upIndex).toBeGreaterThan(buildIndex);
  });

  it("reuses a valid existing env without overwriting or revealing it", async () => {
    const fixture = await createInstallFixture();
    const falKey = ["fal", "existing", "0123456789abcdef0123456789abcdef"].join("_");
    const password = ["existing", "password", "material"].join("-");
    const sessionSecret = [
      "0123456789abcdef",
      "fedcba9876543210",
      "89abcdef01234567"
    ].join("");
    const original = [
      envLine("FAL_KEY", falKey),
      envLine("STUDIO_PASSWORD", password),
      envLine("STUDIO_SESSION_SECRET", sessionSecret),
      envLine("BIND_ADDRESS", "127.0.0.1"),
      envLine("PORT", "3000"),
      ""
    ].join("\n");
    await writeFile(join(fixture.root, ".env"), original, { mode: 0o600 });

    const result = runInstaller(fixture);

    expect(result.status, result.stderr).toBe(0);
    await expect(readFile(join(fixture.root, ".env"), "utf8")).resolves.toBe(original);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain(falKey);
    expect(output).not.toContain(password);
    expect(output).not.toContain(sessionSecret);
  });

  it("rejects an invalid existing env without overwriting it or running services", async () => {
    const fixture = await createInstallFixture();
    const original = [
      envLine(
        "FAL_KEY",
        ["fal", "existing", "abcdef0123456789abcdef0123456789"].join("_")
      ),
      envLine("STUDIO_PASSWORD", "valid-password-material"),
      ""
    ].join("\n");
    await writeFile(join(fixture.root, ".env"), original, { mode: 0o600 });

    const result = runInstaller(fixture);

    expect(result.status).not.toBe(0);
    await expect(readFile(join(fixture.root, ".env"), "utf8")).resolves.toBe(original);
    expect(result.stderr).toMatch(/existing \.env.+invalid/i);
    const calls = await readFile(fixture.callsPath, "utf8");
    expect(calls).toContain("compose version");
    expect(calls).not.toMatch(/compose (?:pull|build|up)/);
  });

  it("rejects an implausible key and cleans up partial env files", async () => {
    const fixture = await createInstallFixture();

    const result = runInstaller(fixture, "too-short\n");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/valid FAL_KEY/i);
    expect(await pathExists(join(fixture.root, ".env"))).toBe(false);
    const files = await readdir(fixture.root);
    expect(files.some((name) => name.startsWith(".env.tmp."))).toBe(false);
    const calls = await readFile(fixture.callsPath, "utf8");
    expect(calls).not.toMatch(/compose (?:pull|build|up)/);
  });

  it("never overwrites an env file that appears during credential generation", async () => {
    const fixture = await createInstallFixture();
    const sentinel = "do-not-overwrite\n";
    const fakeChmodPath = join(fixture.bin, "chmod");
    await writeFile(
      fakeChmodPath,
      `#!/bin/sh
set -eu
if [ "\${2-}" != ".env" ] && [ ! -e ".env" ]; then
  printf '%s\\n' "do-not-overwrite" > ".env"
fi
exec /bin/chmod "$@"
`
    );
    await chmod(fakeChmodPath, 0o755);
    const falKey = ["fal", "race", "0123456789abcdef0123456789abcdef"].join("_");

    const result = runInstaller(fixture, `${falKey}\n`);

    expect(result.status).not.toBe(0);
    await expect(readFile(join(fixture.root, ".env"), "utf8")).resolves.toBe(
      sentinel
    );
    expect(result.stderr).toMatch(/existing \.env/i);
    const calls = await readFile(fixture.callsPath, "utf8");
    expect(calls).not.toMatch(/compose (?:pull|build|up)/);
  });
});

describePrivate("container host deployment artifacts", () => {
  it("pins Render to one always-on Docker instance with required secrets", async () => {
    const render = await readRootFile("render.yaml");

    expect(render).not.toMatch(/^\s*repo:/m);
    expect(render).toMatch(/runtime:\s*docker/);
    expect(render).toMatch(/plan:\s*starter/);
    expect(render).toMatch(/numInstances:\s*1/);
    expect(render).toMatch(/healthCheckPath:\s*\/api\/health/);
    expect(render).toMatch(/autoDeployTrigger:\s*["']?off["']?/);
    expect(render).not.toMatch(/^\s*autoDeploy:/m);
    expect(render).toMatch(/key:\s*FAL_KEY[\s\S]*?sync:\s*false/);
    expect(render).toMatch(/key:\s*STUDIO_PASSWORD[\s\S]*?sync:\s*false/);
    expect(render).toMatch(
      /key:\s*STUDIO_SESSION_SECRET[\s\S]*?generateValue:\s*true/
    );
    expect(render).not.toMatch(/\bscaling:/);
  });

  it("pins Railway to one Docker replica with readiness checks", async () => {
    const railway = JSON.parse(await readRootFile("railway.json")) as {
      $schema?: string;
      build?: { builder?: string; dockerfilePath?: string };
      deploy?: {
        numReplicas?: number;
        healthcheckPath?: string;
        healthcheckTimeout?: number;
        sleepApplication?: boolean;
        restartPolicyType?: string;
      };
    };

    expect(railway.$schema).toBe("https://railway.com/railway.schema.json");
    expect(railway.build).toEqual({
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile"
    });
    expect(railway.deploy?.numReplicas).toBe(1);
    expect(railway.deploy?.healthcheckPath).toBe("/api/health");
    expect(railway.deploy?.healthcheckTimeout).toBeGreaterThanOrEqual(120);
    expect(railway.deploy?.sleepApplication).toBe(false);
    expect(railway.deploy?.restartPolicyType).toBe("ON_FAILURE");
  });

  it("keeps one Fly machine alive for in-memory background jobs", async () => {
    const fly = await readRootFile("deploy/fly.toml");

    expect(fly).toMatch(/\[build\][\s\S]*dockerfile\s*=\s*"Dockerfile"/);
    expect(fly).toMatch(/\[http_service\]/);
    expect(fly).toMatch(/internal_port\s*=\s*3000/);
    expect(fly).toMatch(/force_https\s*=\s*true/);
    expect(fly).toMatch(/auto_stop_machines\s*=\s*false/);
    expect(fly).toMatch(/min_machines_running\s*=\s*1/);
    expect(fly).toMatch(
      /\[\[http_service\.checks\]\][\s\S]*path\s*=\s*"\/api\/health"/
    );
  });

  it("documents install, security, state, upgrades, and host compatibility", async () => {
    const [readme, guide] = await Promise.all([
      readRootFile("README.md"),
      readRootFile("docs/self-hosting.md")
    ]);
    const docs = `${readme}\n${guide}`;

    expect(readme).toContain("https://github.com/egebese/audio-studio");
    expect(readme).toContain("https://render.com/deploy?repo=");
    expect(docs).toMatch(/\.\/install\.sh/);
    expect(docs).toMatch(/docker compose pull/);
    expect(docs).toMatch(/IndexedDB/);
    expect(docs).toMatch(/same (?:browser )?origin/i);
    expect(docs).toMatch(/one replica/i);
    expect(docs).toMatch(/scale[- ]to[- ]zero/i);
    expect(docs).toMatch(/Vercel/);
    expect(docs).toMatch(/Cloudflare Workers/);
    expect(docs).toMatch(/HTTPS/);
    expect(docs).toMatch(/FAL_KEY/);
    expect(docs).toMatch(/STUDIO_PASSWORD/);
    expect(docs).toMatch(/STUDIO_SESSION_SECRET/);
    expect(docs).toMatch(/Render/);
    expect(docs).toMatch(/Railway/);
    expect(docs).toMatch(/Fly\.io/);
    expect(docs).toContain(
      "fly launch --config deploy/fly.toml --copy-config --no-deploy"
    );
  });
});

describePrivate("sanitized public release automation", () => {
  it("publishes only verified v-tag snapshots to the fixed public repository", async () => {
    const workflow = await readRootFile(
      ".github/workflows/publish-public.yml"
    );

    expect(workflow).toMatch(/tags:\s*\n\s*-\s*["']v\*["']/);
    expect(workflow).toContain("ref: ${{ github.ref }}");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain(
      "node distribution/export-public.mjs --output"
    );
    expect(workflow).toContain("VERIFY_DIR=");
    expect(workflow).toContain(
      'cp -a "${EXPORT_DIR}/." "${VERIFY_DIR}/"'
    );
    expect(workflow).toContain('cd "${VERIFY_DIR}"');
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("docker build");
    expect(workflow).toContain("fal-ai-community/audio-studio");
    expect(workflow).toContain("secrets.PUBLIC_REPO_TOKEN");
    expect(workflow).toContain("gh repo clone");
    expect(workflow).toMatch(/git -C "\$\{public_dir\}" push --atomic/);
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain(
      "ghcr.io/fal-ai-community/audio-studio"
    );
    expect(workflow).toContain("github.ref_name");
    expect(workflow).toMatch(/value=latest/);
    expect(workflow).not.toMatch(/\bgit config\b/);
    expect(workflow).not.toContain("pull_request_target");
  });

  it("exports public CI and honest contribution guidance as an overlay", async () => {
    const [ci, contributing] = await Promise.all([
      readRootFile(
        "distribution/public-overlay/.github/workflows/ci.yml"
      ),
      readRootFile("distribution/public-overlay/CONTRIBUTING.md")
    ]);

    expect(ci).toContain("node-version: 22");
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm run typecheck");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run build");
    expect(ci).toContain("docker build");
    expect(ci).not.toContain("PUBLIC_REPO_TOKEN");
    expect(ci).not.toContain("pull_request_target");
    expect(contributing).toMatch(/release mirror/i);
    expect(contributing).toMatch(/pull request/i);
    expect(contributing).toMatch(/overwrit/i);
  });

  it("keeps private publication machinery outside the public allowlist", async () => {
    const manifest = JSON.parse(
      await readRootFile("distribution/public-files.json")
    ) as { required: string[]; optional: string[] };
    const paths = [...manifest.required, ...manifest.optional];

    expect(paths).not.toContain(".github/workflows/publish-public.yml");
    expect(paths).not.toContain("distribution/public-files.json");
    expect(paths).not.toContain("distribution/export-public.mjs");
    expect(paths).not.toContain("distribution/**");
  });
});
