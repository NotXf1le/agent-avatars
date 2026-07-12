import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedReleaseTag, validateReleaseTag } from "../scripts/check-release-tag.mjs";
import { validateReleaseRef } from "../scripts/check-release-ref.mjs";
import { sanitizedNpmEnvironment } from "./consumer.test.mjs";

export async function runReleasePolicyTests() {
  assert.equal(validateReleaseTag("1.0.0-rc.2", "next"), "next");
  assert.equal(validateReleaseTag("1.0.0", "latest"), "latest");
  assert.equal(expectedReleaseTag("1.0.0-rc.2"), "next");
  assert.equal(expectedReleaseTag("1.0.0"), "latest");
  assert.throws(() => validateReleaseTag("1.0.0-rc.2", undefined), /expected next/);
  assert.throws(() => validateReleaseTag("1.0.0-rc.2", "latest"), /expected next/);
  assert.throws(() => validateReleaseTag("1.0.0", "next"), /expected latest/);
  assert.equal(validateReleaseRef("1.0.0-rc.2", "tag", "v1.0.0-rc.2"), "v1.0.0-rc.2");
  assert.throws(() => validateReleaseRef("1.0.0-rc.2", "branch", "main"), /tag v1\.0\.0-rc\.2/);
  assert.throws(() => validateReleaseRef("1.0.0-rc.2", "tag", "v1.0.0"), /tag v1\.0\.0-rc\.2/);

  const environment = sanitizedNpmEnvironment({
    PATH: "fixture",
    npm_config_dry_run: "true",
    NPM_CONFIG_DRY_RUN: "true",
    npm_config_tag: "next",
  });
  assert.deepEqual(environment, { PATH: "fixture", npm_config_tag: "next" });

  return {
    explicitDistTags: true,
    tagVersionConsistency: true,
    nestedDryRunIsolation: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runReleasePolicyTests();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
