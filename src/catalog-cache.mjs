function createBoundedLruCache(maxEntries) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError("maxEntries must be a positive safe integer.");
  }

  const entries = new Map();
  return Object.freeze({
    get size() {
      return entries.size;
    },
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      return value;
    },
  });
}

export { createBoundedLruCache };
