import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkCurrentReleaseTag, expectedReleaseTag } from "./check-release-tag.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
const tag = expectedReleaseTag(packageJson.version);
const release = checkCurrentReleaseTag({ ...process.env, npm_config_tag: tag });
console.log(`Release tag policy accepted ${release.version} -> ${release.tag}.`);
const arguments_ = ["pack", "--dry-run", "--json"];
const bundledNpmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const npmCli = process.env.npm_execpath ?? (existsSync(bundledNpmCli) ? bundledNpmCli : undefined);
const result = npmCli
  ? spawnSync(process.execPath, [npmCli, ...arguments_], { cwd: projectRoot, stdio: "inherit" })
  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, {
      cwd: projectRoot,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
