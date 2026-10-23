#!/usr/bin/env node
// Packs @chaincraft/runtime, gamedef and compiler into installable tarballs under pack-out/.
// Internal dependencies are pinned to exact versions in the packed manifests only; sources are untouched.
//
// Usage: node scripts/pack.mjs [--skip-build] [--verify]
//   CHAINCRAFT_RUNTIME_DIR overrides the runtime checkout (default: ../chaincraft-runtime).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.resolve(process.env.CHAINCRAFT_RUNTIME_DIR ?? path.join(root, "../chaincraft-runtime"));
const outDir = path.join(root, "pack-out");

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const verify = args.has("--verify");

// Dependency order: each package may depend on those before it.
const PACKAGES = [
  { dir: runtimeDir },
  { dir: path.join(root, "packages/gamedef") },
  { dir: path.join(root, "packages/compiler") },
];

const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

function run(cmd, cmdArgs, cwd, stdio = "inherit") {
  return execFileSync(cmd, cmdArgs, { cwd, stdio, encoding: "utf-8" });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

function gitInfo(dir) {
  const git = (...a) => run("git", ["-C", dir, ...a], dir, "pipe").trim();
  try {
    return { commit: git("rev-parse", "--short", "HEAD"), dirty: git("status", "--porcelain") !== "" };
  } catch {
    return { commit: null, dirty: null };
  }
}

function pinInternalDeps(pkg, versions) {
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (name.startsWith("@chaincraft/")) {
        if (!versions.has(name)) throw new Error(`${pkg.name}: unpackable internal dependency ${name}`);
        pkg[field][name] = versions.get(name);
      } else if (/^(file:|link:|workspace:)/.test(spec)) {
        throw new Error(`${pkg.name}: non-registry dependency ${name}@${spec}`);
      }
    }
  }
}

if (!existsSync(runtimeDir)) throw new Error(`Runtime checkout not found: ${runtimeDir}`);

if (!skipBuild) {
  run("npm", ["run", "build"], runtimeDir);
  run("npm", ["run", "build:packages"], root);
}

const manifests = PACKAGES.map((p) => ({ ...p, pkg: readJson(path.join(p.dir, "package.json")) }));
const versions = new Map(manifests.map((m) => [m.pkg.name, m.pkg.version]));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const stageRoot = mkdtempSync(path.join(tmpdir(), "chaincraft-pack-"));

const packed = [];
try {
  for (const { dir, pkg } of manifests) {
    const files = pkg.files ?? ["dist"];
    for (const f of files) {
      if (!existsSync(path.join(dir, f))) throw new Error(`${pkg.name}: missing ${f}; build first (omit --skip-build)`);
    }

    const stage = path.join(stageRoot, pkg.name.replace(/^@/, "").replace("/", "-"));
    mkdirSync(stage, { recursive: true });
    for (const f of files) cpSync(path.join(dir, f), path.join(stage, f), { recursive: true });
    for (const entry of readdirSync(dir)) {
      if (/^(README|LICENSE)/i.test(entry)) cpSync(path.join(dir, entry), path.join(stage, entry));
    }

    const staged = structuredClone(pkg);
    pinInternalDeps(staged, versions);
    // Lifecycle scripts and dev tooling must not run or be installed in the lab.
    delete staged.scripts;
    delete staged.devDependencies;
    writeFileSync(path.join(stage, "package.json"), JSON.stringify(staged, null, 2) + "\n");

    const [{ filename }] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", outDir], stage, "pipe"));
    const file = path.join(outDir, filename);
    packed.push({
      name: pkg.name,
      version: pkg.version,
      file: filename,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      ...gitInfo(dir),
    });
  }
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}

const manifest = { packedAt: new Date().toISOString(), gameBuilder: gitInfo(root), packages: packed };
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

for (const p of packed) {
  console.log(`${p.name}@${p.version}  ${p.file}  ${p.commit ?? "no-git"}${p.dirty ? " (dirty)" : ""}`);
}
if (packed.some((p) => p.dirty)) console.warn("WARNING: packed from a dirty working tree; manifest commit does not capture all changes.");

const tarballs = packed.map((p) => path.join(outDir, p.file));
console.log(`\nInstall in a project:\n  npm install ${tarballs.join(" ")}`);

if (verify) {
  const dir = mkdtempSync(path.join(tmpdir(), "chaincraft-verify-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "pack-verify", private: true, type: "module" }));
    run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], dir);
    const specifiers = ["@chaincraft/runtime", "@chaincraft/gamedef", "@chaincraft/gamedef/validator", "@chaincraft/compiler"];
    const script = `await Promise.all(${JSON.stringify(specifiers)}.map((s) => import(s))); console.log("verify: all packages import OK");`;
    run("node", ["--input-type=module", "-e", script], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
