const AVATAR_STYLE_VERSION = "1";
const GRID_HEIGHT = 4;
const MAX_ROW_VALUE = 31;

function normalizeHexColor(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new TypeError(label + " must be a six-digit hexadecimal color such as #EAF3F8.");
  }
  return value.toUpperCase();
}

function snapshotRenderableDescriptor(descriptor) {
  if (!descriptor || descriptor.styleVersion !== AVATAR_STYLE_VERSION) {
    throw new TypeError("descriptor must be a " + AVATAR_STYLE_VERSION + " avatar descriptor.");
  }

  const rows = descriptor.rows;
  if (
    !Array.isArray(rows)
    || rows.length !== GRID_HEIGHT
    || rows.some((row) => !Number.isInteger(row) || row < 0 || row > MAX_ROW_VALUE)
  ) {
    throw new TypeError(
      "descriptor.rows must contain " + GRID_HEIGHT + " integers in [0, " + MAX_ROW_VALUE + "]."
    );
  }

  // Snapshot rows before reading colors so accessors cannot mutate the rendered bitmap after validation.
  const safeRows = rows.slice();
  const colors = descriptor.colors;
  const background = normalizeHexColor(colors?.background, "descriptor.colors.background");
  const foreground = normalizeHexColor(colors?.foreground, "descriptor.colors.foreground");

  return {
    rows: safeRows,
    colors: { background, foreground },
  };
}

export { normalizeHexColor, snapshotRenderableDescriptor };
