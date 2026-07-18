import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPolicyPairs,
  findInvalidDescriptorPair,
} from "./visual-distance-oracle.mjs";

const require = createRequire(import.meta.url);
const testsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testsDirectory, "..");
const PRIVATE_SECRET = "0123456789abcdef0123456789abcdef";
const esm = await import("agent-avatars");
const cjs = require("agent-avatars");

function captureError(operation) {
  try {
    operation();
  } catch (error) {
    return { name: error.constructor.name, code: error.code, message: error.message };
  }
  assert.fail("expected operation to throw");
}

async function captureAsyncError(operation) {
  try {
    await operation();
  } catch (error) {
    return { name: error.constructor.name, code: error.code, message: error.message };
  }
  assert.fail("expected operation to reject");
}

export async function runPackageTests() {
  const {
    assertNoStaticImports,
    prepareOutputDirectory,
    transformCommonJsImports,
    transformVisualDistanceImport,
  } = await import("../scripts/build.mjs");
  const multilineImport = `import { unrelated } from "./unrelated.mjs";
import {
    paletteDistance,
    shapeHammingDistance,
    deltaE2000,
    buildPaletteDistanceMatrix
  } from "./visual-distance.mjs";
const marker = true;`;
  const transformedImport = transformVisualDistanceImport(multilineImport);
  assert.match(transformedImport, /^import \{ unrelated \} from "\.\/unrelated\.mjs";/);
  assert.equal(transformedImport.includes('from "./visual-distance.mjs"'), false);
  assert.match(
    transformedImport,
    /const \{ paletteDistance, shapeHammingDistance, deltaE2000, buildPaletteDistanceMatrix \} = require\("\.\/visual-distance\.cjs"\);/
  );
  assert.throws(() => assertNoStaticImports(transformedImport, "unrelated fixture"), /valid CommonJS/i);
  assert.doesNotThrow(() => assertNoStaticImports(transformedImport.replace(/^import[^\n]+\n/, ""), "multiline fixture"));
  assert.throws(
    () => assertNoStaticImports('import { unresolved } from "./unresolved.mjs";\nconst marker = true;', "broken fixture"),
    /broken fixture.*valid CommonJS/i
  );
  assert.throws(
    () => assertNoStaticImports('const marker = true; import { unresolved } from "./mid-line.mjs";', "mid-line fixture"),
    /mid-line fixture.*valid CommonJS/i
  );
  assert.throws(
    () => assertNoStaticImports('const marker = true; import { first } from "./first.mjs"; import { second } from "./second.mjs";', "multiple fixture"),
    /multiple fixture.*valid CommonJS/i
  );
  assert.doesNotThrow(() => assertNoStaticImports(`
    const text = 'import { fake } from "./string.mjs"';
    const template = \`import { fake } from "./template.mjs"\`;
    // import { fake } from "./line-comment.mjs";
    /* import { fake } from "./block-comment.mjs"; */
    const pending = import("./dynamic.mjs");
    const pattern = /import\\s+\\{ fake \\} from "\\.\\/regex\\.mjs"/;
    if (ok) /import \{ fake \} from "\.\\/if-regex.mjs"/.test(text);
    while (ok) /import \{ fake \} from "\.\\/while-regex.mjs"/.test(text);
    for (;;) { /import \{ fake \} from "\.\\/for-regex.mjs"/.test(text); break; }
    const record = { import: "value" };
    const member = loader.import;
  `, "non-static fixture"));
  assert.throws(
    () => assertNoStaticImports("const metadata = import.meta.url;", "import-meta fixture"),
    /import-meta fixture.*valid CommonJS/i
  );

  const semicolonlessImport = `import {
    shapeHammingDistance,
    deltaE2000 as $delta
  } from "./visual-distance.mjs"
const afterImport = true;`;
  const transformedSemicolonless = transformVisualDistanceImport(semicolonlessImport);
  assert.match(
    transformedSemicolonless,
    /^const \{ shapeHammingDistance, deltaE2000: \$delta \} = require\("\.\/visual-distance\.cjs"\);\nconst afterImport = true;$/
  );
  assert.doesNotThrow(() => assertNoStaticImports(transformedSemicolonless, "semicolonless fixture"));

  const crlfImport = "import {\r\n  deltaE2000 as $delta,\r\n  paletteDistance as palette$\r\n} from './visual-distance.mjs';\r\nconst after = true;";
  const transformedCrlf = transformVisualDistanceImport(crlfImport);
  assert.match(
    transformedCrlf,
    /^const \{ deltaE2000: \$delta, paletteDistance: palette\$ \} = require\("\.\/visual-distance\.cjs"\);\r\nconst after = true;$/
  );
  assert.doesNotThrow(() => assertNoStaticImports(transformedCrlf, "CRLF fixture"));
  const generalizedImports = transformCommonJsImports(`import * as React from "react";
import { normalizeHexColor as normalizeColor } from "./render-descriptor.mjs";
const marker = true;`, new Map([
    ["react", "react"],
    ["./render-descriptor.mjs", "./render-descriptor.cjs"],
  ]), "./generalized.mjs");
  assert.match(generalizedImports, /^const React = require\("react"\);/);
  assert.match(
    generalizedImports,
    /const \{ normalizeHexColor: normalizeColor \} = require\("\.\/render-descriptor\.cjs"\);/
  );
  assert.doesNotThrow(() => assertNoStaticImports(generalizedImports, "generalized fixture"));
  assert.throws(
    () => transformVisualDistanceImport("import { first,,second } from './visual-distance.mjs';"),
    /\.\/visual-distance\.mjs:1:\d+ TS\d+:.*expected/i
  );

  const packageJson = require("agent-avatars/package.json");
  assert.equal(packageJson.main, "./dist/index.cjs");
  assert.equal(packageJson.module, "./dist/index.mjs");
  assert.equal(packageJson.types, "./dist/index.d.mts");
  assert.equal(packageJson.name, "agent-avatars");
  assert.equal(packageJson.version, "1.0.1");
  assert.equal(packageJson.description, "Zero-dependency deterministic SVG and PNG avatars for AI agents, bots, services, and users.");
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/NotXf1le/agent-avatars.git",
  });
  assert.equal(packageJson.homepage, "https://notxf1le.github.io/agent-avatars/");
  assert.deepEqual(packageJson.bugs, {
    url: "https://github.com/NotXf1le/agent-avatars/issues",
  });
  assert.equal(packageJson.dependencies, undefined);
  assert.deepEqual(packageJson.exports["."], {
    import: {
      types: "./dist/index.d.mts",
      default: "./dist/index.mjs",
    },
    require: {
      types: "./dist/index.d.cts",
      default: "./dist/index.cjs",
    },
    default: "./dist/index.mjs",
  });
  assert.deepEqual(packageJson.exports["./png"], {
    import: {
      types: "./dist/png.d.mts",
      default: "./dist/png.mjs",
    },
    require: {
      types: "./dist/png.d.cts",
      default: "./dist/png.cjs",
    },
  });
  assert.deepEqual(packageJson.exports["./react"], {
    import: {
      types: "./dist/react.d.mts",
      default: "./dist/react.mjs",
    },
    require: {
      types: "./dist/react.d.cts",
      default: "./dist/react.cjs",
    },
  });
  assert.deepEqual(packageJson.exports["./private"], {
    import: {
      types: "./dist/private.d.mts",
      default: "./dist/private.mjs",
    },
    require: {
      types: "./dist/private.d.cts",
      default: "./dist/private.cjs",
    },
  });
  assert.equal(packageJson.exports["./package.json"], "./package.json");
  assert.deepEqual(Object.keys(packageJson.exports).sort(), [".", "./package.json", "./png", "./private", "./react"]);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.packageManager, "npm@11.11.0");
  assert.deepEqual(packageJson.devEngines, {
    runtime: { name: "node", version: ">=24.8.0", onFail: "error" },
    packageManager: { name: "npm", version: "11.11.0", onFail: "error" },
  });
  assert.deepEqual(packageJson.publishConfig, { access: "public" });
  assert.equal(packageJson.funding, "https://ko-fi.com/felixkoba");
  assert.equal(packageJson.peerDependencies.react, ">=18 <20");
  assert.equal(packageJson.devDependencies.playwright, "1.61.1");
  assert.equal(packageJson.scripts.prepublishOnly, "node scripts/check-release-tag.mjs");
  assert.equal(packageJson.scripts["release:dry-run"], "node scripts/release-dry-run.mjs");
  assert.deepEqual(packageJson.files, [
    "dist",
    "examples/preview.png",
    "examples/avatar-cycle.gif",
    "examples/hero-agent-dashboard.png",
    "examples/avatar-gallery.png",
    "examples/deterministic-output.png",
    "examples/batch-uniqueness.png",
    "examples/light-dark-themes.png",
    "examples/private-seed-flow.png",
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "LICENSE",
  ]);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /PNG rendering caps its high-resolution RGBA buffer at 64 MiB/);
  assert.match(readme, /explicit `supersample` value exceeds that budget, the API throws a `RangeError`/);
  for (const discoverableTerm of [
    "visual distinguishability",
    "minimumShapeDistance",
    "minimumPaletteDistance",
    "createIdentitySetWithFallback",
    "distanceMode",
    "either",
    "both",
    "CIEDE2000",
    "visual-distance/v1",
    "16,777,216",
    "Direct Git URL installs are not supported",
    "32 encoded bytes",
  ]) {
    assert.ok(readme.includes(discoverableTerm), `README must document ${discoverableTerm}`);
  }
  assert.match(readme, /greedy deterministic allocator/i);
  assert.match(readme, /maxAttempts/);
  assert.match(readme, /does not guarantee (?:a )?maximum packing|does not prove.*(?:packing|assignment).*exists/i);
  assert.match(readme, /attempts exhausted|exhausted.*attempts/i);

  const cjsPrivateSubpathError = captureError(() => require("agent-avatars/visual-distance"));
  const esmPrivateSubpathError = await captureAsyncError(() => import("agent-avatars/visual-distance"));
  for (const error of [cjsPrivateSubpathError, esmPrivateSubpathError]) {
    assert.equal(error.name, "Error");
    assert.equal(error.code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
    assert.match(error.message, /Package subpath '.\/visual-distance' is not defined by "exports"/);
  }

  const options = { namespace: "parity", theme: "dark" };
  assert.equal(esm.createHashAvatar("module", options), cjs.createHashAvatar("module", options));
  assert.deepEqual(esm.createAvatarDescriptor("module", options), cjs.createAvatarDescriptor("module", options));
  assert.equal(esm.getCatalogStats().signatureStates, 21984);
  assert.equal(cjs.getCatalogStats().signatureStates, 21984);
  assert.equal(esm.STYLE_VERSION, "1");
  assert.equal(cjs.STYLE_VERSION, "1");
  assert.equal(esm.derivePrivateSeed, undefined);
  assert.equal(cjs.derivePrivateSeed, undefined);
  const renderDescriptor = esm.createAvatarDescriptor("module-render", options);
  for (const implementation of [esm, cjs]) {
    assert.throws(
      () => implementation.createHashAvatarFromDescriptor({
        ...renderDescriptor,
        colors: { ...renderDescriptor.colors, foreground: '\"><script>alert(1)</script>' },
      }),
      /descriptor\.colors\.foreground must be a six-digit hexadecimal color/
    );
  }

  const policyOptions = {
    namespace: "package-policy-parity",
    includeSvg: false,
    ensureUnique: true,
    minimumShapeDistance: 4,
    minimumPaletteDistance: 20,
    distanceMode: "either",
    maxAttempts: 4096,
  };
  const policySeeds = ["alpha", "beta", "gamma", "delta"];
  const esmPolicySet = esm.createIdentitySet(policySeeds, policyOptions);
  const cjsPolicySet = cjs.createIdentitySet(policySeeds, policyOptions);
  assert.deepEqual(esmPolicySet, cjsPolicySet);
  assertPolicyPairs(esmPolicySet.items, esmPolicySet.manifest.distinguishability);
  assertPolicyPairs(cjsPolicySet.items, cjsPolicySet.manifest.distinguishability);

  const reversedEsm = esm.createIdentitySet([...policySeeds].reverse(), policyOptions);
  const reversedCjs = cjs.createIdentitySet([...policySeeds].reverse(), policyOptions);
  assert.deepEqual(reversedEsm.manifest, esmPolicySet.manifest);
  assert.deepEqual(reversedCjs.manifest, cjsPolicySet.manifest);
  const historicalEntries = structuredClone(esmPolicySet.manifest.entries);
  const expandedSeeds = ["epsilon", ...policySeeds].reverse();
  const expandedEsm = esm.createIdentitySet(expandedSeeds, { ...policyOptions, manifest: esmPolicySet.manifest });
  const expandedCjs = cjs.createIdentitySet(expandedSeeds, { ...policyOptions, manifest: cjsPolicySet.manifest });
  assert.deepEqual(expandedEsm, expandedCjs);
  for (const [identityKey, entry] of Object.entries(historicalEntries)) {
    assert.deepEqual(expandedEsm.manifest.entries[identityKey], entry);
  }
  assertPolicyPairs(expandedEsm.items, expandedEsm.manifest.distinguishability);

  const mismatchedPolicy = { ...policyOptions, minimumShapeDistance: 5, manifest: esmPolicySet.manifest };
  const esmMismatch = captureError(() => esm.createIdentitySet([], mismatchedPolicy));
  const cjsMismatch = captureError(() => cjs.createIdentitySet([], mismatchedPolicy));
  assert.equal(esmMismatch.name, "TypeError");
  assert.equal(cjsMismatch.name, "TypeError");
  assert.match(esmMismatch.message, /manifest.*distinguishability policy.*does not match/i);
  assert.match(cjsMismatch.message, /manifest.*distinguishability policy.*does not match/i);

  const esmFallback = esm.createIdentitySetWithFallback([], mismatchedPolicy);
  const cjsFallback = cjs.createIdentitySetWithFallback([], mismatchedPolicy);
  assert.deepEqual(esmFallback, cjsFallback);
  assert.equal(esmFallback.policyAdjustment.reason, "manifest-policy");
  assert.deepEqual(esmFallback.policyAdjustment.applied, esmPolicySet.manifest.distinguishability);

  const invalidPairBase = esm.createIdentitySet([], policyOptions);
  const invalidPair = findInvalidDescriptorPair(esm, "package-invalid", policyOptions);
  assert.ok(invalidPair, "packaged fixture search must find a pairwise-invalid manifest");
  const invalidPairManifest = structuredClone(invalidPairBase.manifest);
  invalidPairManifest.entries = Object.fromEntries(invalidPair.map((descriptor, index) => [
    `${index + 1}`.padStart(32, "0"),
    {
      nonce: descriptor.collisionNonce,
      signature: descriptor.signature,
      shapeId: descriptor.shapeId,
      paletteId: descriptor.paletteId,
    },
  ]));
  const esmInvalidPair = captureError(() => esm.createIdentitySet([], { ...policyOptions, manifest: invalidPairManifest }));
  const cjsInvalidPair = captureError(() => cjs.createIdentitySet([], { ...policyOptions, manifest: invalidPairManifest }));
  assert.deepEqual(esmInvalidPair, cjsInvalidPair);
  assert.match(esmInvalidPair.message, /invalid visual-distance assignment/);

  const collidingPalettes = [
    {
      id: "collision-a",
      light: { background: "#039307", foreground: "#000000" },
      dark: { background: "#FFFFFF", foreground: "#111111" },
    },
    {
      id: "collision-b",
      light: { background: "#03ED40", foreground: "#000000" },
      dark: { background: "#FFFFFF", foreground: "#111111" },
    },
  ];
  const collisionOptions = { palettes: collidingPalettes, allowLowContrast: true, includeSvg: false };
  const esmCollision = captureError(() => esm.createIdentitySet([], collisionOptions));
  const cjsCollision = captureError(() => cjs.createIdentitySet([], collisionOptions));
  assert.deepEqual(esmCollision, cjsCollision);
  assert.equal(esmCollision.name, "TypeError");
  assert.match(esmCollision.message, /signature-key collision/);

  for (const file of [
    "../dist/index.d.mts",
    "../dist/index.d.cts",
    "../dist/png.d.mts",
    "../dist/png.d.cts",
    "../dist/react.d.mts",
    "../dist/react.d.cts",
    "../dist/private.d.mts",
    "../dist/private.d.cts",
    "../dist/catalog-cache.mjs",
    "../dist/catalog-cache.cjs",
    "../dist/visual-distance.mjs",
    "../dist/visual-distance.cjs",
    "../dist/render-descriptor.mjs",
    "../dist/render-descriptor.cjs",
    "../dist/png-options.mjs",
    "../dist/png-options.cjs",
    "../dist/file-set-transaction.mjs",
    "../dist/file-set-transaction.cjs",
    "../LICENSE",
  ]) {
    assert.ok(readFileSync(new URL(file, import.meta.url), "utf8").length > 100, `${file} is missing or empty`);
  }

  const pngEsm = await import("agent-avatars/png");
  const pngCjs = require("agent-avatars/png");
  assert.deepEqual(
    pngEsm.createAvatarPng("package-subpath", { size: 32 }),
    pngCjs.createAvatarPng("package-subpath", { size: 32 })
  );
  const packagedPngDescriptor = esm.createAvatarDescriptor("package-png-descriptor");
  for (const implementation of [pngEsm, pngCjs]) {
    assert.throws(
      () => implementation.createAvatarPngFromDescriptor({ ...packagedPngDescriptor, rows: [] }, 32),
      /descriptor\.rows must contain 4 integers/
    );
  }
  const reactEsm = await import("agent-avatars/react");
  const reactCjs = require("agent-avatars/react");
  assert.equal(reactEsm.AgentAvatar.displayName, "AgentAvatar");
  assert.equal(reactCjs.AgentAvatar.displayName, "AgentAvatar");
  assert.equal(reactEsm.HashAvatar, reactEsm.AgentAvatar);
  assert.equal(reactCjs.HashAvatar, reactCjs.AgentAvatar);

  const privateEsm = await import("agent-avatars/private");
  const privateCjs = require("agent-avatars/private");
  assert.equal(
    await privateEsm.derivePrivateSeed("package-private", { secret: PRIVATE_SECRET, namespace: "package" }),
    await privateCjs.derivePrivateSeed("package-private", { secret: PRIVATE_SECRET, namespace: "package" })
  );

  const scratchDirectory = mkdtempSync(join(tmpdir(), "agent-avatars-build-"));
  const scratchDist = join(scratchDirectory, "dist");
  const staleArtifact = join(scratchDist, "stale-artifact.txt");
  mkdirSync(scratchDist);
  writeFileSync(staleArtifact, "stale\n", "utf8");
  try {
    prepareOutputDirectory(scratchDist);
    assert.equal(existsSync(staleArtifact), false, "build must remove stale dist artifacts");
    assert.equal(existsSync(scratchDist), true, "build must recreate its output directory");
  } finally {
    rmSync(scratchDirectory, { recursive: true, force: true });
  }

  const npmArguments = ["pack", "--dry-run", "--json", "--ignore-scripts"];
  const npmExecPath = process.env.npm_execpath;
  const packOptions = {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  const packOutput = npmExecPath
    ? execFileSync(process.execPath, [npmExecPath, ...npmArguments], packOptions)
    : execFileSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        npmArguments,
        { ...packOptions, shell: process.platform === "win32" }
      );
  const packReport = JSON.parse(packOutput);
  assert.equal(Array.isArray(packReport), true);
  assert.equal(packReport.length, 1);
  const packedFiles = new Set(packReport[0].files.map((file) => file.path.replaceAll("\\", "/")));
  for (const file of [
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "package.json",
    "examples/preview.png",
    "examples/avatar-cycle.gif",
    "examples/hero-agent-dashboard.png",
    "examples/avatar-gallery.png",
    "examples/deterministic-output.png",
    "examples/batch-uniqueness.png",
    "examples/light-dark-themes.png",
    "examples/private-seed-flow.png",
    "dist/index.cjs",
    "dist/index.d.cts",
    "dist/index.d.mts",
    "dist/index.mjs",
    "dist/catalog-cache.cjs",
    "dist/catalog-cache.mjs",
    "dist/png.cjs",
    "dist/png.d.cts",
    "dist/png.d.mts",
    "dist/png.mjs",
    "dist/react.cjs",
    "dist/react.d.cts",
    "dist/react.d.mts",
    "dist/react.mjs",
    "dist/private.cjs",
    "dist/private.d.cts",
    "dist/private.d.mts",
    "dist/private.mjs",
    "dist/visual-distance.cjs",
    "dist/visual-distance.mjs",
    "dist/render-descriptor.cjs",
    "dist/render-descriptor.mjs",
    "dist/png-options.cjs",
    "dist/png-options.mjs",
    "dist/file-set-transaction.cjs",
    "dist/file-set-transaction.mjs",
  ]) {
    assert.ok(packedFiles.has(file), "Packed file is missing: " + file);
  }
  for (const file of packedFiles) {
    assert.equal(
      file === "index.html"
        || file === ".nojekyll"
        || ["src/", "tests/", "scripts/", "docs/", "node_modules/"].some((prefix) => file.startsWith(prefix)),
      false,
      "Unexpected packed file: " + file
    );
    assert.equal(file.includes("stale-artifact"), false);
  }

  return {
    esmCjsCoreParity: true,
    esmCjsReactImports: true,
    zeroRuntimeDependencies: true,
    packedFiles: packedFiles.size,
    isolatedBuildCleanup: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runPackageTests();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
