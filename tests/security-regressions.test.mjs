import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAvatarDescriptor,
  createHashAvatar,
  createHashAvatarFromDescriptor,
  createIdentitySet,
  symmetricMaskFromRows,
  validateAvatarBitmap,
} from "../src/index.mjs";
import { createAvatarPng, createAvatarPngFromDescriptor, createAvatarPngSet } from "../src/png.mjs";
import { derivePrivateSeed } from "../src/private.mjs";

const MAX_CUSTOM_PALETTES = 256;
const MAX_IDENTITY_SET_ITEMS = 10_000;
const MAX_MANIFEST_ENTRIES = 10_000;
const MAX_PNG_SET_SIZES = 64;

function lowContrastPalette(index = 0) {
  return {
    id: `low-${index}`,
    light: ["#777777", "#777778"],
    dark: ["#777777", "#777778"],
  };
}

export async function runSecurityRegressionTests() {
  for (const value of ["false", 0, 1, null, {}, []]) {
    assert.throws(
      () => createAvatarDescriptor("boolean-boundary", {
        palette: lowContrastPalette(),
        allowLowContrast: value,
      }),
      /allowLowContrast must be a boolean/
    );
    assert.throws(
      () => createIdentitySet(["boolean-boundary"], { includeSvg: value }),
      /includeSvg must be a boolean/
    );
    assert.throws(
      () => createIdentitySet(["boolean-boundary"], { ensureUnique: value }),
      /ensureUnique must be a boolean/
    );
  }

  const allowedLowContrast = createAvatarDescriptor("boolean-control", {
    palette: lowContrastPalette(),
    allowLowContrast: true,
  });
  assert.equal(allowedLowContrast.paletteId, "low-0");
  assert.equal(
    Object.hasOwn(createIdentitySet(["boolean-control"], { includeSvg: false }).items[0], "svg"),
    false
  );

  const sparseRows = new Array(4);
  assert.throws(() => symmetricMaskFromRows(sparseRows), /rows must contain 4 integers/);
  assert.throws(() => validateAvatarBitmap(sparseRows), /rows must contain 4 integers/);
  const sparseGrid = Array.from({ length: 4 }, () => new Array(5));
  assert.throws(() => validateAvatarBitmap(sparseGrid), /grid must be a 4x5 boolean matrix/);
  const sparseOuterGrid = Array(4);
  sparseOuterGrid[0] = [false, false, false, false, false];
  assert.throws(() => validateAvatarBitmap(sparseOuterGrid), /grid must be a 4x5 boolean matrix/);

  const descriptor = createAvatarDescriptor("sparse-descriptor");
  const sparseDescriptor = { ...descriptor, rows: sparseRows };
  assert.throws(() => createHashAvatarFromDescriptor(sparseDescriptor), /descriptor\.rows must contain 4 integers/);
  assert.throws(() => createAvatarPngFromDescriptor(sparseDescriptor, 1), /descriptor\.rows must contain 4 integers/);

  const sparseSeeds = Array(2);
  sparseSeeds[1] = "present";
  assert.throws(() => createIdentitySet(sparseSeeds, { includeSvg: false }), /seeds must not contain holes/);
  assert.equal(createIdentitySet([undefined], { includeSvg: false }).items.length, 1);

  const sparsePalettes = Array(2);
  sparsePalettes[1] = ["#FFFFFF", "#111111"];
  assert.throws(
    () => createAvatarDescriptor("sparse-palette", { palettes: sparsePalettes, allowLowContrast: true }),
    /palettes must not contain holes/
  );
  const sparseSizes = Array(2);
  sparseSizes[1] = 32;
  assert.throws(() => createAvatarPngSet("sparse-size", { sizes: sparseSizes }), /sizes must not contain holes/);

  let rowReads = 0;
  const accessorRows = [31, 31, 31, 31];
  Object.defineProperty(accessorRows, 0, {
    enumerable: true,
    configurable: true,
    get() {
      rowReads++;
      return 31;
    },
  });
  symmetricMaskFromRows(accessorRows);
  assert.equal(rowReads, 1, "row accessors must be snapshotted exactly once");

  const customPalette = [["#FFFFFF", "#111111"]];
  for (const invoke of [
    () => createAvatarDescriptor("numeric-type", { minPixels: "6" }),
    () => createAvatarDescriptor("numeric-type", { minPixels: null }),
    () => createAvatarDescriptor("numeric-type", { minDensity: true }),
    () => createAvatarDescriptor("numeric-type", { maxDiagonalConnections: "2" }),
    () => createAvatarDescriptor("numeric-type", { connectivity: "4" }),
    () => createAvatarDescriptor("numeric-type", { maxHoles: "Infinity" }),
    () => createAvatarDescriptor("numeric-type", { palettes: customPalette, minimumContrast: "4.5" }),
    () => createAvatarDescriptor("numeric-type", { palettes: customPalette, minimumContrast: null }),
    () => createAvatarDescriptor("numeric-type", { collisionNonce: "1" }),
    () => createAvatarDescriptor("numeric-type", { collisionNonce: null }),
    () => createIdentitySet(["numeric-type"], { includeSvg: false, maxAttempts: "4" }),
    () => createIdentitySet(["numeric-type"], { includeSvg: false, minimumShapeDistance: "2" }),
    () => createIdentitySet(["numeric-type"], { includeSvg: false, minimumPaletteDistance: "2" }),
    () => createAvatarPng("numeric-type", { size: 32, supersample: "2" }),
    () => createHashAvatar("numeric-type", { size: null }),
    () => createAvatarPng("numeric-type", { size: null }),
    () => createAvatarPngSet("numeric-type", { sizes: null }),
  ]) {
    assert.throws(invoke, TypeError);
  }
  assert.throws(() => createAvatarDescriptor("numeric-range", { minPixels: 6.5 }), RangeError);
  assert.throws(() => createAvatarDescriptor("numeric-range", { minDensity: -0.1 }), RangeError);
  assert.throws(() => createAvatarDescriptor("numeric-range", { maxDiagonalConnections: -1 }), RangeError);
  assert.throws(() => createAvatarDescriptor("numeric-range", { maxHoles: -1 }), RangeError);
  assert.throws(
    () => createAvatarDescriptor("numeric-range", { palettes: customPalette, minimumContrast: 22 }),
    RangeError
  );
  assert.throws(() => createAvatarDescriptor("numeric-range", { collisionNonce: -1 }), RangeError);
  assert.throws(() => createIdentitySet(["numeric-range"], { includeSvg: false, maxAttempts: 0 }), RangeError);
  assert.throws(
    () => createIdentitySet(["numeric-range"], { includeSvg: false, minimumShapeDistance: 21 }),
    RangeError
  );
  assert.throws(
    () => createIdentitySet(["numeric-range"], { includeSvg: false, minimumPaletteDistance: 101 }),
    RangeError
  );
  assert.throws(() => createHashAvatar("numeric-range", { size: 4097 }), RangeError);
  assert.throws(() => createAvatarPng("numeric-range", { size: 4097 }), RangeError);
  assert.equal(typeof createHashAvatar("numeric-string", { size: "32" }), "string");
  assert.ok(createAvatarPng("numeric-string", { size: "32", supersample: null }) instanceof Uint8Array);

  assert.throws(
    () => createIdentitySet(["nonce"], { collisionNonce: 7 }),
    /collisionNonce is not supported by createIdentitySet/
  );

  const humanManifest = createIdentitySet([], { includeSvg: false, seedMode: "human" }).manifest;
  assert.throws(
    () => createIdentitySet([], { includeSvg: false, seedMode: "raw", manifest: humanManifest }),
    /Manifest options do not match the requested palette, constraints, or seed mode/
  );

  const oversizedPalettes = Array(MAX_CUSTOM_PALETTES + 1);
  let paletteReads = 0;
  Object.defineProperty(oversizedPalettes, 0, {
    enumerable: true,
    get() {
      paletteReads++;
      return lowContrastPalette();
    },
  });
  assert.throws(
    () => createAvatarDescriptor("palette-limit", {
      palettes: oversizedPalettes,
      allowLowContrast: true,
    }),
    /palettes must contain at most 256 entries/
  );
  assert.equal(paletteReads, 0, "palette entries must not be read after the count limit fails");

  const memoryModuleUrl = new URL("../src/index.mjs", import.meta.url).href;
  const memoryCheck = spawnSync(process.execPath, [
    "--expose-gc",
    "--max-old-space-size=128",
    "--input-type=module",
    "-e",
    `import { createIdentitySet, getCatalogStats } from ${JSON.stringify(memoryModuleUrl)};
     for (const maxPixels of [10, 11, 12, 13, 14, 15, 16, 17]) {
       getCatalogStats({ maxPixels });
       createIdentitySet(["one"], { maxPixels, minimumShapeDistance: 20, includeSvg: false });
       global.gc();
     }`,
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(memoryCheck.status, 0, memoryCheck.stderr || memoryCheck.error?.message);

  assert.throws(
    () => createIdentitySet(Array(MAX_IDENTITY_SET_ITEMS + 1), { includeSvg: false, ensureUnique: false }),
    /seeds must contain at most 10000 entries/
  );

  const manifest = createIdentitySet([], { includeSvg: false, ensureUnique: false }).manifest;
  let manifestEntryReads = 0;
  manifest.entries = new Proxy({}, {
    ownKeys() {
      return Array.from({ length: MAX_MANIFEST_ENTRIES + 1 }, (_, index) => index.toString(16).padStart(32, "0"));
    },
    getOwnPropertyDescriptor() {
      manifestEntryReads++;
      return { configurable: true, enumerable: true, value: {} };
    },
  });
  assert.throws(
    () => createIdentitySet([], { includeSvg: false, ensureUnique: false, manifest }),
    /manifest.entries must contain at most 10000 entries/
  );
  assert.equal(manifestEntryReads, 0, "manifest entries must not be read after the count limit fails");

  assert.throws(
    () => createAvatarPngSet("png-count-limit", {
      sizes: Array.from({ length: MAX_PNG_SET_SIZES + 1 }, (_, index) => index + 1),
      supersample: 1,
    }),
    /sizes must contain at most 64 entries/
  );
  assert.throws(
    () => createAvatarPngSet("png-work-limit", { sizes: [4096, 4095], supersample: 1 }),
    /PNG set exceeds the 16777216 render-pixel budget/
  );

  await assert.rejects(
    derivePrivateSeed("short-secret", { secret: "short" }),
    /secret must contain at least 32 encoded bytes/
  );
  assert.match(
    await derivePrivateSeed("valid-secret", { secret: "0123456789abcdef0123456789abcdef" }),
    /^hmac-sha256:/
  );

  return {
    strictBooleans: true,
    denseCollections: true,
    strictNumericContracts: true,
    boundedDistanceMemory: true,
    identityContracts: true,
    collectionLimits: true,
    pngAggregateLimits: true,
    privateSecretFloor: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runSecurityRegressionTests();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
