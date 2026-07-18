const DEFAULT_SUPERSAMPLE = 4;
const MAX_SIZE = 4096;
const BYTES_PER_PIXEL = 4;
const MAX_RENDER_BYTES = 64 * 1024 * 1024;
const MAX_RENDER_WIDTH = Math.floor(Math.sqrt(MAX_RENDER_BYTES / BYTES_PER_PIXEL));

function normalizePngSize(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) {
    throw new TypeError("PNG size must be an integer in [1, " + MAX_SIZE + "].");
  }
  if (!Number.isInteger(number) || number <= 0 || number > MAX_SIZE) {
    throw new RangeError("PNG size must be an integer in [1, " + MAX_SIZE + "].");
  }
  return number;
}

function normalizeSupersample(value, targetSize) {
  const usesDefault = value === undefined || value === null;
  const safeDefault = Math.max(1, Math.min(DEFAULT_SUPERSAMPLE, Math.floor(MAX_RENDER_WIDTH / targetSize)));
  const number = usesDefault ? safeDefault : value;
  if (typeof number !== "number" || !Number.isFinite(number)) {
    throw new TypeError("supersample must be an integer in [1, 8].");
  }
  if (!Number.isInteger(number) || number < 1 || number > 8) {
    throw new RangeError("supersample must be an integer in [1, 8].");
  }
  const renderWidth = targetSize * number;
  const renderBytes = renderWidth * renderWidth * BYTES_PER_PIXEL;
  if (renderBytes > MAX_RENDER_BYTES) {
    throw new RangeError(
      "PNG render for size " + targetSize + " and supersample " + number + " exceeds the 64 MiB buffer budget."
    );
  }
  return number;
}

export {
  DEFAULT_SUPERSAMPLE,
  MAX_SIZE,
  MAX_RENDER_BYTES,
  normalizePngSize,
  normalizeSupersample,
};
