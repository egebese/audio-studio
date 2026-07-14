#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  utimes
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep
} from "node:path";

const MANIFEST_PATH = "distribution/public-files.json";
const OVERLAY_PATH = "distribution/public-overlay";
const MANIFEST_KEYS = new Set([
  "version",
  "required",
  "optional",
  "largeFiles",
  "maxFileSizeBytes",
  "maxLargeFileSizeBytes"
]);
const LOCAL_METADATA_NAMES = new Set([".DS_Store"]);
const BINARY_EXTENSIONS = new Set([
  ".aac",
  ".avif",
  ".flac",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip"
]);
const FIXED_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseArguments(argumentsList) {
  const parsed = {
    source: process.cwd(),
    output: undefined,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === "--dry-run" || argument === "--inventory") {
      parsed.dryRun = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (argument === "--source") {
      parsed.source = readArgumentValue(argumentsList, ++index, argument);
      continue;
    }
    if (argument === "--output" || argument === "-o") {
      parsed.output = readArgumentValue(argumentsList, ++index, argument);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return parsed;
}

function readArgumentValue(argumentsList, index, argument) {
  const value = argumentsList[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${argument} requires a path`);
  }
  return value;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node distribution/export-public.mjs [options]",
      "",
      "Options:",
      "  --output, -o <dir>  Write the sanitized export to an empty directory",
      "  --source <dir>      Source repository (defaults to current directory)",
      "  --dry-run           Validate and print inventory without writing",
      "  --inventory         Alias for --dry-run",
      "  --help, -h          Show this help",
      ""
    ].join("\n")
  );
}

async function pathInfo(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function inspectSourcePath(source, absolutePath) {
  const sourceRelative = relative(source, absolutePath);
  if (
    sourceRelative === ".." ||
    sourceRelative.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelative)
  ) {
    throw new Error(`Source path is outside the source root: ${absolutePath}`);
  }

  const parts = sourceRelative === "" ? [] : sourceRelative.split(sep);
  let currentPath = source;
  let info = await lstat(source);

  for (let index = 0; index < parts.length; index += 1) {
    currentPath = join(currentPath, parts[index]);
    info = await pathInfo(currentPath);
    if (!info) {
      return null;
    }
    if (info.isSymbolicLink()) {
      const symlinkPath = parts.slice(0, index + 1).join("/");
      throw new Error(
        `Symbolic link in source path is not exportable: ${symlinkPath}`
      );
    }
  }

  const resolvedPath = await realpath(absolutePath);
  if (!isPathWithin(source, resolvedPath)) {
    throw new Error(
      `Source path resolves outside the source root: ${sourceRelative}`
    );
  }

  return { info, realPath: resolvedPath, sourcePath: parts.join("/") };
}

function isPathWithin(parent, child) {
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

async function resolveProspectivePath(path) {
  const missingParts = [];
  let existingPath = path;

  while (!(await pathInfo(existingPath))) {
    const parent = dirname(existingPath);
    if (parent === existingPath) {
      throw new Error(`Cannot resolve output path: ${path}`);
    }
    missingParts.unshift(basename(existingPath));
    existingPath = parent;
  }

  return resolve(await realpath(existingPath), ...missingParts);
}

async function validateSource(sourceInput) {
  const requestedSource = resolve(sourceInput);
  const requestedInfo = await pathInfo(requestedSource);
  if (!requestedInfo?.isDirectory()) {
    throw new Error(`Source directory does not exist: ${requestedSource}`);
  }
  if (requestedInfo.isSymbolicLink()) {
    throw new Error(`Source directory must not be a symbolic link: ${requestedSource}`);
  }
  return realpath(requestedSource);
}

async function validateOutput(source, outputInput) {
  const output = resolve(outputInput);
  const canonicalOutput = await resolveProspectivePath(output);
  const filesystemRoot = parse(canonicalOutput).root;

  if (
    canonicalOutput === filesystemRoot ||
    canonicalOutput === resolve(homedir()) ||
    isPathWithin(source, canonicalOutput) ||
    isPathWithin(canonicalOutput, source)
  ) {
    throw new Error(
      `Output path must not overlap the source tree or a protected directory: ${output}`
    );
  }

  const outputInfo = await pathInfo(output);
  if (outputInfo?.isSymbolicLink()) {
    throw new Error(`Output directory must not be a symbolic link: ${output}`);
  }
  if (outputInfo && !outputInfo.isDirectory()) {
    throw new Error(`Output path must be a directory: ${output}`);
  }
  if (outputInfo && (await readdir(output)).length > 0) {
    throw new Error(`Output directory must be empty: ${output}`);
  }

  return output;
}

function assertPattern(pattern, field) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error(`${field} entries must be non-empty strings`);
  }
  if (
    pattern.includes("\\") ||
    pattern.includes("\0") ||
    pattern.startsWith("/") ||
    pattern.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ${field} pattern: ${pattern}`);
  }
  if (/[\[\]{}]/.test(pattern)) {
    throw new Error(`Unsupported ${field} pattern: ${pattern}`);
  }

  const wildcardIndex = pattern.search(/[*?]/);
  if (wildcardIndex === 0) {
    throw new Error(`Root-wide ${field} patterns are not allowed: ${pattern}`);
  }
}

function assertStringArray(manifest, field, { allowEmpty }) {
  const value = manifest[field];
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(
      `${field} must be ${allowEmpty ? "an array" : "a non-empty array"}`
    );
  }

  for (const pattern of value) {
    assertPattern(pattern, field);
  }

  if (new Set(value).size !== value.length) {
    throw new Error(`${field} contains duplicate entries`);
  }
}

async function loadManifest(source) {
  const manifestFile = join(source, MANIFEST_PATH);
  const inspectedManifest = await inspectSourcePath(source, manifestFile);
  if (!inspectedManifest) {
    throw new Error(`Missing export manifest: ${MANIFEST_PATH}`);
  }
  const manifestInfo = inspectedManifest.info;
  if (manifestInfo.isSymbolicLink()) {
    throw new Error(`Export manifest must not be a symbolic link: ${MANIFEST_PATH}`);
  }
  if (!manifestInfo.isFile()) {
    throw new Error(`Export manifest is not a file: ${MANIFEST_PATH}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`Invalid export manifest JSON: ${error.message}`);
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Export manifest must be a JSON object");
  }

  const unknownKeys = Object.keys(manifest).filter(
    (key) => !MANIFEST_KEYS.has(key)
  );
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown export manifest field: ${unknownKeys.sort()[0]}`);
  }
  if (manifest.version !== 1) {
    throw new Error("Export manifest version must be 1");
  }

  assertStringArray(manifest, "required", { allowEmpty: false });
  assertStringArray(manifest, "optional", { allowEmpty: true });
  assertStringArray(manifest, "largeFiles", { allowEmpty: true });

  for (const field of ["maxFileSizeBytes", "maxLargeFileSizeBytes"]) {
    if (!Number.isSafeInteger(manifest[field]) || manifest[field] <= 0) {
      throw new Error(`${field} must be a positive integer`);
    }
  }
  if (manifest.maxLargeFileSizeBytes < manifest.maxFileSizeBytes) {
    throw new Error(
      "maxLargeFileSizeBytes must be greater than or equal to maxFileSizeBytes"
    );
  }

  return manifest;
}

function globToRegExp(pattern) {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }

    expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }

  return new RegExp(`${expression}$`);
}

function globPrefix(pattern) {
  const wildcardIndex = pattern.search(/[*?]/);
  if (wildcardIndex === -1) return pattern;

  const fixedPart = pattern.slice(0, wildcardIndex);
  const finalSlash = fixedPart.lastIndexOf("/");
  if (finalSlash === -1) {
    throw new Error(`Root-wide allowlist patterns are not allowed: ${pattern}`);
  }
  return fixedPart.slice(0, finalSlash);
}

async function walkPath(root, relativePath, sourceRoot = root) {
  const absolutePath = join(root, ...relativePath.split("/"));
  const inspected = await inspectSourcePath(sourceRoot, absolutePath);
  if (!inspected) return [];
  if (!inspected.info.isDirectory()) {
    return [
      {
        path: relativePath,
        absolutePath,
        info: inspected.info,
        realPath: inspected.realPath,
        sourcePath: inspected.sourcePath,
        sourceRoot
      }
    ];
  }

  const results = [];
  const names = (await readdir(absolutePath)).sort(comparePaths);
  for (const name of names) {
    if (LOCAL_METADATA_NAMES.has(name)) {
      continue;
    }
    if (name.includes("/") || name.includes("\\") || /[\0\r\n]/.test(name)) {
      throw new Error(`Unsafe filename below ${relativePath}: ${name}`);
    }
    const childPath = relativePath ? `${relativePath}/${name}` : name;
    results.push(...(await walkPath(root, childPath, sourceRoot)));
  }
  return results;
}

async function expandPattern(source, pattern) {
  const matcher = globToRegExp(pattern);
  const prefix = globPrefix(pattern);
  const candidates = await walkPath(source, prefix);
  return candidates.filter(
    (candidate) =>
      !candidate.path
        .split("/")
        .some((part) => LOCAL_METADATA_NAMES.has(part)) &&
      matcher.test(candidate.path)
  );
}

function assertSafeExportPath(relativePath) {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    /[\0\r\n]/.test(relativePath) ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe export path: ${relativePath}`);
  }

  const lowerPath = relativePath.toLowerCase();
  const lowerParts = lowerPath.split("/");
  const forbidden =
    lowerParts.includes(".git") ||
    lowerParts.at(-1) === "agents.md" ||
    lowerPath === "promo" ||
    lowerPath.startsWith("promo/") ||
    lowerPath === "scripts" ||
    lowerPath.startsWith("scripts/") ||
    lowerPath === ".claude" ||
    lowerPath.startsWith(".claude/") ||
    lowerPath === ".playwright-mcp" ||
    lowerPath.startsWith(".playwright-mcp/") ||
    lowerPath === "distribution" ||
    lowerPath.startsWith("distribution/") ||
    lowerPath === "public/_archive" ||
    lowerPath.startsWith("public/_archive/") ||
    lowerPath === ".github/workflows/publish-public.yml" ||
    lowerPath === ".github/workflows/publish-public.yaml";

  if (forbidden) {
    throw new Error(`Forbidden export path: ${relativePath}`);
  }

  const filename = lowerParts.at(-1);
  if (
    filename !== ".env.example" &&
    (filename === ".env" || filename.startsWith(".env."))
  ) {
    throw new Error(`Real environment file is not exportable: ${relativePath}`);
  }
}

function matchesAnyPattern(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function placeholderSecret(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "changeme" ||
    normalized === "replace-me" ||
    normalized === "example" ||
    /^your-[a-z0-9][a-z0-9._-]*$/.test(normalized)
  );
}

function findSecretLikeContent(contents, relativePath) {
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(contents)) {
    return "private key";
  }

  const tokenPatterns = [
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\bsk-(?:live-)?[A-Za-z0-9_-]{20,}\b/g
  ];
  for (const pattern of tokenPatterns) {
    const matches = contents.match(pattern) ?? [];
    if (matches.some((value) => !placeholderSecret(value))) {
      return "credential token";
    }
  }

  const literalAssignmentPattern =
    /["']?(FAL_KEY|PUBLIC_REPO_TOKEN|STUDIO_PASSWORD|STUDIO_SESSION_SECRET|AWS_SECRET_ACCESS_KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET)["']?[ \t]*(?:(?:\??[ \t]*:[ \t]*[^=\n;,{}]+)?[ \t]*=|:)[ \t]*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/gi;
  for (const match of contents.matchAll(literalAssignmentPattern)) {
    const value = match[2] ?? match[3] ?? "";
    if (!placeholderSecret(value)) {
      return match[1];
    }
  }

  const codeExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
  if (!codeExtensions.has(extname(relativePath).toLowerCase())) {
    const environmentAssignmentPattern =
      /^[ \t]*(?:export[ \t]+)?(FAL_KEY|PUBLIC_REPO_TOKEN|STUDIO_PASSWORD|STUDIO_SESSION_SECRET|AWS_SECRET_ACCESS_KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET)[ \t]*=[ \t]*(.*?)[ \t]*$/gim;
    for (const match of contents.matchAll(environmentAssignmentPattern)) {
      let value = match[2].replace(/\s+#.*$/, "").trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (!placeholderSecret(value)) {
        return match[1];
      }
    }
  }

  return null;
}

async function validateCandidate(candidate, manifest) {
  assertSafeExportPath(candidate.path);

  if (candidate.info.isSymbolicLink()) {
    throw new Error(`Symbolic link is not exportable: ${candidate.path}`);
  }
  if (!candidate.info.isFile()) {
    throw new Error(`Only regular files are exportable: ${candidate.path}`);
  }

  const largeFile = matchesAnyPattern(candidate.path, manifest.largeFiles);
  const sizeLimit = largeFile
    ? manifest.maxLargeFileSizeBytes
    : manifest.maxFileSizeBytes;
  if (candidate.info.size > sizeLimit) {
    throw new Error(
      `${candidate.path} exceeds the ${sizeLimit} byte file limit (${candidate.info.size} bytes)`
    );
  }

  if (BINARY_EXTENSIONS.has(extname(candidate.path).toLowerCase())) {
    return;
  }

  const data = await readFile(candidate.absolutePath);
  if (data.includes(0)) {
    return;
  }
  const secretType = findSecretLikeContent(
    data.toString("utf8"),
    candidate.path
  );
  if (secretType) {
    throw new Error(
      `Secret-like content detected in ${candidate.path} (${secretType})`
    );
  }
}

async function collectAllowlistedFiles(source, manifest) {
  const files = new Map();

  for (const [field, patterns] of [
    ["required", manifest.required],
    ["optional", manifest.optional]
  ]) {
    for (const pattern of patterns) {
      const matches = await expandPattern(source, pattern);
      if (field === "required" && matches.length === 0) {
        throw new Error(`Required allowlist entry matched no files: ${pattern}`);
      }

      for (const candidate of matches) {
        await validateCandidate(candidate, manifest);
        files.set(candidate.path, {
          ...candidate,
          source: "allowlist"
        });
      }
    }
  }

  return files;
}

async function applyOverlay(source, manifest, files) {
  const overlayRoot = join(source, OVERLAY_PATH);
  const inspectedOverlay = await inspectSourcePath(source, overlayRoot);
  if (!inspectedOverlay) return;
  const overlayInfo = inspectedOverlay.info;
  if (overlayInfo.isSymbolicLink()) {
    throw new Error(`Public overlay must not be a symbolic link: ${OVERLAY_PATH}`);
  }
  if (!overlayInfo.isDirectory()) {
    throw new Error(`Public overlay must be a directory: ${OVERLAY_PATH}`);
  }

  for (const candidate of await walkPath(overlayRoot, "", source)) {
    await validateCandidate(candidate, manifest);
    files.set(candidate.path, {
      ...candidate,
      source: "overlay"
    });
  }
}

function createInventory(files, dryRun) {
  const sortedFiles = [...files.values()].sort((left, right) =>
    comparePaths(left.path, right.path)
  );
  return {
    sortedFiles,
    report: {
      mode: dryRun ? "dry-run" : "export",
      fileCount: sortedFiles.length,
      totalBytes: sortedFiles.reduce((total, file) => total + file.info.size, 0),
      files: sortedFiles.map((file) => ({
        path: file.path,
        source: file.source,
        bytes: file.info.size
      }))
    }
  };
}

async function copyInventory(output, files) {
  await mkdir(output, { recursive: true, mode: 0o755 });
  await chmod(output, 0o755);

  for (const file of files) {
    const destination = join(output, ...file.path.split("/"));
    const destinationDirectory = dirname(destination);
    await mkdir(destinationDirectory, { recursive: true, mode: 0o755 });
    const inspected = await inspectSourcePath(file.sourceRoot, file.absolutePath);
    if (
      !inspected ||
      !inspected.info.isFile() ||
      inspected.realPath !== file.realPath ||
      inspected.info.dev !== file.info.dev ||
      inspected.info.ino !== file.info.ino ||
      inspected.info.mode !== file.info.mode ||
      inspected.info.size !== file.info.size ||
      inspected.info.mtimeMs !== file.info.mtimeMs
    ) {
      throw new Error(`Source file changed during export: ${file.sourcePath}`);
    }
    await copyFile(
      file.absolutePath,
      destination,
      fsConstants.COPYFILE_EXCL
    );
    await chmod(destination, file.info.mode & 0o111 ? 0o755 : 0o644);
    await utimes(destination, FIXED_TIMESTAMP, FIXED_TIMESTAMP);
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    printUsage();
    return;
  }
  if (!arguments_.dryRun && !arguments_.output) {
    throw new Error("--output is required unless --dry-run is used");
  }

  const source = await validateSource(arguments_.source);
  const output = arguments_.output
    ? await validateOutput(source, arguments_.output)
    : undefined;
  const manifest = await loadManifest(source);
  const files = await collectAllowlistedFiles(source, manifest);
  await applyOverlay(source, manifest, files);
  const { sortedFiles, report } = createInventory(files, arguments_.dryRun);

  if (!arguments_.dryRun) {
    await copyInventory(output, sortedFiles);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`export-public: ${error.message}\n`);
  process.exitCode = 1;
});
