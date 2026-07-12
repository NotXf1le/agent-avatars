import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

function expectedReleaseTag(version) {
  if (typeof version !== "string" || version.length === 0) {
    throw new TypeError("package version must be a non-empty string.");
  }
  return version.includes("-") ? "next" : "latest";
}

function validateReleaseTag(version, tag) {
  const effectiveTag = typeof tag === "string" && tag.length > 0 ? tag : "latest";
  const expectedTag = expectedReleaseTag(version);
  if (effectiveTag !== expectedTag) {
    throw new Error(
      `Refusing to publish ${version} with dist-tag ${effectiveTag}; expected ${expectedTag}. `
      + `Run npm publish --tag ${expectedTag}.`
    );
  }
  return effectiveTag;
}

function checkCurrentReleaseTag(environment = process.env) {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  return {
    version: packageJson.version,
    tag: validateReleaseTag(packageJson.version, environment.npm_config_tag),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  if (process.argv.includes("--expected")) {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
    console.log(expectedReleaseTag(packageJson.version));
  } else {
    const result = checkCurrentReleaseTag();
    console.log(`Release tag policy accepted ${result.version} -> ${result.tag}.`);
  }
}

export {
  checkCurrentReleaseTag,
  expectedReleaseTag,
  validateReleaseTag,
};
