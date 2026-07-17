const UTF8 = new TextEncoder();
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const MAX_ARCHIVE_BASENAME = 72;

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function filenameHash(value) {
  let hash = 2166136261;
  for (const byte of UTF8.encode(String(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizedArchiveBase(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "avatar";
}

function uniqueArchiveFilename(value, extension, usedNames) {
  if (!(usedNames instanceof Set)) throw new TypeError("usedNames must be a Set.");
  if (typeof extension !== "string" || !/^[a-z0-9]+$/i.test(extension)) {
    throw new TypeError("extension must contain only ASCII letters and digits.");
  }

  const original = normalizedArchiveBase(value);
  const hashSuffix = `-${filenameHash(value)}`;
  const base = original.length > MAX_ARCHIVE_BASENAME
    ? `${original.slice(0, MAX_ARCHIVE_BASENAME - hashSuffix.length)}${hashSuffix}`
    : original;
  let suffix = 1;
  let filename = `${base}.${extension}`;
  while (usedNames.has(filename.toLowerCase())) filename = `${base}-${++suffix}.${extension}`;
  usedNames.add(filename.toLowerCase());
  return filename;
}

function createStoredZip(files, date = new Date()) {
  if (!Array.isArray(files) || files.length > MAX_UINT16) {
    throw new RangeError(`ZIP archives support at most ${MAX_UINT16} entries.`);
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError("date must be valid.");

  const localChunks = [];
  const centralChunks = [];
  const stamp = zipDateTime(date);
  let localOffset = 0;

  for (const file of files) {
    if (!file || typeof file !== "object" || typeof file.name !== "string" || !(file.data instanceof Uint8Array)) {
      throw new TypeError("Each ZIP entry must contain a string name and Uint8Array data.");
    }
    const name = UTF8.encode(file.name);
    const data = file.data;
    if (name.length === 0 || name.length > MAX_UINT16) {
      throw new RangeError(`ZIP entry names must contain between 1 and ${MAX_UINT16} UTF-8 bytes.`);
    }
    if (data.length > MAX_UINT32 || localOffset > MAX_UINT32) {
      throw new RangeError("ZIP32 archive size limit exceeded.");
    }

    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localChunks.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.length + data.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  if (localOffset + centralDirectory.length + 22 > MAX_UINT32) {
    throw new RangeError("ZIP32 archive size limit exceeded.");
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  return new Blob([...localChunks, centralDirectory, end], { type: "application/zip" });
}

export { createStoredZip, uniqueArchiveFilename };
