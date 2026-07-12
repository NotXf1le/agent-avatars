import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAvatarDescriptor,
  createIdentitySet,
} from "../src/index.mjs";
import { createAvatarPngSet } from "../src/png.mjs";
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
