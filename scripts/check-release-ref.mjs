import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

function validateReleaseRef(version, refType, refName) {
  const expectedRef = `v${version}`;
  if (refType !== "tag" || refName !== expectedRef) {
    throw new Error(`Release workflow must run from tag ${expectedRef}; received ${refType ?? "unknown"}:${refName ?? "unknown"}.`);
  }
  return expectedRef;
}

function checkCurrentReleaseRef(environment = process.env) {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  return validateReleaseRef(packageJson.version, environment.GITHUB_REF_TYPE, environment.GITHUB_REF_NAME);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  console.log(`Release ref policy accepted ${checkCurrentReleaseRef()}.`);
}

export { checkCurrentReleaseRef, validateReleaseRef };
