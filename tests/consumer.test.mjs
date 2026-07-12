import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as viteBuild, createLogger } from "vite";
import webpack from "webpack";

const require = createRequire(import.meta.url);
const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testsDirectory, "..");

function sanitizedNpmEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.toLowerCase() !== "npm_config_dry_run")
  );
}

function runNpm(arguments_, cwd) {
  const options = {
    cwd,
    encoding: "utf8",
    env: sanitizedNpmEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  };
  const bundledNpmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const npmCli = process.env.npm_execpath ?? (existsSync(bundledNpmCli) ? bundledNpmCli : undefined);
  if (npmCli) {
    return execFileSync(process.execPath, [npmCli, ...arguments_], options);
  }
  return execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    arguments_,
    { ...options, shell: process.platform === "win32" }
  );
}

function packageBin(packageName, binName) {
  const packageJsonPath = join(projectRoot, "node_modules", ...packageName.split("/"), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin[binName];
  return resolve(dirname(packageJsonPath), relativeBin);
}

function runNode(arguments_, cwd) {
  return execFileSync(process.execPath, arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyInstalledPackage(name, fixtureDirectory) {
  const packageJsonPath = require.resolve(`${name}/package.json`);
  const destination = join(fixtureDirectory, "node_modules", ...name.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(dirname(packageJsonPath), destination, { recursive: true });
}

function runWebpack(config) {
  return new Promise((resolvePromise, rejectPromise) => {
    webpack(config, (error, stats) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      const details = stats.toJson({ all: false, errors: true, warnings: true });
      if (stats.hasErrors() || stats.hasWarnings()) {
        rejectPromise(new Error(`Webpack consumer build failed:\n${JSON.stringify(details, null, 2)}`));
        return;
      }
      resolvePromise();
    });
  });
}

function readTree(directory) {
  let output = "";
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    output += entry.isDirectory() ? readTree(path) : readFileSync(path, "utf8");
  }
  return output;
}

export async function runConsumerTests() {
  const scratchDirectory = mkdtempSync(join(tmpdir(), "deterministic-agent-avatars-consumer-"));
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

    writeJson(join(fixtureDirectory, "package.json"), {
      name: "deterministic-agent-avatars-consumer-fixture",
      private: true,
      type: "module",
      dependencies: {
        "deterministic-agent-avatars": `file:${tarballPath.replaceAll("\\", "/")}`,
      },
    });
    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], fixtureDirectory);

    for (const packageName of [
      "react",
      "loose-envify",
      "js-tokens",
      "@types/react",
      "@types/prop-types",
      "csstype",
    ]) {
      copyInstalledPackage(packageName, fixtureDirectory);
    }

    writeFileSync(join(fixtureDirectory, "consumer.mjs"), `
      import { STYLE_VERSION, createHashAvatar, getCatalogStats } from "deterministic-agent-avatars";
      import { createAvatarPng } from "deterministic-agent-avatars/png";
      import { AgentAvatar } from "deterministic-agent-avatars/react";
      import { derivePrivateSeed } from "deterministic-agent-avatars/private";
      const svg = createHashAvatar("esm-consumer", { namespace: "fixture" });
      const png = createAvatarPng("esm-consumer", { size: 8 });
      const privateSeed = await derivePrivateSeed("esm-consumer", { secret: "0123456789abcdef0123456789abcdef" });
      console.log(JSON.stringify({
        styleVersion: STYLE_VERSION,
        signatureStates: getCatalogStats().signatureStates,
        svg: svg.startsWith("<svg"),
        png: png instanceof Uint8Array,
        react: AgentAvatar.displayName,
        privateSeed: privateSeed.startsWith("hmac-sha256:"),
      }));
    `, "utf8");

    writeFileSync(join(fixtureDirectory, "consumer.cjs"), `
      const api = require("deterministic-agent-avatars");
      const pngApi = require("deterministic-agent-avatars/png");
      const reactApi = require("deterministic-agent-avatars/react");
      const privateApi = require("deterministic-agent-avatars/private");
      (async () => {
        const png = pngApi.createAvatarPng("cjs-consumer", { size: 8 });
        const privateSeed = await privateApi.derivePrivateSeed("cjs-consumer", { secret: "0123456789abcdef0123456789abcdef" });
        console.log(JSON.stringify({
          styleVersion: api.STYLE_VERSION,
          signatureStates: api.getCatalogStats().signatureStates,
          svg: api.createHashAvatar("cjs-consumer").startsWith("<svg"),
          png: png instanceof Uint8Array,
          react: reactApi.AgentAvatar.displayName,
          privateSeed: privateSeed.startsWith("hmac-sha256:"),
        }));
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `, "utf8");

    const esmResult = JSON.parse(runNode([join(fixtureDirectory, "consumer.mjs")], fixtureDirectory));
    const cjsResult = JSON.parse(runNode([join(fixtureDirectory, "consumer.cjs")], fixtureDirectory));
    assert.deepEqual(esmResult, {
      styleVersion: "1",
      signatureStates: 21984,
      svg: true,
      png: true,
      react: "AgentAvatar",
      privateSeed: true,
    });
    assert.deepEqual(cjsResult, esmResult);

    const esmTypes = `
      import { STYLE_VERSION, hash32, type HashOptions } from "deterministic-agent-avatars";
      import { createAvatarPng } from "deterministic-agent-avatars/png";
      import { AgentAvatar } from "deterministic-agent-avatars/react";
      import { derivePrivateSeed } from "deterministic-agent-avatars/private";
      const options: HashOptions = { namespace: "fixture", domain: "consumer" };
      const version: "1" = STYLE_VERSION;
      const hash: number = hash32("esm-types", options);
      const png: Uint8Array = createAvatarPng("esm-types", { size: 8 });
      void AgentAvatar; void derivePrivateSeed("esm-types", { secret: "0123456789abcdef0123456789abcdef" });
      void version; void hash; void png;
    `;
    const cjsTypes = `
      import api = require("deterministic-agent-avatars");
      import pngApi = require("deterministic-agent-avatars/png");
      import reactApi = require("deterministic-agent-avatars/react");
      import privateApi = require("deterministic-agent-avatars/private");
      const version: "1" = api.STYLE_VERSION;
      const png: Uint8Array = pngApi.createAvatarPng("cjs-types", { size: 8 });
      void reactApi.AgentAvatar; void privateApi.derivePrivateSeed("cjs-types", { secret: "0123456789abcdef0123456789abcdef" });
      void version; void png;
    `;
    writeFileSync(join(fixtureDirectory, "consumer.mts"), esmTypes, "utf8");
    writeFileSync(join(fixtureDirectory, "consumer.cts"), cjsTypes, "utf8");
    writeFileSync(join(fixtureDirectory, "consumer.bundler.ts"), esmTypes, "utf8");

    for (const [name, compilerOptions, files] of [
      ["nodenext", { module: "NodeNext", moduleResolution: "NodeNext" }, ["consumer.mts", "consumer.cts"]],
      ["node16", { module: "Node16", moduleResolution: "Node16" }, ["consumer.mts", "consumer.cts"]],
      ["bundler", { module: "ESNext", moduleResolution: "Bundler" }, ["consumer.bundler.ts"]],
    ]) {
      const configPath = join(fixtureDirectory, `tsconfig.${name}.json`);
      writeJson(configPath, {
        compilerOptions: {
          target: "ES2022",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM"],
          types: ["react"],
          ...compilerOptions,
        },
        files,
      });
      runNode([resolve(projectRoot, "node_modules/typescript/bin/tsc"), "-p", configPath], fixtureDirectory);
    }

    const browserRoot = join(fixtureDirectory, "browser-root.mjs");
    const browserReact = join(fixtureDirectory, "browser-react.mjs");
    writeFileSync(browserRoot, 'import { createHashAvatar } from "deterministic-agent-avatars"; console.log(createHashAvatar("browser"));\n', "utf8");
    writeFileSync(browserReact, 'import { AgentAvatar } from "deterministic-agent-avatars/react"; console.log(AgentAvatar);\n', "utf8");

    const esbuildDirectory = join(scratchDirectory, "esbuild");
    mkdirSync(esbuildDirectory);
    for (const [name, entryPoint] of [["root", browserRoot], ["react", browserReact]]) {
      const result = await esbuild({
        entryPoints: [entryPoint],
        bundle: true,
        platform: "browser",
        format: "esm",
        external: ["react"],
        outfile: join(esbuildDirectory, `${name}.js`),
        logLevel: "silent",
      });
      assert.deepEqual(result.warnings, []);
    }

    const webpackDirectory = join(scratchDirectory, "webpack");
    await runWebpack({
      mode: "production",
      target: "web",
      entry: { root: browserRoot, react: browserReact },
      output: { path: webpackDirectory, filename: "[name].js" },
      externals: { react: "React" },
    });

    const viteDirectory = join(scratchDirectory, "vite");
    const viteWarnings = [];
    const logger = createLogger("silent");
    logger.warn = (message) => viteWarnings.push(String(message));
    logger.warnOnce = logger.warn;
    await viteBuild({
      configFile: false,
      root: fixtureDirectory,
      customLogger: logger,
      build: {
        outDir: viteDirectory,
        emptyOutDir: true,
        rollupOptions: {
          input: { root: browserRoot, react: browserReact },
          external: ["react"],
        },
      },
    });
    assert.deepEqual(viteWarnings, []);

    for (const directory of [esbuildDirectory, webpackDirectory, viteDirectory]) {
      assert.equal(readTree(directory).includes("node:crypto"), false, `${directory} retained node:crypto`);
    }

    runNode([packageBin("publint", "publint"), tarballPath, "--level", "warning", "--strict"], projectRoot);
    runNode([packageBin("@arethetypeswrong/cli", "attw"), tarballPath, "--profile", "node16"], projectRoot);

    return {
      tarball: packReport[0].filename,
      esmCjs: true,
      typeModes: ["Node16", "NodeNext", "Bundler"],
      browserBundlers: ["esbuild", "Webpack", "Vite"],
      packageLinters: ["publint", "Are The Types Wrong"],
    };
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runConsumerTests();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

export { sanitizedNpmEnvironment };
