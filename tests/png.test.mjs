import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAvatarDescriptor } from "../src/index.mjs";
import { replaceFileSetSync } from "../src/file-set-transaction.mjs";
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
  assert.throws(() => normalizePngSize(0), RangeError);
  assert.throws(() => normalizePngSize(NaN), TypeError);
  assert.throws(() => normalizeSupersample("2", 32), TypeError);
  assert.throws(() => normalizeSupersample(0, 32), RangeError);
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

  const validationRoot = mkdtempSync(join(tmpdir(), "agent-avatars-validation-"));
  try {
    const invalidOutput = join(validationRoot, "invalid-output");
    assert.throws(
      () => png.writeAvatarPngSet("invalid-export", invalidOutput, { sizes: [] }),
      /sizes must be a non-empty array/
    );
    assert.equal(existsSync(invalidOutput), false, "invalid options must not create the output directory");
  } finally {
    rmSync(validationRoot, { recursive: true, force: true });
  }

  const transactionRoot = mkdtempSync(join(tmpdir(), "agent-avatars-transaction-"));
  try {
    const oldFiles = {
      "agent-32.png": Buffer.from("old-32"),
      "agent-64.png": Buffer.from("old-64"),
      "agent-manifest.json": Buffer.from("old-manifest"),
    };
    for (const [name, data] of Object.entries(oldFiles)) writeFileSync(join(transactionRoot, name), data);
    writeFileSync(join(transactionRoot, "unrelated.txt"), "keep");

    let renameCount = 0;
    const failingFs = {
      ...nodeFs,
      renameSync(...args) {
        renameCount++;
        if (renameCount === 4) {
          const error = new Error("injected rename failure");
          error.code = "EIO";
          throw error;
        }
        return nodeFs.renameSync(...args);
      },
    };
    assert.throws(
      () => replaceFileSetSync(transactionRoot, [
        { name: "agent-32.png", data: Buffer.from("new-32") },
        { name: "agent-64.png", data: Buffer.from("new-64") },
        { name: "agent-manifest.json", data: "new-manifest", encoding: "utf8", commitLast: true },
      ], failingFs),
      /injected rename failure/
    );
    for (const [name, data] of Object.entries(oldFiles)) {
      assert.deepEqual(readFileSync(join(transactionRoot, name)), data);
    }
    assert.equal(readFileSync(join(transactionRoot, "unrelated.txt"), "utf8"), "keep");
    assert.equal(
      readdirSync(transactionRoot).some((name) => name.startsWith(".agent-avatars-stage-")),
      false,
      "rollback must remove staging data"
    );

    const freshOutput = join(transactionRoot, "fresh");
    let freshRenameCount = 0;
    const freshFailingFs = {
      ...nodeFs,
      renameSync(...args) {
        freshRenameCount++;
        if (freshRenameCount === 2) throw new Error("injected fresh failure");
        return nodeFs.renameSync(...args);
      },
    };
    assert.throws(
      () => replaceFileSetSync(freshOutput, [
        { name: "agent-32.png", data: Buffer.from("new-32") },
        { name: "agent-manifest.json", data: "new-manifest", encoding: "utf8", commitLast: true },
      ], freshFailingFs),
      /injected fresh failure/
    );
    assert.equal(existsSync(freshOutput), false, "failed fresh exports must leave no output directory");

    const writeFailureOutput = join(transactionRoot, "write-failure");
    let writeCount = 0;
    const writeFailingFs = {
      ...nodeFs,
      writeFileSync(...args) {
        writeCount++;
        if (writeCount === 2) throw new Error("injected staging write failure");
        return nodeFs.writeFileSync(...args);
      },
    };
    assert.throws(
      () => replaceFileSetSync(writeFailureOutput, [
        { name: "agent-32.png", data: Buffer.from("new-32") },
        { name: "agent-manifest.json", data: "new-manifest", encoding: "utf8", commitLast: true },
      ], writeFailingFs),
      /injected staging write failure/
    );
    assert.equal(existsSync(writeFailureOutput), false, "staging failures must leave no output directory");

    const blockedOutput = join(transactionRoot, "blocked-target");
    nodeFs.mkdirSync(join(blockedOutput, "agent-32.png"), { recursive: true });
    assert.throws(
      () => replaceFileSetSync(blockedOutput, [
        { name: "agent-32.png", data: Buffer.from("new-32") },
        { name: "agent-manifest.json", data: "new-manifest", encoding: "utf8", commitLast: true },
      ]),
      /must be absent or a regular file/
    );
    assert.equal(nodeFs.lstatSync(join(blockedOutput, "agent-32.png")).isDirectory(), true);
    assert.equal(
      readdirSync(blockedOutput).some((name) => name.startsWith(".agent-avatars-stage-")),
      false,
      "preflight failures must remove staging data"
    );

    const commitOrder = [];
    const recordingFs = {
      ...nodeFs,
      renameSync(source, target) {
        if (!source.includes("backup-")) commitOrder.push(target.split(/[\\/]/).pop());
        return nodeFs.renameSync(source, target);
      },
    };
    replaceFileSetSync(join(transactionRoot, "ordered"), [
      { name: "agent-32.png", data: Buffer.from("new-32") },
      { name: "agent-manifest.json", data: "new-manifest", encoding: "utf8", commitLast: true },
    ], recordingFs);
    assert.equal(commitOrder.at(-1), "agent-manifest.json");
  } finally {
    rmSync(transactionRoot, { recursive: true, force: true });
  }

  return {
    pngSizes: [...png.PLATFORM_PNG_SIZES],
    descriptorBoundaryValidation: true,
    largeRenderPlansTestedWithoutAllocation: true,
    transactionalFileSetWrites: true,
  };
}
