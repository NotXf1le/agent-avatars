import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAvatarDescriptor } from "../src/index.mjs";
import * as png from "../src/png.mjs";
import { normalizePngSize, normalizeSupersample } from "../src/png-options.mjs";

function dimensions(buffer) {
  assert.deepEqual(Array.from(buffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

export async function runPngTests() {
  for (const size of png.PLATFORM_PNG_SIZES) {
    const buffer = png.createAvatarPng("png-check", { size, namespace: "png" });
    assert.deepEqual(dimensions(buffer), [size, size]);
    assert.ok(buffer.length > 100);
  }

  assert.equal(normalizePngSize("32"), 32);
  assert.equal(normalizeSupersample(undefined, 1025), 3);
  assert.equal(normalizeSupersample(null, 1025), 3);
  assert.equal(normalizeSupersample(3, 1025), 3);
  assert.throws(
    () => normalizeSupersample(4, 1025),
    /PNG render for size 1025 and supersample 4 exceeds the 64 MiB buffer budget/
  );

  const onePixel = png.createAvatarPng("png-boundary", { size: 1, namespace: "png" });
  assert.deepEqual(dimensions(onePixel), [1, 1]);

  const descriptor = createAvatarDescriptor("descriptor-check", { namespace: "png" });
  const expected = png.createAvatarPngFromDescriptor(descriptor, 32);
  assert.deepEqual(dimensions(expected), [32, 32]);
  assert.throws(
    () => png.createAvatarPngFromDescriptor({ ...descriptor, styleVersion: "2" }, 32),
    /descriptor must be a 1 avatar descriptor/
  );
  assert.throws(
    () => png.createAvatarPngFromDescriptor({ ...descriptor, rows: [] }, 32),
    /descriptor\.rows must contain 4 integers/
  );
  assert.throws(
    () => png.createAvatarPngFromDescriptor({ ...descriptor, rows: [0, 0, 0, "1"] }, 32),
    /descriptor\.rows must contain 4 integers/
  );
  assert.throws(
    () => png.createAvatarPngFromDescriptor({
      ...descriptor,
      colors: { ...descriptor.colors, foreground: "\"><script>alert(1)</script>" },
    }, 32),
    /descriptor\.colors\.foreground must be a six-digit hexadecimal color/
  );

  const rowsMutatedAfterValidation = descriptor.rows.slice();
  const mutatingDescriptor = {
    ...descriptor,
    rows: rowsMutatedAfterValidation,
    get colors() {
      rowsMutatedAfterValidation.length = 0;
      return descriptor.colors;
    },
  };
  assert.deepEqual(png.createAvatarPngFromDescriptor(mutatingDescriptor, 32), expected);

  const directory = mkdtempSync(join(tmpdir(), "agent-avatars-"));
  try {
    const result = png.writeAvatarPngSet("export-check", directory, {
      namespace: "exports",
      baseName: "agent-icon",
    });
    for (const size of [32, 64, 192, 200]) {
      const file = readFileSync(result.paths[size]);
      assert.deepEqual(dimensions(file), [size, size]);
    }
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    assert.equal(manifest.schema, "deterministic-agent-avatars-png-export/v1");
    assert.equal(manifest.identityKey, result.descriptor.identityKey);
    assert.equal(Object.keys(manifest.files).length, 4);
    assert.equal(JSON.stringify(manifest).includes("export-check"), false, "PNG manifest leaked the seed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  return {
    pngSizes: [...png.PLATFORM_PNG_SIZES],
    descriptorBoundaryValidation: true,
    largeRenderPlansTestedWithoutAllocation: true,
  };
}
