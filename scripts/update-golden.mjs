import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as avatars from "../src/index.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

const cases = [
  { name: "felix-default", seed: "Felix", size: 96, options: {} },
  { name: "tenant-dark", seed: "refund-agent", size: 64, options: { namespace: "acme", theme: "dark" } },
  { name: "fixed-palette", seed: "workflow:invoice", size: 192, options: { namespace: "northwind", palette: "sky" } },
  { name: "raw-unicode", seed: "\uFF26\uFF45\uFF4C\uFF49\uFF58", size: 96, options: { seedMode: "raw", namespace: "raw-space", namespaceMode: "raw" } },
  { name: "custom-constraints", seed: "constraint:exact-six", size: 80, options: { minPixels: 6, maxPixels: 6, maxDiagonalConnections: 0 } },
].map((item) => {
  const svg = avatars.createHashAvatar(item.seed, item.size, item.options);
  const descriptor = avatars.createAvatarDescriptor(item.seed, item.options);
  return {
    ...item,
    svgSha256: digest(svg),
    signature: descriptor.signature,
    rows: descriptor.rows,
    paletteId: descriptor.paletteId,
  };
});

writeFileSync(resolve("tests/golden/avatar.json"), `${JSON.stringify(cases, null, 2)}\n`);
console.log("Updated tests/golden/avatar.json.");
