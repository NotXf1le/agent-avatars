import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createAvatarDescriptor } from "./index.mjs";
import { snapshotRenderableDescriptor } from "./render-descriptor.mjs";
import { normalizePngSize, normalizeSupersample } from "./png-options.mjs";

const PLATFORM_PNG_SIZES = Object.freeze([32, 64, 192, 200]);
const GRID_W = 5;
const GRID_H = 4;
const CELL = 10;
const GLYPH_X = 39;
const GLYPH_Y = 44;
const MAX_PNG_SET_SIZES = 64;
const MAX_PNG_SET_RENDER_PIXELS = 16_777_216;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function parseColor(hex) {
  if (typeof hex !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new TypeError(`Invalid render color: ${hex}`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function blendPixel(buffer, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= width || alpha <= 0) return;
  const offset = (y * width + x) * 4;
  const sourceAlpha = Math.max(0, Math.min(1, alpha));
  const destinationAlpha = buffer[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;

  for (let channel = 0; channel < 3; channel++) {
    const source = color[channel] / 255;
    const destination = buffer[offset + channel] / 255;
    const output = (source * sourceAlpha + destination * destinationAlpha * (1 - sourceAlpha)) / outputAlpha;
    buffer[offset + channel] = Math.round(output * 255);
  }
  buffer[offset + 3] = Math.round(outputAlpha * 255);
}

function fillCircle(buffer, width, scale, centerX, centerY, radius, color, alpha = 1) {
  const cx = centerX * scale;
  const cy = centerY * scale;
  const r = radius * scale;
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(width - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(width - 1, Math.ceil(cy + r));
  const r2 = r * r;

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5 - cy;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - cx;
      if (px * px + py * py <= r2) blendPixel(buffer, width, x, y, color, alpha);
    }
  }
}

function pointInsideRoundedCell(px, py, x, y, size, radius, corners) {
  if (px < x || px > x + size || py < y || py > y + size) return false;
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  if (topLeft && px < x + radius && py < y + radius) {
    const dx = px - (x + radius);
    const dy = py - (y + radius);
    return dx * dx + dy * dy <= radius * radius;
  }
  if (topRight && px > x + size - radius && py < y + radius) {
    const dx = px - (x + size - radius);
    const dy = py - (y + radius);
    return dx * dx + dy * dy <= radius * radius;
  }
  if (bottomRight && px > x + size - radius && py > y + size - radius) {
    const dx = px - (x + size - radius);
    const dy = py - (y + size - radius);
    return dx * dx + dy * dy <= radius * radius;
  }
  if (bottomLeft && px < x + radius && py > y + size - radius) {
    const dx = px - (x + radius);
    const dy = py - (y + size - radius);
    return dx * dx + dy * dy <= radius * radius;
  }
  return true;
}

function fillRoundedCell(buffer, width, scale, x, y, size, radius, corners, color) {
  const scaledX = x * scale;
  const scaledY = y * scale;
  const scaledSize = size * scale;
  const scaledRadius = radius * scale;
  const minX = Math.max(0, Math.floor(scaledX));
  const maxX = Math.min(width - 1, Math.ceil(scaledX + scaledSize));
  const minY = Math.max(0, Math.floor(scaledY));
  const maxY = Math.min(width - 1, Math.ceil(scaledY + scaledSize));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      if (pointInsideRoundedCell(px + 0.5, py + 0.5, scaledX, scaledY, scaledSize, scaledRadius, corners)) {
        blendPixel(buffer, width, px, py, color, 1);
      }
    }
  }
}

function cellOn(rows, x, y) {
  return y >= 0 && y < GRID_H && x >= 0 && x < GRID_W && ((rows[y] >>> (GRID_W - 1 - x)) & 1) === 1;
}

function renderHighResolution(descriptor, targetSize, supersample) {
  const width = targetSize * supersample;
  const designScale = width / 128;
  const buffer = new Uint8Array(width * width * 4);
  const background = parseColor(descriptor.colors.background);
  const foreground = parseColor(descriptor.colors.foreground);
  fillCircle(buffer, width, designScale, 64, 64, 48, background, 1);

  const cellRadius = 2;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!cellOn(descriptor.rows, x, y)) continue;
      const up = cellOn(descriptor.rows, x, y - 1);
      const down = cellOn(descriptor.rows, x, y + 1);
      const left = cellOn(descriptor.rows, x - 1, y);
      const right = cellOn(descriptor.rows, x + 1, y);
      fillRoundedCell(
        buffer,
        width,
        designScale,
        GLYPH_X + x * CELL,
        GLYPH_Y + y * CELL,
        CELL,
        cellRadius,
        [!up && !left, !up && !right, !down && !right, !down && !left],
        foreground
      );
    }
  }

  return { buffer, width };
}

function downsample(source, sourceWidth, targetSize, supersample) {
  if (supersample === 1) return source;
  const output = new Uint8Array(targetSize * targetSize * 4);
  const samples = supersample * supersample;

  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      let sumAlpha = 0;
      let sumRed = 0;
      let sumGreen = 0;
      let sumBlue = 0;
      for (let sampleY = 0; sampleY < supersample; sampleY++) {
        for (let sampleX = 0; sampleX < supersample; sampleX++) {
          const sourceX = x * supersample + sampleX;
          const sourceY = y * supersample + sampleY;
          const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
          const alpha = source[sourceOffset + 3] / 255;
          sumAlpha += alpha;
          sumRed += source[sourceOffset] * alpha;
          sumGreen += source[sourceOffset + 1] * alpha;
          sumBlue += source[sourceOffset + 2] * alpha;
        }
      }

      const outputOffset = (y * targetSize + x) * 4;
      const averageAlpha = sumAlpha / samples;
      if (sumAlpha > 0) {
        output[outputOffset] = Math.round(sumRed / sumAlpha);
        output[outputOffset + 1] = Math.round(sumGreen / sumAlpha);
        output[outputOffset + 2] = Math.round(sumBlue / sumAlpha);
      }
      output[outputOffset + 3] = Math.round(averageAlpha * 255);
    }
  }

  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    raw[rowOffset] = 0; // PNG filter: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowOffset + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND"),
  ]);
}

function createAvatarPngFromDescriptor(descriptor, size = 96, options = {}) {
  const snapshot = snapshotRenderableDescriptor(descriptor);
  const targetSize = normalizePngSize(size);
  const supersample = normalizeSupersample(options.supersample, targetSize);
  const highResolution = renderHighResolution(snapshot, targetSize, supersample);
  const rgba = downsample(highResolution.buffer, highResolution.width, targetSize, supersample);
  return encodePng(rgba, targetSize, targetSize);
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

function createAvatarPng(seed, sizeOrOptions = 96, explicitOptions = {}) {
  const { size, options } = optionsFromArgs(sizeOrOptions, explicitOptions);
  const descriptor = createAvatarDescriptor(seed, options);
  return createAvatarPngFromDescriptor(descriptor, size, options);
}

function avatarPngDataUri(seed, sizeOrOptions = 96, explicitOptions = {}) {
  return `data:image/png;base64,${createAvatarPng(seed, sizeOrOptions, explicitOptions).toString("base64")}`;
}

function normalizeSizes(value, supersampleValue) {
  const sizes = value ?? PLATFORM_PNG_SIZES;
  if (!Array.isArray(sizes) || sizes.length === 0) throw new TypeError("sizes must be a non-empty array.");
  if (sizes.length > MAX_PNG_SET_SIZES) {
    throw new RangeError(`sizes must contain at most ${MAX_PNG_SET_SIZES} entries.`);
  }
  const normalized = sizes.map(normalizePngSize);
  if (new Set(normalized).size !== normalized.length) throw new TypeError("sizes must not contain duplicates.");
  let renderPixels = 0;
  for (const size of normalized) {
    const supersample = normalizeSupersample(supersampleValue, size);
    const renderWidth = size * supersample;
    renderPixels += renderWidth * renderWidth;
    if (renderPixels > MAX_PNG_SET_RENDER_PIXELS) {
      throw new RangeError(`PNG set exceeds the ${MAX_PNG_SET_RENDER_PIXELS} render-pixel budget.`);
    }
  }
  return normalized;
}

function createAvatarPngSet(seed, options = {}) {
  const sizes = normalizeSizes(options.sizes, options.supersample);
  const descriptor = createAvatarDescriptor(seed, options);
  const files = {};
  for (const size of sizes) files[size] = createAvatarPngFromDescriptor(descriptor, size, options);
  return { descriptor, files };
}

function writeAvatarPngSet(seed, directory, options = {}) {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new TypeError("directory must be a non-empty path string.");
  }
  const baseName = String(options.baseName ?? "avatar");
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(baseName)) {
    throw new TypeError("baseName may contain only letters, digits, periods, underscores, and hyphens.");
  }

  const outputDirectory = resolve(directory);
  mkdirSync(outputDirectory, { recursive: true });
  const generated = createAvatarPngSet(seed, options);
  const paths = {};

  for (const [size, data] of Object.entries(generated.files)) {
    const path = join(outputDirectory, `${baseName}-${size}.png`);
    writeFileSync(path, data);
    paths[size] = path;
  }

  const manifest = {
    schema: "deterministic-agent-avatars-png-export/v1",
    styleVersion: generated.descriptor.styleVersion,
    identityKey: generated.descriptor.identityKey,
    signature: generated.descriptor.signature,
    namespace: generated.descriptor.namespace,
    theme: generated.descriptor.theme,
    paletteId: generated.descriptor.paletteId,
    files: Object.fromEntries(Object.entries(paths).map(([size, path]) => [size, path.split(/[\\/]/).pop()])),
  };
  const manifestPath = join(outputDirectory, `${baseName}-manifest.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { ...generated, paths, manifestPath, manifest };
}

export {
  PLATFORM_PNG_SIZES,
  createAvatarPngFromDescriptor,
  createAvatarPng,
  avatarPngDataUri,
  createAvatarPngSet,
  writeAvatarPngSet,
};
