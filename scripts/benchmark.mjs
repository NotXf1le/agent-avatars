import { performance } from "node:perf_hooks";

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const importDurations = [];
let api;
for (let index = 0; index < 7; index++) {
  const started = performance.now();
  api = await import(`../src/index.mjs?benchmark=${index}`);
  importDurations.push(performance.now() - started);
}

const seeds = Array.from({ length: 100 }, (_, index) => `benchmark:${index}`);
const allocationDurations = [];
for (let index = 0; index < 25; index++) {
  const started = performance.now();
  api.createIdentitySet(seeds, {
    includeSvg: false,
    minimumShapeDistance: 2,
    minimumPaletteDistance: 5,
  });
  allocationDurations.push(performance.now() - started);
}

const result = {
  importMedianMs: Number(median(importDurations).toFixed(2)),
  repeatedSetMedianMs: Number(median(allocationDurations).toFixed(2)),
  samples: { import: importDurations.length, repeatedSet: allocationDurations.length },
};
console.log(JSON.stringify(result, null, 2));
