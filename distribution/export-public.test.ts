import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

type PublicFilesManifest = {
  version: 1;
  required: string[];
  optional: string[];
  largeFiles: string[];
  maxFileSizeBytes: number;
  maxLargeFileSizeBytes: number;
};

type Fixture = {
  root: string;
  source: string;
  output: string;
  manifest: PublicFilesManifest;
};

const exporterPath = fileURLToPath(
  new URL("./export-public.mjs", import.meta.url)
);
const fixtureRoots: string[] = [];

async function writeFixtureFile(
  source: string,
  relativePath: string,
  contents: string | Buffer
) {
  const destination = join(source, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

async function saveManifest(fixture: Fixture) {
  await writeFixtureFile(
    fixture.source,
    "distribution/public-files.json",
    `${JSON.stringify(fixture.manifest, null, 2)}\n`
  );
}

async function createFixture(
  overrides: Partial<PublicFilesManifest> = {}
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "audio-studio-public-export-"));
  fixtureRoots.push(root);

  const source = join(root, "source");
  const fixture: Fixture = {
    root,
    source,
    output: join(root, "output"),
    manifest: {
      version: 1,
      required: [
        "LICENSE",
        "README.md",
        "src/**",
        "public/featured/**",
        "public/showcase*.json"
      ],
      optional: [".env.example", "docs/self-hosting.md"],
      largeFiles: ["public/featured/**"],
      maxFileSizeBytes: 1024,
      maxLargeFileSizeBytes: 4096,
      ...overrides
    }
  };

  await Promise.all([
    writeFixtureFile(source, "LICENSE", "Apache-2.0\n"),
    writeFixtureFile(source, "README.md", "# Audio Studio\n"),
    writeFixtureFile(source, "src/index.ts", "export const ready = true;\n"),
    writeFixtureFile(source, "public/featured/demo.webp", "featured-media"),
    writeFixtureFile(source, "public/showcase.json", "{}\n"),
    writeFixtureFile(source, ".env.example", "FAL_KEY=\n")
  ]);
  await saveManifest(fixture);
  return fixture;
}

function runExporter(
  fixture: Fixture,
  extraArguments: string[] = [],
  output = fixture.output
) {
  return spawnSync(
    process.execPath,
    [
      exporterPath,
      "--source",
      fixture.source,
      "--output",
      output,
      ...extraArguments
    ],
    { encoding: "utf8" }
  );
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files.sort();
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("public distribution exporter", () => {
  test("copies required runtime files and excludes private repository files", async () => {
    const fixture = await createFixture();
    await Promise.all([
      writeFixtureFile(fixture.source, "AGENTS.md", "private guidance\n"),
      writeFixtureFile(fixture.source, "promo/video.mp4", "private promo\n"),
      writeFixtureFile(fixture.source, "scripts/internal.mjs", "private script\n"),
      writeFixtureFile(fixture.source, ".claude/launch.json", "{}\n"),
      writeFixtureFile(fixture.source, ".playwright-mcp/page.yml", "page\n"),
      writeFixtureFile(fixture.source, "src/.DS_Store", "local metadata\n"),
      writeFixtureFile(
        fixture.source,
        "public/_archive/showcase-old.json",
        "{}\n"
      ),
      writeFixtureFile(
        fixture.source,
        ".github/workflows/publish-public.yml",
        "name: private release\n"
      )
    ]);

    const result = runExporter(fixture);

    expect(result.status, result.stderr).toBe(0);
    await expect(listFiles(fixture.output)).resolves.toEqual([
      ".env.example",
      "LICENSE",
      "README.md",
      "public/featured/demo.webp",
      "public/showcase.json",
      "src/index.ts"
    ]);
    expect(await pathExists(join(fixture.output, "distribution"))).toBe(false);
  });

  test("applies the public overlay after allowlisted source files", async () => {
    const fixture = await createFixture();
    await Promise.all([
      writeFixtureFile(
        fixture.source,
        "distribution/public-overlay/README.md",
        "# Public Audio Studio\n"
      ),
      writeFixtureFile(
        fixture.source,
        "distribution/public-overlay/.github/workflows/ci.yml",
        "name: public CI\n"
      )
    ]);

    const result = runExporter(fixture);

    expect(result.status, result.stderr).toBe(0);
    await expect(readFile(join(fixture.output, "README.md"), "utf8")).resolves.toBe(
      "# Public Audio Studio\n"
    );
    await expect(
      readFile(join(fixture.output, ".github/workflows/ci.yml"), "utf8")
    ).resolves.toBe("name: public CI\n");
  });

  test("fails before writing when a required allowlist entry is missing", async () => {
    const fixture = await createFixture();
    await rm(join(fixture.source, "public/showcase.json"));

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/required.+public\/showcase\*\.json/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test.each([
    "AGENTS.md",
    "promo/internal.txt",
    "scripts/internal.txt",
    ".claude/launch.json",
    ".playwright-mcp/page.yml",
    "public/_archive/old.json",
    ".github/workflows/publish-public.yml",
    "distribution/export-public.mjs"
  ])("rejects forbidden allowlisted path %s", async (relativePath) => {
    const fixture = await createFixture();
    fixture.manifest.required.push(relativePath);
    await Promise.all([
      writeFixtureFile(fixture.source, relativePath, "private\n"),
      saveManifest(fixture)
    ]);

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/forbidden export path/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects forbidden paths supplied by the public overlay", async () => {
    const fixture = await createFixture();
    await writeFixtureFile(
      fixture.source,
      "distribution/public-overlay/scripts/internal.sh",
      "#!/bin/sh\n"
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/forbidden export path/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects real environment files while allowing .env.example", async () => {
    const fixture = await createFixture();
    fixture.manifest.required.push(".env");
    await Promise.all([
      writeFixtureFile(fixture.source, ".env", "FAL_KEY=real-key-material\n"),
      saveManifest(fixture)
    ]);

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/environment file.+\.env/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects secret-like content in exported text files", async () => {
    const fixture = await createFixture();
    await writeFixtureFile(
      fixture.source,
      "src/secret.ts",
      'export const FAL_KEY = "fal_live_9f3a0b7c6d5e4f321";\n'
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/secret-like content.+src\/secret\.ts/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects annotated TypeScript secret string literals", async () => {
    const fixture = await createFixture();
    await writeFixtureFile(
      fixture.source,
      "src/annotated-secret.ts",
      'const FAL_KEY: string = "real";\n'
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /secret-like content.+src\/annotated-secret\.ts/i
    );
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test.each([
    "real-test-secret-value-12345",
    "sample-secret-value-67890"
  ])("does not treat substring-bearing secret %s as a placeholder", async (secret) => {
    const fixture = await createFixture();
    await writeFixtureFile(
      fixture.source,
      "src/substring-secret.ts",
      `const FAL_KEY = "${secret}";\n`
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /secret-like content.+src\/substring-secret\.ts/i
    );
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("allows source code that assigns environment values by reference", async () => {
    const fixture = await createFixture();
    await writeFixtureFile(
      fixture.source,
      "src/env-reference.ts",
      "process.env.FAL_KEY = originalFalKey;\n"
    );

    const result = runExporter(fixture);

    expect(result.status, result.stderr).toBe(0);
    await expect(
      readFile(join(fixture.output, "src/env-reference.ts"), "utf8")
    ).resolves.toBe("process.env.FAL_KEY = originalFalKey;\n");
  });

  test("allows secret-named object properties that reference code values", async () => {
    const fixture = await createFixture();
    const source =
      "const config = { PASSWORD: credentials.password };\n" +
      "export default config;\n";
    await writeFixtureFile(fixture.source, "src/code-reference.ts", source);

    const result = runExporter(fixture);

    expect(result.status, result.stderr).toBe(0);
    await expect(
      readFile(join(fixture.output, "src/code-reference.ts"), "utf8")
    ).resolves.toBe(source);
  });

  test("allows explicit placeholders in .env.example", async () => {
    const fixture = await createFixture();
    const placeholders = [
      "FAL_KEY=",
      "STUDIO_PASSWORD=changeme",
      "STUDIO_SESSION_SECRET=replace-me",
      "PUBLIC_REPO_TOKEN=your-public-repo-token",
      "API_KEY=example",
      ""
    ].join("\n");
    await writeFixtureFile(fixture.source, ".env.example", placeholders);

    const result = runExporter(fixture);

    expect(result.status, result.stderr).toBe(0);
    await expect(
      readFile(join(fixture.output, ".env.example"), "utf8")
    ).resolves.toBe(placeholders);
  });

  test("rejects symlinks matched by the allowlist", async () => {
    const fixture = await createFixture();
    await symlink("index.ts", join(fixture.source, "src/link.ts"));

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symbolic link.+src\/link\.ts/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects a symlink ancestor of a glob root", async () => {
    const fixture = await createFixture();
    fixture.manifest.required = fixture.manifest.required.filter(
      (pattern) => pattern !== "public/showcase*.json"
    );
    await saveManifest(fixture);
    await rm(join(fixture.source, "public"), { recursive: true });
    await writeFixtureFile(
      fixture.root,
      "outside-public/featured/demo.webp",
      "outside media"
    );
    await symlink(
      join(fixture.root, "outside-public"),
      join(fixture.source, "public")
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symbolic link.+public/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects a symlink ancestor of an exact nested path", async () => {
    const fixture = await createFixture();
    await writeFixtureFile(
      fixture.root,
      "outside-docs/self-hosting.md",
      "# Outside\n"
    );
    await symlink(
      join(fixture.root, "outside-docs"),
      join(fixture.source, "docs")
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symbolic link.+docs/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects a symlink ancestor of the public overlay", async () => {
    const fixture = await createFixture();
    const manifest = await readFile(
      join(fixture.source, "distribution/public-files.json"),
      "utf8"
    );
    await rm(join(fixture.source, "distribution"), { recursive: true });
    await Promise.all([
      writeFixtureFile(
        fixture.root,
        "outside-distribution/public-files.json",
        manifest
      ),
      writeFixtureFile(
        fixture.root,
        "outside-distribution/public-overlay/README.md",
        "# Outside overlay\n"
      )
    ]);
    await symlink(
      join(fixture.root, "outside-distribution"),
      join(fixture.source, "distribution")
    );

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/symbolic link.+distribution/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects unexpected oversized files", async () => {
    const fixture = await createFixture({
      maxFileSizeBytes: 64,
      maxLargeFileSizeBytes: 256
    });
    await writeFixtureFile(fixture.source, "src/large.bin", Buffer.alloc(65, 1));

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/src\/large\.bin.+exceeds.+64/i);
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("dry-run prints a deterministic inventory without writing output", async () => {
    const fixture = await createFixture();

    const first = runExporter(fixture, ["--dry-run"]);
    const second = runExporter(fixture, ["--dry-run"]);

    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(JSON.parse(first.stdout)).toMatchObject({
      mode: "dry-run",
      files: [
        { path: ".env.example", source: "allowlist" },
        { path: "LICENSE", source: "allowlist" },
        { path: "README.md", source: "allowlist" },
        { path: "public/featured/demo.webp", source: "allowlist" },
        { path: "public/showcase.json", source: "allowlist" },
        { path: "src/index.ts", source: "allowlist" }
      ]
    });
    expect(await pathExists(fixture.output)).toBe(false);
  });

  test("rejects output paths that overlap the source tree", async () => {
    const fixture = await createFixture();
    const nestedOutput = join(fixture.source, "export");

    const result = runExporter(fixture, [], nestedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/output path.+overlap.+source/i);
    expect(await pathExists(nestedOutput)).toBe(false);
  });

  test("does not delete an existing non-empty output directory", async () => {
    const fixture = await createFixture();
    await writeFixtureFile(fixture.root, "output/keep.txt", "keep me\n");

    const result = runExporter(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/output directory.+empty/i);
    await expect(readFile(join(fixture.output, "keep.txt"), "utf8")).resolves.toBe(
      "keep me\n"
    );
  });
});
