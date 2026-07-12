import assert from "node:assert/strict";

const TO_RADIANS = Math.PI / 180;
const TO_DEGREES = 180 / Math.PI;

function oracleShapeHammingDistance(leftRows, rightRows) {
  let differences = 0;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 5; column++) {
      const leftBit = (leftRows[row] >>> column) & 1;
      const rightBit = (rightRows[row] >>> column) & 1;
      if (leftBit !== rightBit) differences++;
    }
  }
  return differences;
}

function parseHex(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function linearSrgb(channel) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function labTransfer(value) {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  return value > epsilon ? Math.cbrt(value) : (kappa * value + 16) / 116;
}

function hexToD65Lab(hex) {
  const [r8, g8, b8] = parseHex(hex);
  const r = linearSrgb(r8);
  const g = linearSrgb(g8);
  const b = linearSrgb(b8);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const fx = labTransfer(x);
  const fy = labTransfer(y);
  const fz = labTransfer(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function hueAngle(y, x) {
  const angle = Math.atan2(y, x) * TO_DEGREES;
  return angle < 0 ? angle + 360 : angle;
}

// Sharma, Wu, and Dalal CIEDE2000, with kL = kC = kH = 1.
function oracleDeltaE2000(first, second) {
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const c1 = Math.sqrt(a1 * a1 + b1 * b1);
  const c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const averageC = (c1 + c2) / 2;
  const averageC7 = averageC ** 7;
  const adjustment = 0.5 * (1 - Math.sqrt(averageC7 / (averageC7 + 25 ** 7)));
  const adjustedA1 = (1 + adjustment) * a1;
  const adjustedA2 = (1 + adjustment) * a2;
  const adjustedC1 = Math.sqrt(adjustedA1 ** 2 + b1 ** 2);
  const adjustedC2 = Math.sqrt(adjustedA2 ** 2 + b2 ** 2);
  const h1 = hueAngle(b1, adjustedA1);
  const h2 = hueAngle(b2, adjustedA2);

  const deltaL = l2 - l1;
  const deltaC = adjustedC2 - adjustedC1;
  let deltaHueDegrees = h2 - h1;
  if (adjustedC1 * adjustedC2 === 0) deltaHueDegrees = 0;
  else if (deltaHueDegrees > 180) deltaHueDegrees -= 360;
  else if (deltaHueDegrees < -180) deltaHueDegrees += 360;
  const deltaH = 2 * Math.sqrt(adjustedC1 * adjustedC2)
    * Math.sin((deltaHueDegrees / 2) * TO_RADIANS);

  const averageL = (l1 + l2) / 2;
  const averageAdjustedC = (adjustedC1 + adjustedC2) / 2;
  let averageHue;
  if (adjustedC1 * adjustedC2 === 0) averageHue = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) averageHue = (h1 + h2) / 2;
  else if (h1 + h2 < 360) averageHue = (h1 + h2 + 360) / 2;
  else averageHue = (h1 + h2 - 360) / 2;

  const weighting = 1
    - 0.17 * Math.cos((averageHue - 30) * TO_RADIANS)
    + 0.24 * Math.cos(2 * averageHue * TO_RADIANS)
    + 0.32 * Math.cos((3 * averageHue + 6) * TO_RADIANS)
    - 0.20 * Math.cos((4 * averageHue - 63) * TO_RADIANS);
  const lightOffset = averageL - 50;
  const scaleL = 1 + 0.015 * lightOffset ** 2 / Math.sqrt(20 + lightOffset ** 2);
  const scaleC = 1 + 0.045 * averageAdjustedC;
  const scaleH = 1 + 0.015 * averageAdjustedC * weighting;
  const rotationAngle = 30 * Math.exp(-(((averageHue - 275) / 25) ** 2));
  const averageAdjustedC7 = averageAdjustedC ** 7;
  const rotationC = 2 * Math.sqrt(averageAdjustedC7 / (averageAdjustedC7 + 25 ** 7));
  const rotation = -rotationC * Math.sin(2 * rotationAngle * TO_RADIANS);
  const normalizedL = deltaL / scaleL;
  const normalizedC = deltaC / scaleC;
  const normalizedH = deltaH / scaleH;
  return Math.sqrt(
    normalizedL ** 2
    + normalizedC ** 2
    + normalizedH ** 2
    + rotation * normalizedC * normalizedH
  );
}

function themeDistance(first, second, theme) {
  const background = oracleDeltaE2000(
    hexToD65Lab(first[theme].background),
    hexToD65Lab(second[theme].background)
  );
  const foreground = oracleDeltaE2000(
    hexToD65Lab(first[theme].foreground),
    hexToD65Lab(second[theme].foreground)
  );
  return Math.sqrt(0.85 * background ** 2 + 0.15 * foreground ** 2);
}

function oraclePaletteDistance(first, second) {
  return Math.min(themeDistance(first, second, "light"), themeDistance(first, second, "dark"));
}

function assertPolicyPairs(items, policy) {
  const distinct = [...new Map(items.map((item) => [item.identityKey, item])).values()];
  assert.equal(
    new Set(distinct.map((item) => item.signature)).size,
    distinct.length,
    "signatures must remain unique"
  );
  const pairs = [];
  for (let left = 0; left < distinct.length; left++) {
    for (let right = left + 1; right < distinct.length; right++) {
      const shape = oracleShapeHammingDistance(distinct[left].descriptor.rows, distinct[right].descriptor.rows);
      const palette = oraclePaletteDistance(distinct[left].descriptor.palette, distinct[right].descriptor.palette);
      const shapePasses = policy.minimumShapeDistance === 0 || shape >= policy.minimumShapeDistance;
      const palettePasses = policy.minimumPaletteDistance === 0 || palette >= policy.minimumPaletteDistance;
      const passes = policy.minimumShapeDistance === 0
        ? palettePasses
        : policy.minimumPaletteDistance === 0
          ? shapePasses
          : policy.mode === "either"
            ? shapePasses || palettePasses
            : shapePasses && palettePasses;
      assert.equal(passes, true, `pair ${left}/${right}: shape=${shape}, palette=${palette}`);
      pairs.push({ shape, palette, shapePasses, palettePasses });
    }
  }
  return pairs;
}

function findInvalidDescriptorPair(api, seedPrefix, options, candidateCount = 300) {
  const candidates = Array.from({ length: candidateCount }, (_, index) =>
    api.createAvatarDescriptor(`${seedPrefix}:${index}`, options)
  );
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const differentSignature = candidates[left].signature !== candidates[right].signature;
      const shapeFails = oracleShapeHammingDistance(candidates[left].rows, candidates[right].rows)
        < options.minimumShapeDistance;
      const paletteFails = oraclePaletteDistance(candidates[left].palette, candidates[right].palette)
        < options.minimumPaletteDistance;
      if (differentSignature && shapeFails && paletteFails) return [candidates[left], candidates[right]];
    }
  }
  return undefined;
}

export {
  assertPolicyPairs,
  findInvalidDescriptorPair,
  oracleDeltaE2000,
  oraclePaletteDistance,
  oracleShapeHammingDistance,
};
