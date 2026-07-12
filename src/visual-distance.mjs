const POP5 = Object.freeze(Array.from({ length: 32 }, (_, value) => {
  let count = 0;
  let bits = value;
  while (bits !== 0) {
    bits &= bits - 1;
    count++;
  }
  return count;
}));

const DEGREES = 180 / Math.PI;
const RADIANS = Math.PI / 180;
const POW_25_7 = 25 ** 7;

function shapeHammingDistance(leftRows, rightRows) {
  let distance = 0;
  for (let row = 0; row < 4; row++) {
    distance += POP5[(leftRows[row] ^ rightRows[row]) & 31];
  }
  return distance;
}

function deltaE2000(left, right) {
  const [l1, a1, b1] = left;
  const [l2, a2, b2] = right;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const meanC7 = meanC ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + POW_25_7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const h1Prime = hueDegrees(b1, a1Prime);
  const h2Prime = hueDegrees(b2, a2Prime);

  const deltaLPrime = l2 - l1;
  const deltaCPrime = c2Prime - c1Prime;
  let deltaHDegrees = h2Prime - h1Prime;
  if (c1Prime * c2Prime === 0) {
    deltaHDegrees = 0;
  } else if (deltaHDegrees > 180) {
    deltaHDegrees -= 360;
  } else if (deltaHDegrees < -180) {
    deltaHDegrees += 360;
  }
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(deltaHDegrees * RADIANS / 2);

  const meanLPrime = (l1 + l2) / 2;
  const meanCPrime = (c1Prime + c2Prime) / 2;
  let meanHPrime;
  if (c1Prime * c2Prime === 0) {
    meanHPrime = h1Prime + h2Prime;
  } else if (Math.abs(h1Prime - h2Prime) <= 180) {
    meanHPrime = (h1Prime + h2Prime) / 2;
  } else if (h1Prime + h2Prime < 360) {
    meanHPrime = (h1Prime + h2Prime + 360) / 2;
  } else {
    meanHPrime = (h1Prime + h2Prime - 360) / 2;
  }

  const t = 1
    - 0.17 * Math.cos((meanHPrime - 30) * RADIANS)
    + 0.24 * Math.cos(2 * meanHPrime * RADIANS)
    + 0.32 * Math.cos((3 * meanHPrime + 6) * RADIANS)
    - 0.20 * Math.cos((4 * meanHPrime - 63) * RADIANS);
  const lightnessOffset = meanLPrime - 50;
  const sl = 1 + (0.015 * lightnessOffset ** 2) / Math.sqrt(20 + lightnessOffset ** 2);
  const sc = 1 + 0.045 * meanCPrime;
  const sh = 1 + 0.015 * meanCPrime * t;
  const deltaTheta = 30 * Math.exp(-(((meanHPrime - 275) / 25) ** 2));
  const meanCPrime7 = meanCPrime ** 7;
  const rc = 2 * Math.sqrt(meanCPrime7 / (meanCPrime7 + POW_25_7));
  const rt = -rc * Math.sin(2 * deltaTheta * RADIANS);
  const lightnessTerm = deltaLPrime / sl;
  const chromaTerm = deltaCPrime / sc;
  const hueTerm = deltaHPrime / sh;
  return Math.sqrt(
    lightnessTerm ** 2
    + chromaTerm ** 2
    + hueTerm ** 2
    + rt * chromaTerm * hueTerm
  );
}

function hueDegrees(b, aPrime) {
  const degrees = Math.atan2(b, aPrime) * DEGREES;
  return degrees >= 0 ? degrees : degrees + 360;
}

function normalizeHex(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new TypeError(`${label} must be a six-digit hexadecimal color.`);
  }
  return value;
}

function hexToLab(value, label) {
  const hex = normalizeHex(value, label);
  const red = srgbChannel(Number.parseInt(hex.slice(1, 3), 16) / 255);
  const green = srgbChannel(Number.parseInt(hex.slice(3, 5), 16) / 255);
  const blue = srgbChannel(Number.parseInt(hex.slice(5, 7), 16) / 255);
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue;
  const z = (0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883;
  const fx = labCurve(x);
  const fy = labCurve(y);
  const fz = labCurve(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function srgbChannel(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function labCurve(value) {
  const delta = 6 / 29;
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29;
}

function paletteToLab(item, index = "palette") {
  return {
    light: {
      background: hexToLab(item?.light?.background, `${index}.light.background`),
      foreground: hexToLab(item?.light?.foreground, `${index}.light.foreground`),
    },
    dark: {
      background: hexToLab(item?.dark?.background, `${index}.dark.background`),
      foreground: hexToLab(item?.dark?.foreground, `${index}.dark.foreground`),
    },
  };
}

function themeDistance(left, right) {
  const backgroundDeltaE = deltaE2000(left.background, right.background);
  const foregroundDeltaE = deltaE2000(left.foreground, right.foreground);
  return Math.sqrt(0.85 * backgroundDeltaE ** 2 + 0.15 * foregroundDeltaE ** 2);
}

function paletteLabDistance(left, right) {
  return Math.min(themeDistance(left.light, right.light), themeDistance(left.dark, right.dark));
}

function paletteDistance(left, right) {
  return paletteLabDistance(paletteToLab(left, "leftPalette"), paletteToLab(right, "rightPalette"));
}

function buildPaletteDistanceMatrix(palettes) {
  if (!Array.isArray(palettes)) throw new TypeError("palettes must be an array.");
  const converted = palettes.map((item, index) => paletteToLab(item, `palettes[${index}]`));
  const matrix = new Float64Array(palettes.length * palettes.length);
  for (let left = 0; left < palettes.length; left++) {
    for (let right = left + 1; right < palettes.length; right++) {
      const distance = paletteLabDistance(converted[left], converted[right]);
      matrix[left * palettes.length + right] = distance;
      matrix[right * palettes.length + left] = distance;
    }
  }
  return matrix;
}

export {
  shapeHammingDistance,
  deltaE2000,
  paletteDistance,
  buildPaletteDistanceMatrix,
};
