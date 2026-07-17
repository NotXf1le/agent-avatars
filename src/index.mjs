/**
 * Agent Avatars.
 *
 * Deterministic, zero-dependency 5x4 avatar generation backed by an
 * exhaustive, uniformly addressable catalog of symmetric masks.
 */

import { buildPaletteDistanceMatrix, shapeHammingDistance } from "./visual-distance.mjs";
import { createBoundedLruCache } from "./catalog-cache.mjs";
import {
  normalizeHexColor as normalizeColor,
  snapshotRenderableDescriptor,
} from "./render-descriptor.mjs";

const STYLE_VERSION = "1";
// Compatibility identifier: changing this would change deterministic outputs.
const LIBRARY_ID = "deterministic-agent-avatars";
const GRID_W = 5;
const GRID_H = 4;
const HALF_W = 3;
const CELL = 10;
const GLYPH_X = 39;
const GLYPH_Y = 44;
const CELL_RADIUS = 2;
const MAX_SIZE = 4096;
const RAW_SYMMETRIC_MASKS = 1 << (GRID_H * HALF_W); // 4096
const DEFAULT_NAMESPACE = "default";
const DEFAULT_SEED_MODE = "human";
const DEFAULT_THEME = "light";
const MIN_CUSTOM_CONTRAST = 4.5;
const MAX_CUSTOM_PALETTES = 256;
const MAX_IDENTITY_SET_ITEMS = 10_000;
const MAX_MANIFEST_ENTRIES = 10_000;

// Sixteen deliberately separated pastel families. Every family contains a
// light and dark pair with WCAG contrast comfortably above 4.5:1.
const BUILTIN_PALETTES = Object.freeze([
  palette("rose",    "#F1DADA", "#492727", "#3D1F1F", "#EED3D3"),
  palette("leaf",    "#BCF1BC", "#274927", "#1F3D1F", "#D3EED3"),
  palette("indigo",  "#BCBCF1", "#272749", "#1F1F3D", "#D3D3EE"),
  palette("aqua",    "#BCF1F1", "#274949", "#1F3D3D", "#D3EEEE"),
  palette("sand",    "#F1E8BC", "#494327", "#3D381F", "#EEEAD3"),
  palette("orchid",  "#F1BCDF", "#49273E", "#3D1F33", "#EED3E5"),
  palette("sky",     "#C8DAF3", "#273549", "#1F2B3D", "#D3DEEE"),
  palette("mist",    "#EAF5E5", "#324927", "#293D1F", "#DCEED3"),
  palette("coral",   "#F1BCBC", "#492727", "#3D1F1F", "#EED3D3"),
  palette("mint",    "#C0EDD2", "#274935", "#1F3D2B", "#D3EEDE"),
  palette("lilac",   "#EDD7F4", "#412749", "#351F3D", "#E7D3EE"),
  palette("apricot", "#F1D2BC", "#493527", "#3D2B1F", "#EEDED3"),
  palette("ice",     "#E5EEF5", "#273B49", "#1F303D", "#D3E3EE"),
  palette("violet",  "#DFBCF1", "#3E2749", "#331F3D", "#E5D3EE"),
  palette("lime",    "#D6EDC0", "#384927", "#2E3D1F", "#E0EED3"),
  palette("berry",   "#E9C4D3", "#492735", "#3D1F2B", "#EED3DE"),
]);

const STANDARD_CONSTRAINTS = Object.freeze({
  minPixels: 6,
  maxPixels: 12,
  minDensity: 0.18,
  maxDensity: 0.82,
  maxDiagonalConnections: 2,
  connectivity: 8,
  maxHoles: Infinity,
});

const UTF8 = new TextEncoder();
const POP5 = Object.freeze(Array.from({ length: 32 }, (_, value) => popCount(value)));
const CATALOG_CACHE = createBoundedLruCache(64);
const SHAPE_NEIGHBOR_CACHES = new WeakMap();
const PALETTE_NEIGHBOR_CACHES = new WeakMap();

function palette(id, lightBackground, lightForeground, darkBackground, darkForeground) {
  return Object.freeze({
    id,
    light: Object.freeze({
      background: lightBackground,
      foreground: lightForeground,
    }),
    dark: Object.freeze({
      background: darkBackground,
      foreground: darkForeground,
    }),
    visualKey: `${lightBackground}/${lightForeground}/${darkBackground}/${darkForeground}`,
  });
}

function popCount(value) {
  let count = 0;
  let x = value >>> 0;
  while (x !== 0) {
    x &= x - 1;
    count++;
  }
  return count;
}

function trimNumber(value) {
  const text = Number(value).toFixed(4).replace(/\.?0+$/, "");
  return text === "" || text === "-0" ? "0" : text;
}

function normalizeSize(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0 || number > MAX_SIZE) {
    throw new TypeError(`Avatar size must be a finite number in (0, ${MAX_SIZE}].`);
  }
  const normalized = trimNumber(number);
  if (Number(normalized) <= 0) {
    throw new RangeError("Avatar size rounds to zero at the supported four-decimal precision.");
  }
  return normalized;
}

function canonicalSeed(value, mode = DEFAULT_SEED_MODE) {
  const string = String(value ?? "");
  if (mode === "raw") return string;
  if (mode !== "human") throw new TypeError(`Unsupported seedMode: ${mode}`);
  return string.normalize("NFKC").trim().toLowerCase();
}

function canonicalNamespace(value, mode = "human") {
  const normalized = canonicalSeed(value ?? DEFAULT_NAMESPACE, mode);
  if (normalized.length === 0) {
    throw new TypeError("namespace must not be empty after canonicalization.");
  }
  return normalized;
}

function encodePart(value) {
  return `${value.length}:${value}`;
}

function domainMessage(domain, canonical, namespace, nonce = 0) {
  return `${LIBRARY_ID}\u0000${STYLE_VERSION}\u0000${domain}\u0000${encodePart(namespace)}\u0000${encodePart(canonical)}\u0000${nonce}`;
}

function hash32String(input) {
  const bytes = UTF8.encode(input);
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }

  // Final avalanche improves distribution for structured and sequential IDs.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function hash32(value, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("hash options must be an object.");
  }
  const seedMode = options.seedMode ?? DEFAULT_SEED_MODE;
  const namespaceMode = options.namespaceMode ?? "human";
  const canonical = canonicalSeed(value, seedMode);
  const namespace = canonicalNamespace(options.namespace ?? DEFAULT_NAMESPACE, namespaceMode);
  const domain = options.domain ?? "public";
  if (typeof domain !== "string" || domain.length === 0 || domain.includes("\u0000")) {
    throw new TypeError("domain must be a non-empty string without null characters.");
  }
  return hash32String(domainMessage(domain, canonical, namespace, 0));
}

function hashHex128(message) {
  let output = "";
  for (let index = 0; index < 4; index++) {
    output += hash32String(`${index}\u0000${message}`).toString(16).padStart(8, "0");
  }
  return output;
}

function xorshift32(seed) {
  let state = seed || 0x9e3779b9;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randInt(next, max) {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) {
    throw new RangeError("max must be an integer in [1, 2^32].");
  }

  const limit = 0x100000000 - (0x100000000 % max);
  let value = next();
  while (value >= limit) value = next();
  return value % max;
}

function pickIndex(hash, length) {
  return randInt(xorshift32(hash), length);
}

function rowMask(x) {
  return 1 << (GRID_W - 1 - x);
}

function mirrorX(x) {
  return GRID_W - 1 - x;
}

function rowsFromSymmetricMask(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask >= RAW_SYMMETRIC_MASKS) {
    throw new RangeError(`mask must be an integer in [0, ${RAW_SYMMETRIC_MASKS - 1}].`);
  }

  const rows = Array(GRID_H).fill(0);
  for (let y = 0; y < GRID_H; y++) {
    for (let halfX = 0; halfX < HALF_W; halfX++) {
      const bitIndex = y * HALF_W + halfX;
      if (((mask >>> bitIndex) & 1) === 0) continue;
      rows[y] |= rowMask(halfX);
      rows[y] |= rowMask(mirrorX(halfX));
    }
  }
  return rows;
}

function symmetricMaskFromRows(rows) {
  const normalizedRows = normalizeNumericRows(rows);
  if (!isMirroredRows(normalizedRows)) {
    throw new TypeError("Rows are not mirrored across the vertical axis.");
  }

  let mask = 0;
  for (let y = 0; y < GRID_H; y++) {
    for (let halfX = 0; halfX < HALF_W; halfX++) {
      if (cellOn(normalizedRows, halfX, y)) mask |= 1 << (y * HALF_W + halfX);
    }
  }
  return mask >>> 0;
}

function cellOn(rows, x, y) {
  return y >= 0 && y < GRID_H && x >= 0 && x < GRID_W && ((rows[y] >>> (GRID_W - 1 - x)) & 1) === 1;
}

function rowsToGrid(rows) {
  return Array.from({ length: GRID_H }, (_, y) =>
    Array.from({ length: GRID_W }, (_, x) => cellOn(rows, x, y))
  );
}

function gridToRows(grid) {
  if (
    !Array.isArray(grid)
    || grid.length !== GRID_H
    || grid.some((row) => (
      !Array.isArray(row)
      || row.length !== GRID_W
      || row.some((cell) => typeof cell !== "boolean")
    ))
  ) {
    throw new TypeError(`grid must be a ${GRID_H}x${GRID_W} boolean matrix.`);
  }

  const rows = Array(GRID_H).fill(0);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x]) rows[y] |= rowMask(x);
    }
  }
  return rows;
}

function normalizeNumericRows(input) {
  if (!Array.isArray(input) || input.length !== GRID_H || input.some((row) => !Number.isInteger(row) || row < 0 || row > 31)) {
    throw new TypeError(`rows must contain ${GRID_H} integers in [0, 31].`);
  }
  return input.slice();
}

function normalizeRows(input) {
  if (Array.isArray(input?.[0])) return gridToRows(input);
  return normalizeNumericRows(input);
}

function cellCountRows(rows) {
  let count = 0;
  for (const row of rows) count += POP5[row & 0b11111];
  return count;
}

function boundsRows(rows) {
  let minX = GRID_W;
  let minY = GRID_H;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!cellOn(rows, x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return Object.freeze({ minX: 0, minY: 0, maxX: -1, maxY: -1, width: 0, height: 0 });
  }

  return Object.freeze({
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

function densityRows(rows, bounds = boundsRows(rows), count = cellCountRows(rows)) {
  if (count === 0) return 0;
  return count / Math.max(1, bounds.width * bounds.height);
}

function isMirroredRows(rows) {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (cellOn(rows, x, y) !== cellOn(rows, mirrorX(x), y)) return false;
    }
  }
  return true;
}

function componentCountRows(rows, connectivity = 8) {
  const offsets = connectivity === 4
    ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
    : [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const seen = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(false));
  let components = 0;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!cellOn(rows, x, y) || seen[y][x]) continue;
      components++;
      const stack = [[x, y]];
      seen[y][x] = true;

      while (stack.length > 0) {
        const [currentX, currentY] = stack.pop();
        for (const [dx, dy] of offsets) {
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (nextY < 0 || nextY >= GRID_H || nextX < 0 || nextX >= GRID_W) continue;
          if (!cellOn(rows, nextX, nextY) || seen[nextY][nextX]) continue;
          seen[nextY][nextX] = true;
          stack.push([nextX, nextY]);
        }
      }
    }
  }

  return components;
}

function diagonalTouchCountRows(rows) {
  let count = 0;
  for (let y = 0; y < GRID_H - 1; y++) {
    for (let x = 0; x < GRID_W - 1; x++) {
      const a = cellOn(rows, x, y);
      const b = cellOn(rows, x + 1, y);
      const c = cellOn(rows, x, y + 1);
      const d = cellOn(rows, x + 1, y + 1);
      if ((a && d && !b && !c) || (b && c && !a && !d)) count++;
    }
  }
  return count;
}

function diagonalTouchCountRowsIgnoringMirror(rows) {
  let count = 0;
  const maxUniqueWindowX = Math.floor((GRID_W - 2) / 2);
  for (let y = 0; y < GRID_H - 1; y++) {
    for (let x = 0; x <= maxUniqueWindowX; x++) {
      const a = cellOn(rows, x, y);
      const b = cellOn(rows, x + 1, y);
      const c = cellOn(rows, x, y + 1);
      const d = cellOn(rows, x + 1, y + 1);
      if ((a && d && !b && !c) || (b && c && !a && !d)) count++;
    }
  }
  return count;
}

function holeCountRows(rows) {
  const paddedWidth = GRID_W + 2;
  const paddedHeight = GRID_H + 2;
  const outside = Array.from({ length: paddedHeight }, () => Array(paddedWidth).fill(false));
  const outsideStack = [[0, 0]];
  outside[0][0] = true;

  while (outsideStack.length > 0) {
    const [currentX, currentY] = outsideStack.pop();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      if (nextY < 0 || nextY >= paddedHeight || nextX < 0 || nextX >= paddedWidth || outside[nextY][nextX]) continue;
      const gridX = nextX - 1;
      const gridY = nextY - 1;
      if (gridX >= 0 && gridX < GRID_W && gridY >= 0 && gridY < GRID_H && cellOn(rows, gridX, gridY)) continue;
      outside[nextY][nextX] = true;
      outsideStack.push([nextX, nextY]);
    }
  }

  let holes = 0;
  const seenHole = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(false));
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (cellOn(rows, x, y) || outside[y + 1][x + 1] || seenHole[y][x]) continue;
      holes++;
      const stack = [[x, y]];
      seenHole[y][x] = true;
      while (stack.length > 0) {
        const [currentX, currentY] = stack.pop();
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (nextY < 0 || nextY >= GRID_H || nextX < 0 || nextX >= GRID_W) continue;
          if (cellOn(rows, nextX, nextY) || outside[nextY + 1][nextX + 1] || seenHole[nextY][nextX]) continue;
          seenHole[nextY][nextX] = true;
          stack.push([nextX, nextY]);
        }
      }
    }
  }

  return holes;
}

function analyzeRows(rows) {
  const bounds = boundsRows(rows);
  const cellCount = cellCountRows(rows);
  return Object.freeze({
    rows: Object.freeze(rows.slice()),
    cellCount,
    density: densityRows(rows, bounds, cellCount),
    bounds,
    mirrored: isMirroredRows(rows),
    connectedComponents4: componentCountRows(rows, 4),
    connectedComponents8: componentCountRows(rows, 8),
    holeCount: holeCountRows(rows),
    diagonalTouchCount: diagonalTouchCountRows(rows),
    diagonalTouchCountIgnoringMirror: diagonalTouchCountRowsIgnoringMirror(rows),
  });
}

function normalizeConstraints(options = {}) {
  const base = STANDARD_CONSTRAINTS;
  const minPixels = Number(options.minPixels ?? base.minPixels);
  const maxPixels = Number(options.maxPixels ?? base.maxPixels);
  const minDensity = Number(options.minDensity ?? base.minDensity);
  const maxDensity = Number(options.maxDensity ?? base.maxDensity);
  const maxDiagonalConnections = Number(options.maxDiagonalConnections ?? base.maxDiagonalConnections);
  const connectivity = Number(options.connectivity ?? base.connectivity);
  const maxHolesValue = options.maxHoles ?? base.maxHoles;
  const maxHoles = maxHolesValue === Infinity ? Infinity : Number(maxHolesValue);

  if (!Number.isInteger(minPixels) || !Number.isInteger(maxPixels)) {
    throw new TypeError("minPixels and maxPixels must be integers.");
  }
  if (minPixels < 1 || maxPixels < minPixels || maxPixels > GRID_W * GRID_H) {
    throw new RangeError(`Pixel limits must satisfy 1 <= minPixels <= maxPixels <= ${GRID_W * GRID_H}.`);
  }
  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) {
    throw new TypeError("minDensity and maxDensity must be finite numbers.");
  }
  if (minDensity < 0 || maxDensity > 1 || maxDensity < minDensity) {
    throw new RangeError("Density limits must satisfy 0 <= minDensity <= maxDensity <= 1.");
  }
  if (!Number.isInteger(maxDiagonalConnections) || maxDiagonalConnections < 0) {
    throw new TypeError("maxDiagonalConnections must be a non-negative integer.");
  }
  if (connectivity !== 4 && connectivity !== 8) {
    throw new TypeError("connectivity must be 4 or 8.");
  }
  if (maxHoles !== Infinity && (!Number.isInteger(maxHoles) || maxHoles < 0)) {
    throw new TypeError("maxHoles must be a non-negative integer or Infinity.");
  }

  return Object.freeze({
    minPixels,
    maxPixels,
    minDensity,
    maxDensity,
    maxDiagonalConnections,
    connectivity,
    maxHoles,
  });
}

function shapePassesConstraints(shape, constraints) {
  if (shape.cellCount < constraints.minPixels || shape.cellCount > constraints.maxPixels) return false;
  if (shape.density < constraints.minDensity || shape.density > constraints.maxDensity) return false;
  if (shape.bounds.width < 2 || shape.bounds.height < 2) return false;
  if (!shape.mirrored) return false;
  if ((constraints.connectivity === 4 ? shape.connectedComponents4 : shape.connectedComponents8) !== 1) return false;
  if (shape.diagonalTouchCountIgnoringMirror > constraints.maxDiagonalConnections) return false;
  if (shape.holeCount > constraints.maxHoles) return false;
  return true;
}

function constraintsKey(constraints) {
  return [
    constraints.minPixels,
    constraints.maxPixels,
    constraints.minDensity,
    constraints.maxDensity,
    constraints.maxDiagonalConnections,
    constraints.connectivity,
    constraints.maxHoles === Infinity ? "inf" : constraints.maxHoles,
  ].join("|");
}

const STANDARD_CONSTRAINTS_KEY = constraintsKey(STANDARD_CONSTRAINTS);
let allShapes;
let standardCatalog;

function getAllShapes() {
  if (allShapes) return allShapes;
  allShapes = Object.freeze(Array.from({ length: RAW_SYMMETRIC_MASKS }, (_, mask) => {
    const analysis = analyzeRows(rowsFromSymmetricMask(mask));
    return Object.freeze({
      id: `s${mask.toString(16).padStart(3, "0")}`,
      mask,
      ...analysis,
    });
  }));
  return allShapes;
}

function getStandardCatalog() {
  if (!standardCatalog) {
    standardCatalog = Object.freeze(
      getAllShapes().filter((shape) => shapePassesConstraints(shape, STANDARD_CONSTRAINTS))
    );
  }
  return standardCatalog;
}

function getCatalog(constraints) {
  const key = constraintsKey(constraints);
  if (key === STANDARD_CONSTRAINTS_KEY) return getStandardCatalog();
  const cached = CATALOG_CACHE.get(key);
  if (cached) return cached;
  return CATALOG_CACHE.set(
    key,
    Object.freeze(getAllShapes().filter((shape) => shapePassesConstraints(shape, constraints)))
  );
}

function validateAvatarBitmap(gridOrRows, options = {}) {
  const rows = normalizeRows(gridOrRows);
  const constraints = normalizeConstraints(options);
  const analysis = analyzeRows(rows);
  return {
    valid: shapePassesConstraints(analysis, constraints),
    connectedComponents4: analysis.connectedComponents4,
    connectedComponents8: analysis.connectedComponents8,
    cellCount: analysis.cellCount,
    density: analysis.density,
    mirrored: analysis.mirrored,
    holeCount: analysis.holeCount,
    diagonalTouchCount: analysis.diagonalTouchCount,
    diagonalTouchCountIgnoringMirror: analysis.diagonalTouchCountIgnoringMirror,
    bounds: analysis.bounds,
    constraints,
  };
}

function colorChannels(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function relativeLuminance(hex) {
  const channels = colorChannels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(normalizeColor(first, "first"));
  const secondLuminance = relativeLuminance(normalizeColor(second, "second"));
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function normalizeThemeColors(value, fallback, label) {
  if (Array.isArray(value)) {
    value = { background: value[0], foreground: value[1] };
  }
  const source = value && typeof value === "object" ? value : fallback;
  if (!source || typeof source !== "object") {
    throw new TypeError(`${label} palette colors are required.`);
  }
  const background = normalizeColor(source.background, `${label}.background`);
  const foreground = normalizeColor(source.foreground, `${label}.foreground`);
  return Object.freeze({ background, foreground });
}

function normalizeOptionalBoolean(value, defaultValue, label) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function normalizePaletteEntry(input, index, options, allowLowContrast) {
  if (Array.isArray(input)) {
    input = { light: input, dark: input };
  }
  if (!input || typeof input !== "object") {
    throw new TypeError(`palettes[${index}] must be an object or color tuple.`);
  }

  const id = String(input.id ?? `custom-${index + 1}`);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
    throw new TypeError(`Palette id "${id}" must contain 1-64 letters, digits, periods, underscores, or hyphens.`);
  }

  const common = input.background || input.foreground ? input : undefined;
  const light = normalizeThemeColors(input.light ?? common, undefined, `palettes[${index}].light`);
  const dark = normalizeThemeColors(input.dark ?? input.light ?? common, light, `palettes[${index}].dark`);
  const minimumContrast = Number(options.minimumContrast ?? MIN_CUSTOM_CONTRAST);
  if (!Number.isFinite(minimumContrast) || minimumContrast < 1 || minimumContrast > 21) {
    throw new TypeError("minimumContrast must be a finite number in [1, 21].");
  }

  if (!allowLowContrast) {
    const lightContrast = contrastRatio(light.background, light.foreground);
    const darkContrast = contrastRatio(dark.background, dark.foreground);
    if (lightContrast < minimumContrast || darkContrast < minimumContrast) {
      throw new RangeError(
        `Palette "${id}" has insufficient contrast: light ${lightContrast.toFixed(2)}:1, dark ${darkContrast.toFixed(2)}:1; required ${minimumContrast.toFixed(2)}:1.`
      );
    }
  }

  return Object.freeze({
    id,
    light,
    dark,
    visualKey: `${light.background}/${light.foreground}/${dark.background}/${dark.foreground}`,
  });
}

function normalizePaletteCollection(options, allowLowContrast) {
  let palettes;
  let paletteValue = options.palette ?? "auto";

  if (paletteValue && typeof paletteValue === "object" && !Array.isArray(paletteValue)) {
    palettes = Object.freeze([normalizePaletteEntry(paletteValue, 0, options, allowLowContrast)]);
    paletteValue = 0;
  } else if (options.palettes !== undefined) {
    if (!Array.isArray(options.palettes) || options.palettes.length === 0) {
      throw new TypeError("palettes must be a non-empty array.");
    }
    if (options.palettes.length > MAX_CUSTOM_PALETTES) {
      throw new RangeError(`palettes must contain at most ${MAX_CUSTOM_PALETTES} entries.`);
    }
    palettes = Object.freeze(options.palettes.map((entry, index) => (
      normalizePaletteEntry(entry, index, options, allowLowContrast)
    )));
  } else {
    palettes = BUILTIN_PALETTES;
  }

  const ids = new Set();
  const visualKeys = new Set();
  for (const item of palettes) {
    if (ids.has(item.id)) throw new TypeError(`Duplicate palette id: ${item.id}.`);
    if (visualKeys.has(item.visualKey)) throw new TypeError(`Duplicate visual palette: ${item.id}.`);
    ids.add(item.id);
    visualKeys.add(item.visualKey);
  }

  const choices = normalizeChoice(paletteValue, palettes.map((item) => item.id), "palette");
  const paletteBySignatureKey = new Map();
  for (const paletteIndex of choices) {
    const item = palettes[paletteIndex];
    const signatureKey = paletteSignatureKey(item);
    const previous = paletteBySignatureKey.get(signatureKey);
    if (previous && previous.visualKey !== item.visualKey) {
      throw new TypeError(
        `Selected palettes have a signature-key collision (${signatureKey}): ${previous.id} and ${item.id}.`
      );
    }
    paletteBySignatureKey.set(signatureKey, item);
  }
  return { palettes, choices };
}

function normalizeChoice(value, names, label) {
  if (value === undefined || value === null || value === "auto") {
    return Object.freeze(Array.from({ length: names.length }, (_, index) => index));
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value >= names.length) {
      throw new RangeError(`${label} index must be an integer in [0, ${names.length - 1}].`);
    }
    return Object.freeze([value]);
  }

  if (typeof value === "string") {
    const index = names.indexOf(value);
    if (index < 0) throw new TypeError(`Unsupported ${label}: ${value}. Expected "auto" or one of: ${names.join(", ")}.`);
    return Object.freeze([index]);
  }

  throw new TypeError(`${label} must be "auto", a valid name, or a numeric index.`);
}

function normalizeDistinguishability(options) {
  let minimumShapeDistance = options.minimumShapeDistance === undefined ? 0 : options.minimumShapeDistance;
  if (typeof minimumShapeDistance !== "number" || !Number.isInteger(minimumShapeDistance) || minimumShapeDistance < 0 || minimumShapeDistance > 20) {
    throw new TypeError("minimumShapeDistance must be an integer in [0, 20].");
  }
  if (minimumShapeDistance === 0) minimumShapeDistance = 0;

  let minimumPaletteDistance = options.minimumPaletteDistance === undefined ? 0 : options.minimumPaletteDistance;
  if (typeof minimumPaletteDistance !== "number" || !Number.isFinite(minimumPaletteDistance) || minimumPaletteDistance < 0 || minimumPaletteDistance > 100) {
    throw new TypeError("minimumPaletteDistance must be a finite number in [0, 100].");
  }
  if (minimumPaletteDistance === 0) minimumPaletteDistance = 0;

  const mode = options.distanceMode === undefined ? "either" : options.distanceMode;
  if (mode !== "either" && mode !== "both") {
    throw new TypeError('distanceMode must be "either" or "both".');
  }

  if (minimumShapeDistance === 0 && minimumPaletteDistance === 0) return undefined;
  return Object.freeze({
    schema: "visual-distance/v1",
    minimumShapeDistance,
    minimumPaletteDistance,
    mode,
  });
}

function normalizeOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object.");
  }

  const allowLowContrast = normalizeOptionalBoolean(options.allowLowContrast, false, "allowLowContrast");
  const constraints = normalizeConstraints(options);
  const catalog = getCatalog(constraints);
  if (catalog.length === 0) {
    throw new RangeError(`No symmetric 5x4 shape satisfies the requested constraints: ${JSON.stringify({
      ...constraints,
      maxHoles: constraints.maxHoles === Infinity ? "Infinity" : constraints.maxHoles,
    })}`);
  }

  const seedMode = options.seedMode ?? DEFAULT_SEED_MODE;
  if (seedMode !== "human" && seedMode !== "raw") {
    throw new TypeError(`Unsupported seedMode: ${seedMode}`);
  }
  const namespaceMode = options.namespaceMode ?? "human";
  if (namespaceMode !== "human" && namespaceMode !== "raw") {
    throw new TypeError(`Unsupported namespaceMode: ${namespaceMode}`);
  }
  const namespace = canonicalNamespace(options.namespace ?? DEFAULT_NAMESPACE, namespaceMode);
  const theme = options.theme ?? DEFAULT_THEME;
  if (theme !== "light" && theme !== "dark") {
    throw new TypeError(`Unsupported theme: ${theme}. Expected "light" or "dark".`);
  }
  const collisionNonce = Number(options.collisionNonce ?? 0);
  if (!Number.isSafeInteger(collisionNonce) || collisionNonce < 0) {
    throw new TypeError("collisionNonce must be a non-negative safe integer.");
  }

  const paletteSelection = normalizePaletteCollection(options, allowLowContrast);
  const stateSpace = catalog.length * paletteSelection.choices.length;
  const distinguishability = normalizeDistinguishability(options);

  return Object.freeze({
    constraints,
    catalog,
    seedMode,
    namespaceMode,
    namespace,
    theme,
    collisionNonce,
    palettes: paletteSelection.palettes,
    paletteChoices: paletteSelection.choices,
    stateSpace,
    distinguishability,
  });
}

function selectionHash(domain, canonical, normalized, nonce) {
  return hash32String(domainMessage(domain, canonical, normalized.namespace, nonce));
}

function paletteSignatureKey(item) {
  return hash32String(`palette\u0000${item.visualKey}`).toString(16).padStart(8, "0");
}

function visualSignature(shape, selectedPalette) {
  return `${STYLE_VERSION}:${shape.id}:p${paletteSignatureKey(selectedPalette)}`;
}

function createDescriptorFromNormalized(seed, normalized, collisionNonce = normalized.collisionNonce) {
  const canonical = canonicalSeed(seed, normalized.seedMode);
  const shapeIndex = pickIndex(selectionHash("shape", canonical, normalized, collisionNonce), normalized.catalog.length);
  const paletteChoiceIndex = pickIndex(selectionHash("palette", canonical, normalized, collisionNonce), normalized.paletteChoices.length);
  const shape = normalized.catalog[shapeIndex];
  const paletteIndex = normalized.paletteChoices[paletteChoiceIndex];
  const selectedPalette = normalized.palettes[paletteIndex];
  const colors = selectedPalette[normalized.theme];
  const identityMessage = domainMessage("identity-key", canonical, normalized.namespace, 0);
  const identityKey = hashHex128(identityMessage);
  const signature = visualSignature(shape, selectedPalette);
  const rows = shape.rows.slice();

  return {
    styleVersion: STYLE_VERSION,
    namespace: normalized.namespace,
    canonicalSeed: canonical,
    identityKey,
    collisionNonce,
    hash: selectionHash("identity", canonical, normalized, collisionNonce),
    shapeId: shape.id,
    shapeMask: shape.mask,
    shapeIndex,
    rows,
    grid: rowsToGrid(rows),
    paletteId: selectedPalette.id,
    paletteIndex,
    palette: selectedPalette,
    theme: normalized.theme,
    colors: { ...colors },
    constraints: normalized.constraints,
    stateSpace: normalized.stateSpace,
    signature,
    metrics: {
      cellCount: shape.cellCount,
      density: shape.density,
      bounds: shape.bounds,
      connectedComponents4: shape.connectedComponents4,
      connectedComponents8: shape.connectedComponents8,
      holeCount: shape.holeCount,
      diagonalTouchCount: shape.diagonalTouchCount,
      diagonalTouchCountIgnoringMirror: shape.diagonalTouchCountIgnoringMirror,
    },
  };
}

function createAvatarDescriptor(seed, options = {}) {
  return createDescriptorFromNormalized(seed, normalizeOptions(options));
}

function roundedCell(x, y, size, radius, topLeft, topRight, bottomRight, bottomLeft) {
  return [
    `M${x + (topLeft ? radius : 0)} ${y}`,
    `H${x + size - (topRight ? radius : 0)}`,
    topRight ? `Q${x + size} ${y} ${x + size} ${y + radius}` : `L${x + size} ${y}`,
    `V${y + size - (bottomRight ? radius : 0)}`,
    bottomRight ? `Q${x + size} ${y + size} ${x + size - radius} ${y + size}` : `L${x + size} ${y + size}`,
    `H${x + (bottomLeft ? radius : 0)}`,
    bottomLeft ? `Q${x} ${y + size} ${x} ${y + size - radius}` : `L${x} ${y + size}`,
    `V${y + (topLeft ? radius : 0)}`,
    topLeft ? `Q${x} ${y} ${x + radius} ${y}` : `L${x} ${y}`,
    "Z",
  ].join("");
}

function glyphPath(rows, radius = CELL_RADIUS) {
  let path = "";
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!cellOn(rows, x, y)) continue;
      const up = cellOn(rows, x, y - 1);
      const down = cellOn(rows, x, y + 1);
      const left = cellOn(rows, x - 1, y);
      const right = cellOn(rows, x + 1, y);
      path += roundedCell(
        GLYPH_X + x * CELL,
        GLYPH_Y + y * CELL,
        CELL,
        radius,
        !up && !left,
        !up && !right,
        !down && !right,
        !down && !left
      );
    }
  }
  return path;
}

function backgroundMarkup(background) {
  return `<circle cx="64" cy="64" r="48" fill="${background}"/>`;
}

function createHashAvatarFromDescriptor(descriptor, size = 96) {
  const snapshot = snapshotRenderableDescriptor(descriptor);
  const safeSize = normalizeSize(size);
  const path = glyphPath(snapshot.rows, CELL_RADIUS);
  const { background, foreground } = snapshot.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${safeSize}" height="${safeSize}">${backgroundMarkup(background)}<path d="${path}" fill="${foreground}" shape-rendering="geometricPrecision"/></svg>`;
}

function optionsFromArgs(sizeOrOptions, explicitOptions) {
  if (typeof sizeOrOptions === "object" && sizeOrOptions !== null) {
    return {
      size: sizeOrOptions.size ?? 96,
      options: { ...sizeOrOptions },
    };
  }
  return {
    size: sizeOrOptions ?? 96,
    options: { ...(explicitOptions ?? {}) },
  };
}

function createHashAvatar(seed, sizeOrOptions = 96, explicitOptions = {}) {
  const { size, options } = optionsFromArgs(sizeOrOptions, explicitOptions);
  const descriptor = createAvatarDescriptor(seed, options);
  return createHashAvatarFromDescriptor(descriptor, size);
}

function avatarDataUri(seed, sizeOrOptions = 96, explicitOptions = {}) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(createHashAvatar(seed, sizeOrOptions, explicitOptions))}`;
}

function getCatalogStats(options = {}) {
  const normalized = normalizeOptions(options);
  return {
    styleVersion: STYLE_VERSION,
    rawSymmetricMasks: RAW_SYMMETRIC_MASKS,
    validShapes: normalized.catalog.length,
    availablePalettes: normalized.paletteChoices.length,
    signatureStates: normalized.stateSpace,
    constraints: normalized.constraints,
  };
}

function getAvatarCatalog(options = {}) {
  const normalized = normalizeOptions(options);
  return normalized.catalog.map((shape) => ({
    id: shape.id,
    mask: shape.mask,
    rows: shape.rows.slice(),
    cellCount: shape.cellCount,
    density: shape.density,
    bounds: shape.bounds,
    connectedComponents4: shape.connectedComponents4,
    connectedComponents8: shape.connectedComponents8,
    holeCount: shape.holeCount,
    diagonalTouchCount: shape.diagonalTouchCount,
    diagonalTouchCountIgnoringMirror: shape.diagonalTouchCountIgnoringMirror,
  }));
}

function optionsFingerprint(normalized) {
  const fingerprintOptions = {
    version: STYLE_VERSION,
    seedMode: normalized.seedMode,
    constraints: {
      ...normalized.constraints,
      maxHoles: normalized.constraints.maxHoles === Infinity ? "Infinity" : normalized.constraints.maxHoles,
    },
    palettes: normalized.palettes.map((item) => item.visualKey),
    paletteChoices: normalized.paletteChoices,
  };
  if (normalized.distinguishability) fingerprintOptions.distinguishability = normalized.distinguishability;
  const payload = JSON.stringify(fingerprintOptions);
  return hashHex128(payload);
}

function namespaceFingerprint(namespace) {
  return hashHex128(`${STYLE_VERSION}\u0000namespace\u0000${namespace}`);
}

function manifestPolicyMatches(policy, expected) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return false;
  const expectedKeys = ["schema", "minimumShapeDistance", "minimumPaletteDistance", "mode"];
  try {
    if (Object.getPrototypeOf(policy) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(policy);
    if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) return false;
    return expectedKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(policy, key);
      return descriptor?.enumerable === true
        && Object.hasOwn(descriptor, "value")
        && Object.is(descriptor.value, expected[key]);
    });
  } catch {
    return false;
  }
}

function validateManifest(manifest, normalized) {
  if (manifest === undefined) return { entries: {} };
  const requiredKeys = ["schema", "styleVersion", "namespaceKey", "optionsKey", "entries"];
  const allowedKeys = new Set([...requiredKeys, "distinguishability"]);
  const snapshot = {};
  try {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || Object.getPrototypeOf(manifest) !== Object.prototype) {
      throw new TypeError();
    }
    const keys = Reflect.ownKeys(manifest);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
      || requiredKeys.some((key) => !keys.includes(key))) {
      throw new TypeError();
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(manifest, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError();
      snapshot[key] = descriptor.value;
    }
  } catch {
    throw new TypeError("manifest must be a plain JSON object with the expected enumerable data properties.");
  }

  if (snapshot.schema !== "deterministic-agent-avatars-manifest/v1") {
    throw new TypeError("Unsupported manifest schema.");
  }
  if (snapshot.styleVersion !== STYLE_VERSION) {
    throw new TypeError(`Manifest styleVersion must be ${STYLE_VERSION}.`);
  }
  if (snapshot.namespaceKey !== namespaceFingerprint(normalized.namespace)) {
    throw new TypeError("Manifest namespace does not match the requested namespace.");
  }
  const hasManifestPolicy = Object.hasOwn(snapshot, "distinguishability");
  if (hasManifestPolicy !== Boolean(normalized.distinguishability)
    || (normalized.distinguishability
      && !manifestPolicyMatches(snapshot.distinguishability, normalized.distinguishability))) {
    throw new TypeError("Manifest distinguishability policy does not match the requested policy.");
  }
  if (snapshot.optionsKey !== optionsFingerprint(normalized)) {
    throw new TypeError("Manifest options do not match the requested palette, constraints, or seed mode.");
  }
  const entries = snapshot.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new TypeError("manifest.entries must be an object.");
  }
  return { entries };
}

function invalidManifestEntry(identityKey) {
  const safeIdentityKey = typeof identityKey === "string" && /^[0-9a-f]{32}$/.test(identityKey)
    ? identityKey
    : "<invalid identity key>";
  return new TypeError(`Invalid manifest entry for ${safeIdentityKey}.`);
}

function hydrateManifestEntries(entries, normalized, ensureUnique) {
  let identityKeys;
  try {
    identityKeys = Reflect.ownKeys(entries);
  } catch {
    throw invalidManifestEntry(undefined);
  }
  if (identityKeys.length > MAX_MANIFEST_ENTRIES) {
    throw new RangeError(`manifest.entries must contain at most ${MAX_MANIFEST_ENTRIES} entries.`);
  }
  if (ensureUnique && identityKeys.length > normalized.stateSpace) {
    throw new RangeError(
      `Manifest contains ${identityKeys.length} entries, but the configured state space contains only ${normalized.stateSpace}.`
    );
  }
  if (identityKeys.some((key) => typeof key !== "string")) throw invalidManifestEntry(undefined);

  const shapeIndexById = new Map(normalized.catalog.map((shape, index) => [shape.id, index]));
  const selectedPalettes = normalized.paletteChoices.map((paletteIndex) => normalized.palettes[paletteIndex]);
  const palettePositionById = new Map(selectedPalettes.map((selectedPalette, position) => [selectedPalette.id, position]));
  const manifestEntries = {};
  const resolvedEntries = [];
  const usedSignatures = new Map();

  for (const identityKey of identityKeys) {
    if (!/^[0-9a-f]{32}$/.test(identityKey)) throw invalidManifestEntry(identityKey);
    let entryDescriptor;
    try {
      entryDescriptor = Object.getOwnPropertyDescriptor(entries, identityKey);
    } catch {
      throw invalidManifestEntry(identityKey);
    }
    if (!entryDescriptor || !Object.hasOwn(entryDescriptor, "value")) throw invalidManifestEntry(identityKey);
    const entry = entryDescriptor.value;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidManifestEntry(identityKey);

    const values = {};
    for (const field of ["nonce", "signature", "shapeId", "paletteId"]) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(entry, field);
      } catch {
        throw invalidManifestEntry(identityKey);
      }
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw invalidManifestEntry(identityKey);
      values[field] = descriptor.value;
    }
    if (!Number.isSafeInteger(values.nonce) || values.nonce < 0
      || typeof values.signature !== "string"
      || typeof values.shapeId !== "string"
      || typeof values.paletteId !== "string") {
      throw invalidManifestEntry(identityKey);
    }

    const shapeIndex = shapeIndexById.get(values.shapeId);
    const palettePosition = palettePositionById.get(values.paletteId);
    if (shapeIndex === undefined || palettePosition === undefined) throw invalidManifestEntry(identityKey);
    const shape = normalized.catalog[shapeIndex];
    const selectedPalette = selectedPalettes[palettePosition];
    if (values.signature !== visualSignature(shape, selectedPalette)) throw invalidManifestEntry(identityKey);

    const previous = usedSignatures.get(values.signature);
    if (ensureUnique && previous && previous !== identityKey) {
      throw new Error(`Manifest contains a duplicate visual signature for ${previous} and ${identityKey}.`);
    }
    usedSignatures.set(values.signature, identityKey);
    const copiedEntry = {
      nonce: values.nonce,
      signature: values.signature,
      shapeId: values.shapeId,
      paletteId: values.paletteId,
    };
    manifestEntries[identityKey] = copiedEntry;
    resolvedEntries.push({ identityKey, entry: copiedEntry, shapeIndex, palettePosition });
  }

  return { manifestEntries, resolvedEntries, usedSignatures };
}

function cachedNearShapes(catalog, minimumDistance) {
  let cache = SHAPE_NEIGHBOR_CACHES.get(catalog);
  if (!cache) {
    cache = createBoundedLruCache(4);
    SHAPE_NEIGHBOR_CACHES.set(catalog, cache);
  }
  const cached = cache.get(minimumDistance);
  if (cached) return cached;
  const nearShapes = Object.freeze(catalog.map((left) => {
    const near = [];
    for (let right = 0; right < catalog.length; right++) {
      if (shapeHammingDistance(left.rows, catalog[right].rows) < minimumDistance) near.push(right);
    }
    return Object.freeze(near);
  }));
  return cache.set(minimumDistance, nearShapes);
}

function cachedNearPalettes(palettes, choices, minimumDistance) {
  let cache = PALETTE_NEIGHBOR_CACHES.get(palettes);
  if (!cache) {
    cache = createBoundedLruCache(16);
    PALETTE_NEIGHBOR_CACHES.set(palettes, cache);
  }
  const key = `${minimumDistance}|${choices.join(",")}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const selectedPalettes = choices.map((paletteIndex) => palettes[paletteIndex]);
  const paletteCount = selectedPalettes.length;
  const paletteDistances = buildPaletteDistanceMatrix(selectedPalettes);
  const nearPalettes = Object.freeze(selectedPalettes.map((_, left) => {
    const near = [];
    for (let right = 0; right < paletteCount; right++) {
      if (paletteDistances[left * paletteCount + right] < minimumDistance) near.push(right);
    }
    return Object.freeze(near);
  }));
  return cache.set(key, nearPalettes);
}

function createDistanceAllocator(normalized, resolvedEntries) {
  const policy = normalized.distinguishability;
  const paletteCount = normalized.paletteChoices.length;
  const shapeCount = normalized.catalog.length;
  const shapeEnabled = policy.minimumShapeDistance > 0;
  const paletteEnabled = policy.minimumPaletteDistance > 0;
  const palettePositionByIndex = new Map(normalized.paletteChoices.map((paletteIndex, position) => [paletteIndex, position]));
  const nearShapes = shapeEnabled
    ? cachedNearShapes(normalized.catalog, policy.minimumShapeDistance)
    : undefined;
  const nearPalettes = paletteEnabled
    ? cachedNearPalettes(normalized.palettes, normalized.paletteChoices, policy.minimumPaletteDistance)
    : undefined;
  const blockedStates = new Uint8Array(normalized.stateSpace);

  function stateIndex(shapeIndex, palettePosition) {
    return shapeIndex * paletteCount + palettePosition;
  }

  function blockShapeBand(shapeIndex) {
    for (const nearShape of nearShapes[shapeIndex]) {
      const offset = nearShape * paletteCount;
      blockedStates.fill(1, offset, offset + paletteCount);
    }
  }

  function blockPaletteBand(palettePosition) {
    for (let shapeIndex = 0; shapeIndex < shapeCount; shapeIndex++) {
      for (const nearPalette of nearPalettes[palettePosition]) {
        blockedStates[stateIndex(shapeIndex, nearPalette)] = 1;
      }
    }
  }

  function accept(shapeIndex, palettePosition) {
    if (shapeEnabled && !paletteEnabled) {
      blockShapeBand(shapeIndex);
    } else if (!shapeEnabled && paletteEnabled) {
      blockPaletteBand(palettePosition);
    } else if (policy.mode === "either") {
      for (const nearShape of nearShapes[shapeIndex]) {
        for (const nearPalette of nearPalettes[palettePosition]) {
          blockedStates[stateIndex(nearShape, nearPalette)] = 1;
        }
      }
    } else {
      blockShapeBand(shapeIndex);
      blockPaletteBand(palettePosition);
    }
  }

  for (const { identityKey, shapeIndex, palettePosition } of resolvedEntries) {
    if (blockedStates[stateIndex(shapeIndex, palettePosition)] !== 0) {
      throw new Error(`Manifest contains an invalid visual-distance assignment for identity ${identityKey}.`);
    }
    accept(shapeIndex, palettePosition);
  }

  return {
    isBlocked(descriptor) {
      const palettePosition = palettePositionByIndex.get(descriptor.paletteIndex);
      return blockedStates[stateIndex(descriptor.shapeIndex, palettePosition)] !== 0;
    },
    accept(descriptor) {
      accept(descriptor.shapeIndex, palettePositionByIndex.get(descriptor.paletteIndex));
    },
  };
}

function createIdentitySet(seeds, options = {}) {
  if (!Array.isArray(seeds)) throw new TypeError("seeds must be an array.");
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object.");
  }
  if (seeds.length > MAX_IDENTITY_SET_ITEMS) {
    throw new RangeError(`seeds must contain at most ${MAX_IDENTITY_SET_ITEMS} entries.`);
  }
  const includeSvg = normalizeOptionalBoolean(options.includeSvg, true, "includeSvg");
  const ensureUnique = normalizeOptionalBoolean(options.ensureUnique, true, "ensureUnique");
  if (options.collisionNonce !== undefined) {
    throw new TypeError("collisionNonce is not supported by createIdentitySet; the allocator manages per-identity nonces.");
  }
  const normalized = normalizeOptions(options);
  if (normalized.distinguishability && !ensureUnique) {
    throw new TypeError("ensureUnique must not be false when a distinguishability policy is enabled.");
  }
  const size = options.size ?? 96;
  const suppliedManifest = validateManifest(options.manifest, normalized);
  const hydratedManifest = hydrateManifestEntries(suppliedManifest.entries, normalized, ensureUnique);
  const manifestEntries = hydratedManifest.manifestEntries;
  const optionsKey = optionsFingerprint(normalized);
  const namespaceKey = namespaceFingerprint(normalized.namespace);
  const usedSignatures = hydratedManifest.usedSignatures;

  const records = seeds.map((input, index) => {
    const canonical = canonicalSeed(input, normalized.seedMode);
    const identityKey = hashHex128(domainMessage("identity-key", canonical, normalized.namespace, 0));
    return { input, index, canonical, identityKey };
  });

  const uniqueRecords = new Map();
  for (const record of records) {
    const existing = uniqueRecords.get(record.identityKey);
    if (existing && existing.canonical !== record.canonical) {
      throw new Error("A 128-bit identity-key collision occurred. Use private HMAC-derived seeds or a different namespace.");
    }
    if (!existing) uniqueRecords.set(record.identityKey, record);
  }

  const unassignedCount = Array.from(uniqueRecords.values()).filter((record) => !manifestEntries[record.identityKey]).length;
  if (ensureUnique && usedSignatures.size + unassignedCount > normalized.stateSpace) {
    throw new RangeError(`The requested set needs ${usedSignatures.size + unassignedCount} unique signatures, but the configured state space contains only ${normalized.stateSpace}.`);
  }

  const assigned = new Map();
  const sortedUnique = Array.from(uniqueRecords.values()).sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  const maxAttempts = options.maxAttempts === undefined
    ? Math.min(Math.max(4096, sortedUnique.length * 128), Math.max(4096, normalized.stateSpace * 2))
    : Number(options.maxAttempts);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive safe integer.");
  }
  const distanceAllocator = normalized.distinguishability
    ? createDistanceAllocator(normalized, hydratedManifest.resolvedEntries)
    : undefined;

  for (const record of sortedUnique) {
    const existingEntry = manifestEntries[record.identityKey];
    if (existingEntry) {
      const descriptor = createDescriptorFromNormalized(record.input, normalized, existingEntry.nonce);
      if (descriptor.signature !== existingEntry.signature
        || descriptor.shapeId !== existingEntry.shapeId
        || descriptor.paletteId !== existingEntry.paletteId) {
        throw new Error(`Manifest entry for ${record.identityKey} no longer resolves to its stored signature.`);
      }
      assigned.set(record.identityKey, descriptor);
      continue;
    }

    let descriptor;
    for (let nonce = 0; nonce < maxAttempts; nonce++) {
      const candidate = createDescriptorFromNormalized(record.input, normalized, nonce);
      if ((!ensureUnique || !usedSignatures.has(candidate.signature)) && !distanceAllocator?.isBlocked(candidate)) {
        descriptor = candidate;
        break;
      }
    }
    if (!descriptor) {
      if (normalized.distinguishability) {
        const policy = normalized.distinguishability;
        throw new Error(
          `deterministic allocation attempts exhausted for identity ${record.identityKey}; `
          + `accepted unique count ${usedSignatures.size}; thresholds shape=${policy.minimumShapeDistance}, `
          + `palette=${policy.minimumPaletteDistance}, mode=${policy.mode}; attempts=${maxAttempts}/${maxAttempts}. `
          + "Try lower thresholds, add palettes, or increase maxAttempts."
        );
      }
      throw new Error(`Unable to allocate a unique avatar for identity ${record.identityKey} within ${maxAttempts} deterministic attempts.`);
    }

    usedSignatures.set(descriptor.signature, record.identityKey);
    distanceAllocator?.accept(descriptor);
    manifestEntries[record.identityKey] = {
      nonce: descriptor.collisionNonce,
      signature: descriptor.signature,
      shapeId: descriptor.shapeId,
      paletteId: descriptor.paletteId,
    };
    assigned.set(record.identityKey, descriptor);
  }

  const items = records.map((record) => {
    const descriptor = assigned.get(record.identityKey);
    return {
      input: record.input,
      identityKey: record.identityKey,
      nonce: descriptor.collisionNonce,
      signature: descriptor.signature,
      descriptor,
      ...(includeSvg ? { svg: createHashAvatarFromDescriptor(descriptor, size) } : {}),
    };
  });

  const sortedEntries = {};
  for (const identityKey of Object.keys(manifestEntries).sort()) sortedEntries[identityKey] = manifestEntries[identityKey];
  const manifest = {
    schema: "deterministic-agent-avatars-manifest/v1",
    styleVersion: STYLE_VERSION,
    namespaceKey,
    optionsKey,
    ...(normalized.distinguishability ? { distinguishability: normalized.distinguishability } : {}),
    entries: sortedEntries,
  };

  return { items, manifest, stateSpace: normalized.stateSpace };
}

function readManifestDistinguishability(manifest) {
  try {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || Object.getPrototypeOf(manifest) !== Object.prototype) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(manifest, "distinguishability");
    if (!descriptor) return { policy: null };
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
    const policy = descriptor.value;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)
      || Object.getPrototypeOf(policy) !== Object.prototype) return undefined;
    const keys = ["schema", "minimumShapeDistance", "minimumPaletteDistance", "mode"];
    const snapshot = {};
    if (Reflect.ownKeys(policy).length !== keys.length) return undefined;
    for (const key of keys) {
      const item = Object.getOwnPropertyDescriptor(policy, key);
      if (!item?.enumerable || !Object.hasOwn(item, "value")) return undefined;
      snapshot[key] = item.value;
    }
    if (snapshot.schema !== "visual-distance/v1") return undefined;
    const normalized = normalizeDistinguishability({
      minimumShapeDistance: snapshot.minimumShapeDistance,
      minimumPaletteDistance: snapshot.minimumPaletteDistance,
      distanceMode: snapshot.mode,
    });
    if (!normalized) return undefined;
    return { policy: normalized };
  } catch {
    return undefined;
  }
}

function optionsWithPolicy(options, policy) {
  return {
    ...options,
    minimumShapeDistance: policy?.minimumShapeDistance ?? 0,
    minimumPaletteDistance: policy?.minimumPaletteDistance ?? 0,
    distanceMode: policy?.mode ?? "either",
  };
}

function policyAdjustment(reason, requested, result) {
  return Object.freeze({
    reason,
    requested: requested ?? null,
    applied: result.manifest.distinguishability ?? null,
  });
}

/**
 * Creates a set while keeping strict createIdentitySet() semantics available.
 * A persisted manifest wins over conflicting requested distance settings. When
 * a new allocation cannot satisfy its requested distances, the thresholds are
 * reduced together in bounded deterministic steps until allocation succeeds.
 */
function createIdentitySetWithFallback(seeds, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object.");
  }
  const requested = normalizeDistinguishability(options);

  try {
    return createIdentitySet(seeds, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Manifest distinguishability policy does not match the requested policy.") {
      const manifestPolicy = readManifestDistinguishability(options.manifest);
      if (manifestPolicy) {
        const result = createIdentitySet(seeds, optionsWithPolicy(options, manifestPolicy.policy));
        return {
          ...result,
          policyAdjustment: policyAdjustment("manifest-policy", requested, result),
        };
      }
    }

    if (!requested || options.manifest !== undefined
      || !message.startsWith("deterministic allocation attempts exhausted")) throw error;

    const tried = new Set([`${requested.minimumShapeDistance}|${requested.minimumPaletteDistance}`]);
    for (let step = 1; step <= 10; step++) {
      const factor = (10 - step) / 10;
      const minimumShapeDistance = Math.floor(requested.minimumShapeDistance * factor);
      const minimumPaletteDistance = Math.round(requested.minimumPaletteDistance * factor * 1000) / 1000;
      const key = `${minimumShapeDistance}|${minimumPaletteDistance}`;
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        const result = createIdentitySet(seeds, {
          ...options,
          minimumShapeDistance,
          minimumPaletteDistance,
        });
        return {
          ...result,
          policyAdjustment: policyAdjustment("capacity", requested, result),
        };
      } catch (candidateError) {
        const candidateMessage = candidateError instanceof Error ? candidateError.message : "";
        if (!candidateMessage.startsWith("deterministic allocation attempts exhausted")) throw candidateError;
      }
    }
    throw error;
  }
}

export {
  STYLE_VERSION,
  GRID_W,
  GRID_H,
  RAW_SYMMETRIC_MASKS,
  BUILTIN_PALETTES,
  canonicalSeed,
  hash32,
  contrastRatio,
  rowsFromSymmetricMask,
  symmetricMaskFromRows,
  getAvatarCatalog,
  getCatalogStats,
  validateAvatarBitmap,
  createAvatarDescriptor,
  createHashAvatarFromDescriptor,
  createHashAvatar,
  avatarDataUri,
  createIdentitySet,
  createIdentitySetWithFallback,
};
