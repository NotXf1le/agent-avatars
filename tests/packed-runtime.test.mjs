import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testsDirectory, "..");

function npmEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run")
  );
}

function runNpm(arguments_, cwd) {
  const options = {
    cwd,
    encoding: "utf8",
    env: npmEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  };
  const bundledNpmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const npmCli = process.env.npm_execpath ?? (existsSync(bundledNpmCli) ? bundledNpmCli : undefined);
  if (npmCli) return execFileSync(process.execPath, [npmCli, ...arguments_], options);
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, {
    ...options,
    shell: process.platform === "win32",
  });
}

function runNode(path, cwd) {
  return JSON.parse(execFileSync(process.execPath, [path], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

export function runPackedRuntimeTest() {
  const scratchDirectory = mkdtempSync(join(tmpdir(), "deterministic-agent-avatars-packed-runtime-"));
  try {
    const packDirectory = join(scratchDirectory, "pack");
    const fixtureDirectory = join(scratchDirectory, "fixture");
    mkdirSync(packDirectory);
    mkdirSync(fixtureDirectory);

    const packReport = JSON.parse(runNpm([
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDirectory,
    ], projectRoot));
    assert.equal(packReport.length, 1);
    const tarballPath = join(packDirectory, packReport[0].filename);

    writeFileSync(join(fixtureDirectory, "package.json"), `${JSON.stringify({
      name: "deterministic-agent-avatars-packed-runtime-fixture",
      private: true,
      type: "module",
      dependencies: {
        "deterministic-agent-avatars": `file:${tarballPath.replaceAll("\\", "/")}`,
      },
    }, null, 2)}\n`, "utf8");
    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], fixtureDirectory);

    const esmPath = join(fixtureDirectory, "consumer.mjs");
    writeFileSync(esmPath, `
      import { STYLE_VERSION, createHashAvatar, getCatalogStats } from "deterministic-agent-avatars";
      import { createAvatarPng } from "deterministic-agent-avatars/png";
      import { derivePrivateSeed } from "deterministic-agent-avatars/private";
      const privateSeed = await derivePrivateSeed("packed-esm", { secret: "0123456789abcdef0123456789abcdef" });
      console.log(JSON.stringify({
        styleVersion: STYLE_VERSION,
        signatureStates: getCatalogStats().signatureStates,
        svg: createHashAvatar("packed-esm").startsWith("<svg"),
        png: createAvatarPng("packed-esm", { size: 8 }) instanceof Uint8Array,
        privateSeed: privateSeed.startsWith("hmac-sha256:"),
      }));
    `, "utf8");

    const cjsPath = join(fixtureDirectory, "consumer.cjs");
    writeFileSync(cjsPath, `
      const api = require("deterministic-agent-avatars");
      const png = require("deterministic-agent-avatars/png");
      const privateApi = require("deterministic-agent-avatars/private");
      (async () => {
        const privateSeed = await privateApi.derivePrivateSeed("packed-cjs", { secret: "0123456789abcdef0123456789abcdef" });
        console.log(JSON.stringify({
          styleVersion: api.STYLE_VERSION,
          signatureStates: api.getCatalogStats().signatureStates,
          svg: api.createHashAvatar("packed-cjs").startsWith("<svg"),
          png: png.createAvatarPng("packed-cjs", { size: 8 }) instanceof Uint8Array,
          privateSeed: privateSeed.startsWith("hmac-sha256:"),
        }));
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `, "utf8");

    const expected = {
      styleVersion: "1",
      signatureStates: 21984,
      svg: true,
      png: true,
      privateSeed: true,
    };
    assert.deepEqual(runNode(esmPath, fixtureDirectory), expected);
    assert.deepEqual(runNode(cjsPath, fixtureDirectory), expected);

    return { tarball: packReport[0].filename, esm: true, cjs: true };
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ok: true, ...runPackedRuntimeTest() }, null, 2));
}
