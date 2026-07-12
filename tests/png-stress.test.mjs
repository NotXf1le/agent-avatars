import assert from "node:assert/strict";
import * as png from "../src/png.mjs";

function dimensions(buffer) {
  assert.deepEqual(Array.from(buffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

const adaptiveDefault = png.createAvatarPng("png-adaptive", { size: 1025, namespace: "png" });
const explicitSafe = png.createAvatarPng("png-adaptive", {
  size: 1025,
  supersample: 3,
  namespace: "png",
});
assert.deepEqual(adaptiveDefault, explicitSafe);

const maximumBoundary = png.createAvatarPng("png-boundary", { size: 4096, namespace: "png" });
assert.deepEqual(dimensions(maximumBoundary), [4096, 4096]);

console.log(JSON.stringify({
  ok: true,
  adaptiveSize: 1025,
  maximumSize: 4096,
}, null, 2));
