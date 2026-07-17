const AVATAR_STYLE_VERSION = "1";
const GRID_HEIGHT = 4;
const MAX_ROW_VALUE = 31;

function normalizeHexColor(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new TypeError(label + " must be a six-digit hexadecimal color such as #EAF3F8.");
  }
  return value.toUpperCase();
}

function snapshotNumericRows(rows, label = "rows") {
  if (!Array.isArray(rows) || rows.length !== GRID_HEIGHT) {
    throw new TypeError(
      label + " must contain " + GRID_HEIGHT + " integers in [0, " + MAX_ROW_VALUE + "]."
    );
  }

  const snapshot = new Array(GRID_HEIGHT);
  for (let index = 0; index < GRID_HEIGHT; index++) {
    if (!Object.hasOwn(rows, index)) {
      throw new TypeError(
        label + " must contain " + GRID_HEIGHT + " integers in [0, " + MAX_ROW_VALUE + "]."
      );
    }
    const row = rows[index];
    if (!Number.isInteger(row) || row < 0 || row > MAX_ROW_VALUE) {
      throw new TypeError(
        label + " must contain " + GRID_HEIGHT + " integers in [0, " + MAX_ROW_VALUE + "]."
      );
    }
    snapshot[index] = row;
  }
  return snapshot;
}

function snapshotRenderableDescriptor(descriptor) {
  if (!descriptor || descriptor.styleVersion !== AVATAR_STYLE_VERSION) {
    throw new TypeError("descriptor must be a " + AVATAR_STYLE_VERSION + " avatar descriptor.");
  }

  // Snapshot rows before reading colors so accessors cannot mutate the rendered bitmap after validation.
  const safeRows = snapshotNumericRows(descriptor.rows, "descriptor.rows");
  const colors = descriptor.colors;
  const background = normalizeHexColor(colors?.background, "descriptor.colors.background");
  const foreground = normalizeHexColor(colors?.foreground, "descriptor.colors.foreground");

  return {
    rows: safeRows,
    colors: { background, foreground },
  };
}

export { normalizeHexColor, snapshotNumericRows, snapshotRenderableDescriptor };
