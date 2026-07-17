import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as api from "../src/index.mjs";
import * as privateApi from "../src/private.mjs";
import { createBoundedLruCache } from "../src/catalog-cache.mjs";
import {
  buildPaletteDistanceMatrix,
  deltaE2000,
  paletteDistance,
  shapeHammingDistance,
} from "../src/visual-distance.mjs";
import {
  assertPolicyPairs as assertPairwiseDistances,
  findInvalidDescriptorPair,
  oracleDeltaE2000,
  oraclePaletteDistance,
  oracleShapeHammingDistance,
} from "./visual-distance-oracle.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const bitmapKey = (rows) => rows.map((row) => row.toString(16).padStart(2, "0")).join("");
const PRIVATE_SECRET_A = "0123456789abcdef0123456789abcdef";
const PRIVATE_SECRET_B = "fedcba9876543210fedcba9876543210";

export async function runCoreTests() {
  assert.equal(api.STYLE_VERSION, "1");
  assert.equal(api.derivePrivateSeed, undefined, "Private helpers must not leak through the browser-safe root entry.");

  const cache = createBoundedLruCache(2);
  cache.set("first", 1);
  cache.set("second", 2);
  assert.equal(cache.get("first"), 1, "Cache reads must refresh recency.");
  cache.set("third", 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get("second"), undefined, "Least-recently-used entries must be evicted.");
  assert.equal(cache.get("first"), 1);
  assert.equal(cache.get("third"), 3);

  const standardStats = api.getCatalogStats();
  assert.equal(standardStats.styleVersion, "1");
  assert.equal(standardStats.rawSymmetricMasks, 4096);
  assert.equal(standardStats.validShapes, 1374);
  assert.equal(standardStats.availablePalettes, 16);
  assert.equal(standardStats.signatureStates, 21984);

  // Exhaustively validate the complete 12-bit symmetric mask space.
  let exhaustiveStandardCount = 0;
  for (let mask = 0; mask < 4096; mask++) {
    const rows = api.rowsFromSymmetricMask(mask);
    assert.equal(api.symmetricMaskFromRows(rows), mask, `Mask round-trip failed at ${mask}`);
    if (api.validateAvatarBitmap(rows).valid) exhaustiveStandardCount++;
  }
  assert.equal(exhaustiveStandardCount, 1374);

  for (const malformedRows of [
    [],
    [31],
    [31, 31, 31, 31, 31],
    ["31", "31", "31", "31"],
    null,
    undefined,
  ]) {
    assert.throws(
      () => api.symmetricMaskFromRows(malformedRows),
      /rows must contain 4 integers in \[0, 31\]/
    );
  }

  assert.throws(
    () => api.validateAvatarBitmap(Array.from({ length: 4 }, () => [1, 0, 0, 0, 1])),
    /grid must be a 4x5 boolean matrix/
  );

  const catalog = api.getAvatarCatalog();
  assert.equal(catalog.length, 1374);
  assert.equal(new Set(catalog.map((shape) => shape.id)).size, 1374);
  for (const shape of catalog) {
    const validation = api.validateAvatarBitmap(shape.rows);
    assert.equal(validation.valid, true, `Catalog shape ${shape.id} is invalid`);
  }

  const formerlyBrokenConstraints = [
    [{ minPixels: 6, maxPixels: 6, maxDiagonalConnections: 0 }, 14],
    [{ minPixels: 7, maxPixels: 7, maxDiagonalConnections: 0 }, 38],
    [{ minDensity: 0.70, maxDensity: 0.75 }, 106],
  ];
  for (const [options, expectedCount] of formerlyBrokenConstraints) {
    assert.equal(api.getCatalogStats(options).validShapes, expectedCount);
    for (let index = 0; index < 500; index++) {
      const bitmap = api.createAvatarDescriptor(`constraint:${expectedCount}:${index}`, options);
      assert.equal(api.validateAvatarBitmap(bitmap.rows, options).valid, true);
    }
  }

  assert.throws(
    () => api.createAvatarDescriptor("impossible", {
      minPixels: 20,
      maxPixels: 20,
      minDensity: 0.95,
      maxDensity: 0.95,
      maxDiagonalConnections: 0,
    }),
    /No symmetric 5x4 shape/
  );

  const repeated = api.createAvatarDescriptor("Felix", { namespace: "acme" });
  assert.deepEqual(repeated, api.createAvatarDescriptor("Felix", { namespace: "acme" }));
  assert.equal(
    api.createHashAvatar("Felix", { namespace: "acme" }),
    api.createHashAvatar("  felix  ", { namespace: "ACME" })
  );
  assert.notEqual(
    api.createHashAvatar("Felix", { seedMode: "raw", namespace: "acme" }),
    api.createHashAvatar("felix", { seedMode: "raw", namespace: "acme" })
  );

  assert.notEqual(api.hash32("domain-check"), api.hash32("domain-check", { domain: "custom" }));
  assert.throws(() => api.hash32("domain-check", { domain: "" }), /domain must be a non-empty string/);
  assert.throws(() => api.hash32("domain-check", { domain: "bad\u0000domain" }), /without null characters/);
  assert.notEqual(
    api.createAvatarDescriptor("same-id", { namespace: "tenant-a" }).signature,
    api.createAvatarDescriptor("same-id", { namespace: "tenant-b" }).signature
  );

  const light = api.createAvatarDescriptor("theme-check", { namespace: "acme", theme: "light" });
  const dark = api.createAvatarDescriptor("theme-check", { namespace: "acme", theme: "dark" });
  assert.equal(light.signature, dark.signature);
  assert.equal(light.shapeId, dark.shapeId);
  assert.equal(light.paletteId, dark.paletteId);
  assert.notDeepEqual(light.colors, dark.colors);
  assert.notEqual(
    api.createHashAvatar("theme-check", { namespace: "acme", theme: "light" }),
    api.createHashAvatar("theme-check", { namespace: "acme", theme: "dark" })
  );

  for (const palette of api.BUILTIN_PALETTES) {
    assert.ok(api.contrastRatio(palette.light.background, palette.light.foreground) >= 7.7);
    assert.ok(api.contrastRatio(palette.dark.background, palette.dark.foreground) >= 9.5);
  }
  for (const invalidColorPair of [
    ["bad", "#FFFFFF"],
    ["#000000extra", "#FFFFFF"],
    [null, "#FFFFFF"],
  ]) {
    assert.throws(
      () => api.contrastRatio(...invalidColorPair),
      /must be a six-digit hexadecimal color/
    );
  }

  assert.equal(shapeHammingDistance([0, 0, 0, 0], [0, 0, 0, 0]), 0);
  assert.equal(shapeHammingDistance([16, 0, 0, 0], [0, 0, 0, 0]), 1);
  assert.equal(shapeHammingDistance([31, 31, 31, 31], [0, 0, 0, 0]), 20);
  assert.equal(shapeHammingDistance([16, 7, 31, 4], [3, 12, 1, 20]), shapeHammingDistance([3, 12, 1, 20], [16, 7, 31, 4]));
  for (const [leftRows, rightRows] of [
    [[0, 0, 0, 0], [0, 0, 0, 0]],
    [[16, 7, 31, 4], [3, 12, 1, 20]],
    [[31, 31, 31, 31], [0, 0, 0, 0]],
  ]) {
    assert.equal(shapeHammingDistance(leftRows, rightRows), oracleShapeHammingDistance(leftRows, rightRows));
  }

  const sharmaReferencePairs = [
    { name: "reference pair 1", left: [50, 2.6772, -79.7751], right: [50, 0, -82.7485], expected: 2.0425 },
    { name: "zero chroma", left: [50, 0, 0], right: [50, -1, 2], expected: 2.3669 },
    { name: "hue 0/360 wrap", left: [50, 2.5, 0], right: [50, 0, -2.5], expected: 4.3065 },
    { name: "hue difference below 180", left: [50, 2.49, -0.001], right: [50, -2.49, 0.0009], expected: 7.1792 },
    { name: "hue difference above 180", left: [50, 2.49, -0.001], right: [50, -2.49, 0.0011], expected: 7.2195 },
  ];
  for (const { name, left, right, expected } of sharmaReferencePairs) {
    const forward = deltaE2000(left, right);
    const reverse = deltaE2000(right, left);
    const oracle = oracleDeltaE2000(left, right);
    assert.equal(Number.isFinite(forward), true, `${name} must be finite`);
    assert.ok(Math.abs(forward - expected) < 0.00005, `${name}: expected ${expected}, got ${forward}`);
    assert.ok(Math.abs(oracle - expected) < 0.00005, `${name} oracle: expected ${expected}, got ${oracle}`);
    assert.ok(Math.abs(forward - oracle) < 1e-12, `${name} production/oracle mismatch`);
    assert.ok(Math.abs(forward - reverse) < 1e-12, `${name} must be symmetric`);
  }

  const rose = api.BUILTIN_PALETTES.find((item) => item.id === "rose");
  const coral = api.BUILTIN_PALETTES.find((item) => item.id === "coral");
  const leaf = api.BUILTIN_PALETTES.find((item) => item.id === "leaf");
  assert.equal(paletteDistance(rose, coral), 0);
  assert.equal(oraclePaletteDistance(rose, coral), 0);
  assert.ok(Math.abs(paletteDistance(rose, leaf) - oraclePaletteDistance(rose, leaf)) < 1e-12);
  assert.ok(Math.abs(paletteDistance(rose, leaf) - paletteDistance(leaf, rose)) < 1e-12);
  const matrixPalettes = [rose, coral, leaf];
  const paletteMatrix = buildPaletteDistanceMatrix(matrixPalettes);
  assert.ok(paletteMatrix instanceof Float64Array);
  assert.equal(paletteMatrix.length, matrixPalettes.length ** 2);
  for (let left = 0; left < matrixPalettes.length; left++) {
    for (let right = 0; right < matrixPalettes.length; right++) {
      assert.equal(
        paletteMatrix[left * matrixPalettes.length + right],
        paletteDistance(matrixPalettes[left], matrixPalettes[right]),
        `palette matrix entry ${left}/${right} is not row-major pairwise distance`
      );
    }
  }
  const malformedPalette = { ...rose, light: { ...rose.light, background: "#fff" } };
  assert.throws(() => paletteDistance(malformedPalette, leaf), /six-digit hexadecimal color/);
  assert.throws(() => buildPaletteDistanceMatrix([rose, malformedPalette]), /six-digit hexadecimal color/);

  const customPalette = {
    id: "brand",
    light: { background: "#EDF4FF", foreground: "#183153" },
    dark: { background: "#15243A", foreground: "#E8F1FF" },
  };
  const branded = api.createAvatarDescriptor("brand-check", { palette: customPalette, namespace: "brand" });
  assert.equal(branded.paletteId, "brand");
  assert.equal(branded.colors.background, "#EDF4FF");
  const collidingPaletteSignatureFixtures = [
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
  assert.throws(
    () => api.createIdentitySet([], {
      palettes: collidingPaletteSignatureFixtures,
      allowLowContrast: true,
      includeSvg: false,
    }),
    (error) => error instanceof TypeError
      && /Selected palettes have a signature-key collision/.test(error.message)
      && /6de3e4d4/.test(error.message)
  );
  assert.doesNotThrow(() => api.createIdentitySet([], {
    palettes: collidingPaletteSignatureFixtures,
    palette: "collision-a",
    allowLowContrast: true,
    includeSvg: false,
  }));
  assert.throws(
    () => api.createHashAvatar("injection", {
      palette: {
        id: "bad",
        light: { background: '#fff" onload="alert(1)', foreground: "#111111" },
        dark: { background: "#111111", foreground: "#FFFFFF" },
      },
    }),
    /six-digit hexadecimal color/
  );
  assert.throws(
    () => api.createHashAvatar("low-contrast", {
      palette: {
        id: "bad-contrast",
        light: { background: "#FFFFFF", foreground: "#FDFDFD" },
        dark: { background: "#111111", foreground: "#121212" },
      },
    }),
    /insufficient contrast/
  );

  const seenShapes = new Set();
  const seenStates = new Set();
  const seenPalettes = new Set();
  for (let index = 0; index < 15000; index++) {
    const descriptor = api.createAvatarDescriptor(`distribution:${index}`, { namespace: "distribution-test" });
    seenShapes.add(descriptor.shapeId);
    seenStates.add(descriptor.signature);
    seenPalettes.add(descriptor.paletteIndex);
  }
  assert.equal(seenShapes.size, 1374);
  assert.ok(seenStates.size > 10500, `Only ${seenStates.size} unique states in 15,000 samples`);
  assert.equal(seenPalettes.size, 16);

  const ids = Array.from({ length: 500 }, (_, index) => `agent:${index}`);
  const firstSet = api.createIdentitySet(ids, { namespace: "batch", includeSvg: false });
  assert.equal(firstSet.items.length, 500);
  assert.equal(new Set(firstSet.items.map((item) => item.signature)).size, 500);
  assert.equal(Object.keys(firstSet.manifest.entries).length, 500);
  assert.equal(firstSet.manifest.schema, "deterministic-agent-avatars-manifest/v1");
  assert.equal(JSON.stringify(firstSet.manifest).includes("agent:"), false, "Manifest leaked raw identifiers");

  const reversedSet = api.createIdentitySet([...ids].reverse(), { namespace: "batch", includeSvg: false });
  const expectedById = new Map(firstSet.items.map((item) => [item.input, item.signature]));
  for (const item of reversedSet.items) assert.equal(item.signature, expectedById.get(item.input));

  const expandedSet = api.createIdentitySet([...ids, "agent:new"], {
    namespace: "batch",
    includeSvg: false,
    manifest: firstSet.manifest,
  });
  for (const item of expandedSet.items.slice(0, ids.length)) {
    assert.equal(item.signature, expectedById.get(item.input));
  }
  assert.equal(Object.keys(expandedSet.manifest.entries).length, 501);

  const duplicateSet = api.createIdentitySet(["same", "same", "other"], { namespace: "duplicates", includeSvg: false });
  assert.equal(duplicateSet.items[0].signature, duplicateSet.items[1].signature);
  assert.notEqual(duplicateSet.items[0].signature, duplicateSet.items[2].signature);

  const nonUniqueOptions = {
    namespace: "non-unique-manifest",
    includeSvg: false,
    ensureUnique: false,
    minPixels: 6,
    maxPixels: 6,
    maxDiagonalConnections: 0,
    palettes: [["#FFFFFF", "#111111"]],
  };
  const nonUniqueSeeds = Array.from({ length: 15 }, (_, index) => `non-unique:${index}`);
  const nonUniqueSet = api.createIdentitySet(nonUniqueSeeds, nonUniqueOptions);
  assert.equal(nonUniqueSet.stateSpace, 14);
  assert.equal(Object.keys(nonUniqueSet.manifest.entries).length, 15);
  assert.ok(new Set(nonUniqueSet.items.map((item) => item.signature)).size < nonUniqueSet.items.length);

  const rehydratedNonUniqueSet = api.createIdentitySet([...nonUniqueSeeds, "non-unique:next"], {
    ...nonUniqueOptions,
    manifest: nonUniqueSet.manifest,
  });
  assert.equal(Object.keys(rehydratedNonUniqueSet.manifest.entries).length, 16);
  for (let index = 0; index < nonUniqueSeeds.length; index++) {
    assert.equal(rehydratedNonUniqueSet.items[index].signature, nonUniqueSet.items[index].signature);
  }
  assert.throws(
    () => api.createIdentitySet([], {
      ...nonUniqueOptions,
      ensureUnique: true,
      manifest: nonUniqueSet.manifest,
    }),
    /Manifest contains 15 entries.*state space contains only 14/
  );

  const distantPalettes = [
    { id: "mono", light: ["#FFFFFF", "#111111"], dark: ["#FFFFFF", "#111111"] },
    { id: "blue", light: ["#0B1F66", "#FFFFFF"], dark: ["#0B1F66", "#FFFFFF"] },
  ];
  const allocationSeeds = [
    "ada", "bert", "claude", "dora", "eliza", "felix", "gemma", "hal", "iris", "jules",
    "kira", "linus", "maya", "nora", "otto", "piper", "quinn", "rhea", "sam", "turing",
  ];

  const shapePolicyOptions = {
    namespace: "distance-shape",
    includeSvg: false,
    minimumShapeDistance: 4,
    minimumPaletteDistance: 0,
    maxAttempts: 4096,
  };
  const shapeDistanceSet = api.createIdentitySet(allocationSeeds.slice(0, 8), shapePolicyOptions);
  const shapeDistancePairs = assertPairwiseDistances(shapeDistanceSet.items, shapeDistanceSet.manifest.distinguishability);
  assert.ok(
    shapeDistancePairs.some((pair) => pair.shape === shapePolicyOptions.minimumShapeDistance),
    "shape distance exactly equal to the threshold must be accepted"
  );
  const shapeDistanceReversed = api.createIdentitySet(allocationSeeds.slice(0, 8).reverse(), shapePolicyOptions);
  const shapeByInput = new Map(shapeDistanceSet.items.map((item) => [item.input, item.signature]));
  for (const item of shapeDistanceReversed.items) assert.equal(item.signature, shapeByInput.get(item.input));

  const paletteDistanceSet = api.createIdentitySet(["palette-one", "palette-two"], {
    namespace: "distance-palette",
    includeSvg: false,
    palettes: distantPalettes,
    minimumPaletteDistance: 20,
    maxAttempts: 4096,
  });
  assertPairwiseDistances(paletteDistanceSet.items, paletteDistanceSet.manifest.distinguishability);
  const paletteEqualityChoices = [
    api.BUILTIN_PALETTES.find((item) => item.id === "rose"),
    api.BUILTIN_PALETTES.find((item) => item.id === "leaf"),
  ];
  const exactPaletteThreshold = paletteDistance(...paletteEqualityChoices);
  const paletteEqualitySet = api.createIdentitySet(["palette-equality-a", "palette-equality-b"], {
    namespace: "distance-palette-equality",
    includeSvg: false,
    palettes: paletteEqualityChoices,
    minimumPaletteDistance: exactPaletteThreshold,
    maxAttempts: 4096,
  });
  const paletteEqualityPairs = assertPairwiseDistances(
    paletteEqualitySet.items,
    paletteEqualitySet.manifest.distinguishability
  );
  assert.equal(paletteEqualityPairs[0].palette, exactPaletteThreshold);

  const shapeEitherOnly = api.createIdentitySet(allocationSeeds.slice(0, 6), {
    namespace: "distance-one-channel-shape",
    includeSvg: false,
    minimumShapeDistance: 4,
    distanceMode: "either",
  });
  const shapeBothOnly = api.createIdentitySet(allocationSeeds.slice(0, 6), {
    namespace: "distance-one-channel-shape",
    includeSvg: false,
    minimumShapeDistance: 4,
    distanceMode: "both",
  });
  assert.deepEqual(
    shapeBothOnly.items.map((item) => item.signature),
    shapeEitherOnly.items.map((item) => item.signature)
  );

  const paletteEitherOnly = api.createIdentitySet(["palette-one", "palette-two"], {
    namespace: "distance-one-channel-palette",
    includeSvg: false,
    palettes: distantPalettes,
    minimumPaletteDistance: 20,
    distanceMode: "either",
  });
  const paletteBothOnly = api.createIdentitySet(["palette-one", "palette-two"], {
    namespace: "distance-one-channel-palette",
    includeSvg: false,
    palettes: distantPalettes,
    minimumPaletteDistance: 20,
    distanceMode: "both",
  });
  assert.deepEqual(
    paletteBothOnly.items.map((item) => item.signature),
    paletteEitherOnly.items.map((item) => item.signature)
  );

  const eitherDistanceSet = api.createIdentitySet(allocationSeeds, {
    namespace: "distance-either-0",
    includeSvg: false,
    palettes: distantPalettes,
    minimumShapeDistance: 4,
    minimumPaletteDistance: 20,
    distanceMode: "either",
    maxAttempts: 4096,
  });
  const eitherPairs = assertPairwiseDistances(eitherDistanceSet.items, eitherDistanceSet.manifest.distinguishability);
  assert.ok(eitherPairs.some((pair) => !pair.shapePasses && pair.palettePasses), "either must accept a palette-only passing pair");
  assert.ok(eitherPairs.some((pair) => pair.shapePasses && !pair.palettePasses), "either must accept a shape-only passing pair");

  const bothDistanceSet = api.createIdentitySet(["both-one", "both-two"], {
    namespace: "distance-both",
    includeSvg: false,
    palettes: distantPalettes,
    minimumShapeDistance: 4,
    minimumPaletteDistance: 20,
    distanceMode: "both",
    maxAttempts: 4096,
  });
  assertPairwiseDistances(bothDistanceSet.items, bothDistanceSet.manifest.distinguishability);

  const policyDuplicateSet = api.createIdentitySet(["repeat", "repeat", "distinct"], {
    namespace: "distance-duplicates",
    includeSvg: false,
    minimumShapeDistance: 4,
  });
  assert.equal(policyDuplicateSet.items[0].signature, policyDuplicateSet.items[1].signature);
  assertPairwiseDistances(policyDuplicateSet.items, policyDuplicateSet.manifest.distinguishability);

  assert.throws(
    () => api.createIdentitySet(["exhaust-first", "exhaust-second"], {
      namespace: "distance-exhaustion",
      includeSvg: false,
      minPixels: 6,
      maxPixels: 6,
      maxDiagonalConnections: 0,
      palettes: [["#FFFFFF", "#111111"]],
      minimumShapeDistance: 20,
      minimumPaletteDistance: 20,
      distanceMode: "both",
      maxAttempts: 32,
    }),
    (error) => error instanceof Error
      && /deterministic allocation attempts exhausted/.test(error.message)
      && /identity [0-9a-f]{32}/.test(error.message)
      && /accepted unique count 1/.test(error.message)
      && /shape=20/.test(error.message)
      && /palette=20/.test(error.message)
      && /mode=both/.test(error.message)
      && /attempts=32\/32/.test(error.message)
      && /lower thresholds/.test(error.message)
      && /add palettes/.test(error.message)
      && /increase maxAttempts/.test(error.message)
      && !/impossible/i.test(error.message)
  );

  const relaxedDistanceSet = api.createIdentitySetWithFallback(["exhaust-first", "exhaust-second"], {
    namespace: "distance-exhaustion",
    includeSvg: false,
    minPixels: 6,
    maxPixels: 6,
    maxDiagonalConnections: 0,
    palettes: [["#FFFFFF", "#111111"]],
    minimumShapeDistance: 20,
    minimumPaletteDistance: 20,
    distanceMode: "both",
    maxAttempts: 32,
  });
  assert.equal(relaxedDistanceSet.items.length, 2);
  assert.equal(relaxedDistanceSet.policyAdjustment.reason, "capacity");
  assert.equal(relaxedDistanceSet.policyAdjustment.requested.minimumShapeDistance, 20);
  assert.equal(relaxedDistanceSet.policyAdjustment.requested.minimumPaletteDistance, 20);
  assert.equal(relaxedDistanceSet.policyAdjustment.applied, null);

  for (const value of [1.5, -1, 21, NaN, Infinity, -Infinity, "1", null, true]) {
    assert.throws(
      () => api.createIdentitySet(["distance"], { minimumShapeDistance: value }),
      (error) => error instanceof TypeError && /minimumShapeDistance/.test(error.message)
    );
  }
  for (const value of [-1, 101, NaN, Infinity, -Infinity, "1", null, true]) {
    assert.throws(
      () => api.createIdentitySet(["distance"], { minimumPaletteDistance: value }),
      (error) => error instanceof TypeError && /minimumPaletteDistance/.test(error.message)
    );
  }
  assert.throws(
    () => api.createIdentitySet(["distance"], { minimumShapeDistance: 1, distanceMode: "all" }),
    (error) => error instanceof TypeError && /distanceMode/.test(error.message)
  );
  for (const distanceMode of ["all", "", null, 1, true]) {
    assert.throws(
      () => api.createIdentitySet(["distance"], {
        minimumShapeDistance: 0,
        minimumPaletteDistance: 0,
        distanceMode,
      }),
      (error) => error instanceof TypeError && /distanceMode/.test(error.message)
    );
  }
  assert.throws(
    () => api.createIdentitySet(["distance"], { minimumShapeDistance: 1, ensureUnique: false }),
    (error) => error instanceof TypeError && /ensureUnique/.test(error.message)
  );
  assert.throws(
    () => api.createIdentitySet(["distance"], { minimumPaletteDistance: 1, ensureUnique: false }),
    (error) => error instanceof TypeError && /ensureUnique/.test(error.message)
  );

  const compatibilitySet = api.createIdentitySet(["compat"], { namespace: "compat", includeSvg: false });
  assert.equal(compatibilitySet.manifest.namespaceKey, "acc83a9ffab11478302290a7d8436af5");
  assert.equal(compatibilitySet.manifest.optionsKey, "7f7b1160442acdacfa41594a921a731d");
  assert.equal(compatibilitySet.items[0].signature, "1:s27a:p4bf38148");
  assert.equal(Object.hasOwn(compatibilitySet.manifest, "distinguishability"), false);
  assert.doesNotThrow(() => api.createIdentitySet(["compat"], {
    namespace: "compat",
    includeSvg: false,
    manifest: compatibilitySet.manifest,
  }));
  for (const distinguishability of [
    undefined,
    null,
    { schema: "visual-distance/v1", minimumShapeDistance: 0, minimumPaletteDistance: 0, mode: "either" },
  ]) {
    assert.throws(
      () => api.createIdentitySet(["compat"], {
        namespace: "compat",
        includeSvg: false,
        manifest: { ...compatibilitySet.manifest, distinguishability },
      }),
      (error) => error instanceof TypeError
        && /Manifest distinguishability policy does not match/.test(error.message)
    );
  }

  const disabledDistanceSet = api.createIdentitySet(["compat"], {
    namespace: "compat",
    includeSvg: false,
    minimumShapeDistance: 0,
    minimumPaletteDistance: 0,
    distanceMode: "both",
  });
  assert.deepEqual(disabledDistanceSet, compatibilitySet);

  const distancePolicy = Object.freeze({
    schema: "visual-distance/v1",
    minimumShapeDistance: 2,
    minimumPaletteDistance: 0,
    mode: "either",
  });
  const distanceSet = api.createIdentitySet(["policy"], {
    namespace: "policy",
    includeSvg: false,
    minimumShapeDistance: 2,
  });
  assert.deepEqual(distanceSet.manifest.distinguishability, distancePolicy);
  assert.equal(Object.isFrozen(distanceSet.manifest.distinguishability), true);
  const manifestPolicyFallback = api.createIdentitySetWithFallback(["policy"], {
    namespace: "policy",
    includeSvg: false,
    minimumShapeDistance: 9,
    minimumPaletteDistance: 30,
    distanceMode: "both",
    manifest: distanceSet.manifest,
  });
  assert.deepEqual(manifestPolicyFallback.manifest, distanceSet.manifest);
  assert.equal(manifestPolicyFallback.policyAdjustment.reason, "manifest-policy");
  assert.deepEqual(manifestPolicyFallback.policyAdjustment.applied, distancePolicy);
  const upperBoundarySet = api.createIdentitySet(["upper-boundaries"], {
    includeSvg: false,
    minimumShapeDistance: 20,
    minimumPaletteDistance: 100,
  });
  assert.equal(upperBoundarySet.manifest.distinguishability.minimumShapeDistance, 20);
  assert.equal(upperBoundarySet.manifest.distinguishability.minimumPaletteDistance, 100);
  const negativeZeroShapeSet = api.createIdentitySet(["negative-zero-shape"], {
    includeSvg: false,
    minimumShapeDistance: -0,
    minimumPaletteDistance: 1,
  });
  assert.equal(Object.is(negativeZeroShapeSet.manifest.distinguishability.minimumShapeDistance, -0), false);
  const negativeZeroPaletteSet = api.createIdentitySet(["negative-zero-palette"], {
    includeSvg: false,
    minimumShapeDistance: 1,
    minimumPaletteDistance: -0,
  });
  assert.equal(Object.is(negativeZeroPaletteSet.manifest.distinguishability.minimumPaletteDistance, -0), false);
  assert.doesNotThrow(() => api.createIdentitySet(["policy"], {
    namespace: "policy",
    includeSvg: false,
    minimumShapeDistance: 2,
    manifest: distanceSet.manifest,
  }));
  for (const manifest of [
    JSON.parse(JSON.stringify(distanceSet.manifest)),
    structuredClone(distanceSet.manifest),
  ]) {
    assert.doesNotThrow(() => api.createIdentitySet(["policy"], {
      namespace: "policy",
      includeSvg: false,
      minimumShapeDistance: 2,
      manifest,
    }));
  }
  const nullPrototypePolicy = Object.assign(Object.create(null), distancePolicy);
  const symbolPolicy = { ...distancePolicy, [Symbol("unexpected")]: true };
  const nonEnumerablePolicy = { ...distancePolicy };
  Object.defineProperty(nonEnumerablePolicy, "unexpected", { value: true });
  let accessorReads = 0;
  const accessorPolicy = { ...distancePolicy };
  Object.defineProperty(accessorPolicy, "mode", {
    enumerable: true,
    get() {
      accessorReads++;
      return "either";
    },
  });
  for (const distinguishability of [
    undefined,
    { ...distancePolicy, schema: "visual-distance/v2" },
    { ...distancePolicy, minimumShapeDistance: 3 },
    { ...distancePolicy, minimumPaletteDistance: 1 },
    { ...distancePolicy, minimumPaletteDistance: -0 },
    { ...distancePolicy, mode: "both" },
    { ...distancePolicy, unexpected: true },
    nullPrototypePolicy,
    symbolPolicy,
    nonEnumerablePolicy,
    accessorPolicy,
  ]) {
    const manifest = { ...distanceSet.manifest };
    if (distinguishability === undefined) delete manifest.distinguishability;
    else manifest.distinguishability = distinguishability;
    assert.throws(
      () => api.createIdentitySet(["policy"], {
        namespace: "policy",
        includeSvg: false,
        minimumShapeDistance: 2,
        manifest,
      }),
      (error) => error instanceof TypeError && /Manifest distinguishability policy does not match/.test(error.message)
    );
  }
  assert.equal(accessorReads, 0);

  const growthOptions = {
    namespace: "policy-growth",
    includeSvg: false,
    ensureUnique: true,
    minimumShapeDistance: 4,
    minimumPaletteDistance: 20,
    distanceMode: "either",
    maxAttempts: 4096,
  };
  const growthSeeds = ["ops-a", "ops-b", "ops-c"];
  const initialGrowth = api.createIdentitySet(growthSeeds, growthOptions);
  const initialGrowthEntries = structuredClone(initialGrowth.manifest.entries);
  const expandedGrowth = api.createIdentitySet([...growthSeeds, "ops-d"], {
    ...growthOptions,
    manifest: initialGrowth.manifest,
  });
  for (const [identityKey, entry] of Object.entries(initialGrowthEntries)) {
    assert.deepEqual(expandedGrowth.manifest.entries[identityKey], entry);
  }
  assert.equal(Object.keys(expandedGrowth.manifest.entries).length, 4);
  assertPairwiseDistances(expandedGrowth.items, expandedGrowth.manifest.distinguishability);

  const historicalOnlyGrowth = api.createIdentitySet(["ops-d"], {
    ...growthOptions,
    manifest: initialGrowth.manifest,
  });
  assert.equal(Object.keys(historicalOnlyGrowth.manifest.entries).length, 4);
  const historicalDescriptors = growthSeeds.map((seed) => {
    const identityKey = initialGrowth.items.find((item) => item.input === seed).identityKey;
    const entry = historicalOnlyGrowth.manifest.entries[identityKey];
    return {
      identityKey,
      signature: entry.signature,
      descriptor: api.createAvatarDescriptor(seed, { ...growthOptions, collisionNonce: entry.nonce }),
    };
  });
  assertPairwiseDistances(
    [...historicalDescriptors, historicalOnlyGrowth.items[0]],
    historicalOnlyGrowth.manifest.distinguishability
  );

  const legacyTampered = structuredClone(firstSet.manifest);
  const legacyTamperedKey = Object.keys(legacyTampered.entries)[0];
  legacyTampered.entries[legacyTamperedKey].shapeId = "sfff";
  assert.throws(
    () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: legacyTampered }),
    /Invalid manifest entry/
  );

  for (const invalidEntry of [
    null,
    { nonce: -1, signature: "x", shapeId: "s000", paletteId: "rose" },
    { nonce: 0, signature: 1, shapeId: "s000", paletteId: "rose" },
    { nonce: 0, signature: "x", shapeId: 1, paletteId: "rose" },
    { nonce: 0, signature: "x", shapeId: "s000", paletteId: 1 },
  ]) {
    const malformed = structuredClone(firstSet.manifest);
    malformed.entries[Object.keys(malformed.entries)[0]] = invalidEntry;
    assert.throws(
      () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: malformed }),
      /Invalid manifest entry/
    );
  }
  let manifestEntryAccessorReads = 0;
  const accessorEntryManifest = structuredClone(firstSet.manifest);
  const accessorEntryKey = Object.keys(accessorEntryManifest.entries)[0];
  Object.defineProperty(accessorEntryManifest.entries[accessorEntryKey], "signature", {
    enumerable: true,
    get() {
      manifestEntryAccessorReads++;
      return firstSet.manifest.entries[accessorEntryKey].signature;
    },
  });
  assert.throws(
    () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: accessorEntryManifest }),
    /Invalid manifest entry/
  );
  assert.equal(manifestEntryAccessorReads, 0);
  let manifestEntriesAccessorReads = 0;
  const accessorEntriesManifest = { ...firstSet.manifest };
  Object.defineProperty(accessorEntriesManifest, "entries", {
    enumerable: true,
    get() {
      manifestEntriesAccessorReads++;
      return firstSet.manifest.entries;
    },
  });
  assert.throws(
    () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: accessorEntriesManifest }),
    /manifest must be a plain JSON object/
  );
  assert.equal(manifestEntriesAccessorReads, 0);
  assert.doesNotThrow(() => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: undefined }));
  for (const manifest of [null, false, 0, ""]) {
    assert.throws(
      () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest }),
      (error) => error instanceof TypeError && /manifest must be a plain JSON object/.test(error.message)
    );
  }
  const nullPrototypeManifest = Object.assign(Object.create(null), firstSet.manifest);
  const symbolManifest = { ...firstSet.manifest, [Symbol("unexpected")]: true };
  const extraManifest = { ...firstSet.manifest, unexpected: true };
  const nonEnumerableManifest = { ...firstSet.manifest };
  Object.defineProperty(nonEnumerableManifest, "unexpected", { value: true });
  for (const manifest of [nullPrototypeManifest, symbolManifest, extraManifest, nonEnumerableManifest]) {
    assert.throws(
      () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest }),
      (error) => error instanceof TypeError && /manifest must be a plain JSON object/.test(error.message)
    );
  }
  let manifestSchemaAccessorReads = 0;
  const accessorSchemaManifest = { ...firstSet.manifest };
  Object.defineProperty(accessorSchemaManifest, "schema", {
    enumerable: true,
    get() {
      manifestSchemaAccessorReads++;
      return firstSet.manifest.schema;
    },
  });
  assert.throws(
    () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: accessorSchemaManifest }),
    (error) => error instanceof TypeError && /manifest must be a plain JSON object/.test(error.message)
  );
  assert.equal(manifestSchemaAccessorReads, 0);
  const throwingManifestProxy = new Proxy({}, {
    ownKeys() {
      throw new Error("proxy trap detail must not escape");
    },
  });
  assert.throws(
    () => api.createIdentitySet([], { namespace: "batch", includeSvg: false, manifest: throwingManifestProxy }),
    (error) => error instanceof TypeError
      && /manifest must be a plain JSON object/.test(error.message)
      && !/proxy trap detail/.test(error.message)
  );
  const tinyManifestOptions = {
    includeSvg: false,
    minPixels: 6,
    maxPixels: 6,
    maxDiagonalConnections: 0,
    palettes: [["#FFFFFF", "#111111"]],
  };
  const oversizedTinyManifest = structuredClone(api.createIdentitySet([], tinyManifestOptions).manifest);
  let oversizedEntryReads = 0;
  for (let index = 0; index < 15; index++) {
    Object.defineProperty(oversizedTinyManifest.entries, index.toString(16).padStart(32, "0"), {
      enumerable: true,
      get() {
        oversizedEntryReads++;
        return {};
      },
    });
  }
  assert.throws(
    () => api.createIdentitySet([], { ...tinyManifestOptions, manifest: oversizedTinyManifest }),
    (error) => error instanceof RangeError
      && /Manifest contains 15 entries/.test(error.message)
      && /state space contains only 14/.test(error.message)
  );
  assert.equal(oversizedEntryReads, 0);

  const selectedPaletteOptions = {
    namespace: "selected-palette-manifest",
    includeSvg: false,
    palettes: [
      { id: "unused", light: ["#FFFFFF", "#111111"], dark: ["#FFFFFF", "#111111"] },
      { id: "chosen", light: ["#0B1F66", "#FFFFFF"], dark: ["#0B1F66", "#FFFFFF"] },
    ],
    palette: 1,
    minimumShapeDistance: 2,
  };
  const selectedPaletteSet = api.createIdentitySet(["selected-a", "selected-b", "selected-c"], selectedPaletteOptions);
  assert.ok(selectedPaletteSet.items.every((item) => item.descriptor.paletteId === "chosen"));
  assertPairwiseDistances(selectedPaletteSet.items, selectedPaletteSet.manifest.distinguishability);
  const wrongSelectedPalette = structuredClone(selectedPaletteSet.manifest);
  wrongSelectedPalette.entries[selectedPaletteSet.items[0].identityKey].paletteId = "unused";
  assert.throws(
    () => api.createIdentitySet([], { ...selectedPaletteOptions, manifest: wrongSelectedPalette }),
    /Invalid manifest entry/
  );

  const invalidPairBase = api.createIdentitySet([], growthOptions);
  const invalidPair = findInvalidDescriptorPair(api, "persisted-state", growthOptions);
  assert.ok(invalidPair, "deterministic fixture search must find a signature-consistent invalid pair");
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
  assert.throws(
    () => api.createIdentitySet([], { ...growthOptions, manifest: invalidPairManifest }),
    (error) => error instanceof Error
      && /Manifest contains an invalid visual-distance assignment/.test(error.message)
      && !/persisted-state/.test(error.message)
  );

  const currentSeedTampered = structuredClone(initialGrowth.manifest);
  const currentSeedEntry = currentSeedTampered.entries[initialGrowth.items[0].identityKey];
  const replacement = Array.from({ length: 300 }, (_, index) =>
    api.createAvatarDescriptor(`persisted-state:${index}`, growthOptions)
  ).find((candidate) => candidate.signature !== currentSeedEntry.signature);
  Object.assign(currentSeedEntry, {
    signature: replacement.signature,
    shapeId: replacement.shapeId,
    paletteId: replacement.paletteId,
  });
  assert.throws(
    () => api.createIdentitySet([initialGrowth.items[0].input], { ...growthOptions, manifest: currentSeedTampered }),
    /no longer resolves to its stored signature/
  );

  assert.throws(
    () => api.createIdentitySet(Array.from({ length: 15 }, (_, index) => `tiny:${index}`), {
      includeSvg: false,
      minPixels: 6,
      maxPixels: 6,
      maxDiagonalConnections: 0,
      palettes: [["#FFFFFF", "#111111"]],
    }),
    /state space contains only 14/
  );

  const privateOne = await privateApi.derivePrivateSeed("person@example.com", { secret: PRIVATE_SECRET_A, namespace: "tenant" });
  const privateTwo = await privateApi.derivePrivateSeed("person@example.com", { secret: PRIVATE_SECRET_A, namespace: "tenant" });
  const privateOtherSecret = await privateApi.derivePrivateSeed("person@example.com", { secret: PRIVATE_SECRET_B, namespace: "tenant" });
  const privateOtherNamespace = await privateApi.derivePrivateSeed("person@example.com", { secret: PRIVATE_SECRET_A, namespace: "other" });
  assert.equal(privateOne, privateTwo);
  assert.notEqual(privateOne, privateOtherSecret);
  assert.notEqual(privateOne, privateOtherNamespace);
  assert.equal(privateOne.includes("person@example.com"), false);
  assert.match(privateOne, /^hmac-sha256:[0-9a-f]{64}$/);

  assert.throws(() => api.createHashAvatar("x", '96" onload="alert(1)'), /Avatar size/);
  assert.throws(
    () => api.createHashAvatar("x", { size: 0.00001 }),
    /Avatar size.*rounds to zero/
  );
  const renderDescriptor = api.createAvatarDescriptor("descriptor-boundary", { namespace: "rendering" });
  assert.throws(
    () => api.createHashAvatarFromDescriptor({ ...renderDescriptor, rows: [0, 0, 0] }),
    /descriptor\.rows must contain 4 integers/
  );
  const expectedDescriptorSvg = api.createHashAvatarFromDescriptor(renderDescriptor);
  const rowsMutatedAfterValidation = renderDescriptor.rows.slice();
  const mutatingDescriptor = {
    ...renderDescriptor,
    rows: rowsMutatedAfterValidation,
    get colors() {
      rowsMutatedAfterValidation.length = 0;
      return renderDescriptor.colors;
    },
  };
  assert.equal(api.createHashAvatarFromDescriptor(mutatingDescriptor), expectedDescriptorSvg);
  for (const field of ["background", "foreground"]) {
    const unsafeDescriptor = {
      ...renderDescriptor,
      colors: {
        ...renderDescriptor.colors,
        [field]: '\"><script>globalThis.pwned=1</script><circle fill=\"',
      },
    };
    assert.throws(
      () => api.createHashAvatarFromDescriptor(unsafeDescriptor),
      new RegExp(`descriptor\\.colors\\.${field} must be a six-digit hexadecimal color`)
    );
  }
  assert.ok(api.avatarDataUri("x").startsWith("data:image/svg+xml;charset=UTF-8,"));
  const visual = api.createHashAvatar("visual-contract");
  assert.equal(visual.includes("undefined"), false);
  assert.equal((visual.match(/<circle/g) ?? []).length, 1);
  assert.equal((visual.match(/<path/g) ?? []).length, 1);

  const golden = JSON.parse(readFileSync(new URL("./golden/avatar.json", import.meta.url), "utf8"));
  for (const item of golden) {
    const svg = api.createHashAvatar(item.seed, item.size, item.options);
    const descriptor = api.createAvatarDescriptor(item.seed, item.options);
    assert.equal(digest(svg), item.svgSha256, `Golden SVG changed: ${item.name}`);
    assert.equal(descriptor.signature, item.signature, `Golden signature changed: ${item.name}`);
    assert.equal(bitmapKey(descriptor.rows), bitmapKey(item.rows), `Golden bitmap changed: ${item.name}`);
    assert.equal(descriptor.paletteId, item.paletteId, `Golden palette changed: ${item.name}`);
  }

  return {
    rawMasksChecked: 4096,
    standardShapes: exhaustiveStandardCount,
    distributionSamples: 15000,
    distributionUniqueStates: seenStates.size,
    batchUnique: 500,
    goldenCases: golden.length,
  };
}
