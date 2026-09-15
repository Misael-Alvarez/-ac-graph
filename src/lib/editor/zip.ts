/**
 * A minimal ZIP writer, and the reader that checks it.
 *
 * An Office document is a ZIP of XML parts and pictures. The pictures are PNGs
 * and already compressed, the XML is a few kilobytes, so nothing here is worth
 * deflating: every entry is stored as it is (method 0), which is the one
 * method a writer can implement in a screen of code and every reader accepts.
 * Written by hand for the same reason the PDF is — a dependency whose whole
 * job would be this file.
 *
 * Names are UTF-8 and say so (general-purpose flag bit 11), so a diagram title
 * with an accent survives the trip. Timestamps come from a date the caller
 * chooses, so a test can pin them and the same input gives the same bytes.
 *
 * Pure: takes bytes, returns bytes. No DOM, so it runs in Node and the browser.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. `ppt/slides/slide1.xml`. */
  name: string;
  data: Uint8Array;
}

/** One entry as read back from an archive's central directory. */
export interface ZipRecord {
  name: string;
  size: number;
  /** Where the entry's local header starts. */
  offset: number;
  crc: number;
  data: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bit 11 of the general-purpose flags: the name is UTF-8. */
const UTF8_NAMES = 0x0800;
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;

/* ── CRC-32 ─────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as ZIP records it (IEEE polynomial, reflected). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ── writing ────────────────────────────────────────────── */

/**
 * A date as MS-DOS keeps it: two seconds of resolution, nothing before 1980.
 * Taken in UTC so the bytes do not depend on where the export is made.
 */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** A little-endian byte writer over a buffer sized in advance. */
class Writer {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  position = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): void {
    this.view.setUint16(this.position, value, true);
    this.position += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.position, value >>> 0, true);
    this.position += 4;
  }

  put(chunk: Uint8Array): void {
    this.bytes.set(chunk, this.position);
    this.position += chunk.length;
  }
}

/**
 * Packs the entries into a ZIP archive, stored, in the order given.
 *
 * The central directory records every entry twice over — once beside its data
 * and once at the end — and readers trust the copy at the end, which is why
 * the offsets in it have to be exact.
 */
export function zipStore(entries: readonly ZipEntry[], date: Date = new Date()): Uint8Array {
  const stamp = dosDateTime(date);
  const names = entries.map((entry) => encoder.encode(entry.name));
  const crcs = entries.map((entry) => crc32(entry.data));

  const localSize = entries.reduce(
    (sum, entry, i) => sum + 30 + names[i].length + entry.data.length,
    0,
  );
  const centralSize = entries.reduce((sum, _, i) => sum + 46 + names[i].length, 0);
  const out = new Writer(localSize + centralSize + 22);

  const offsets: number[] = [];
  for (const [i, entry] of entries.entries()) {
    offsets.push(out.position);
    out.u32(LOCAL_HEADER);
    out.u16(20); // version needed: 2.0
    out.u16(UTF8_NAMES);
    out.u16(0); // method: stored
    out.u16(stamp.time);
    out.u16(stamp.date);
    out.u32(crcs[i]);
    out.u32(entry.data.length); // compressed…
    out.u32(entry.data.length); // …and uncompressed: the same, stored
    out.u16(names[i].length);
    out.u16(0); // no extra field
    out.put(names[i]);
    out.put(entry.data);
  }

  const centralStart = out.position;
  for (const [i, entry] of entries.entries()) {
    out.u32(CENTRAL_HEADER);
    out.u16(20); // version made by: 2.0, MS-DOS attributes
    out.u16(20); // version needed
    out.u16(UTF8_NAMES);
    out.u16(0);
    out.u16(stamp.time);
    out.u16(stamp.date);
    out.u32(crcs[i]);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(names[i].length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(offsets[i]);
    out.put(names[i]);
  }

  const centralEnd = out.position;
  out.u32(END_RECORD);
  out.u16(0); // this disk
  out.u16(0); // disk holding the central directory
  out.u16(entries.length); // entries on this disk…
  out.u16(entries.length); // …and in all
  out.u32(centralEnd - centralStart);
  out.u32(centralStart);
  out.u16(0); // no comment
  return out.bytes;
}

/* ── reading ────────────────────────────────────────────── */

/**
 * Reads an archive's central directory back, checking each stored entry's CRC.
 *
 * Only what `zipStore` writes is understood — stored entries, one disk — and
 * anything else is refused rather than half-read: this exists so a test can
 * prove the writer right, not to open other people's archives.
 */
export function zipEntries(bytes: Uint8Array): ZipRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last 22 bytes when there is no comment; scan back
  // over a comment's worth of bytes in case there is one.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_RECORD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP archive: no end record.');
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);

  const records: ZipRecord[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(position, true) !== CENTRAL_HEADER) {
      throw new Error(`Central directory entry ${n} is not where the end record says.`);
    }
    const method = view.getUint16(position + 10, true);
    if (method !== 0)
      throw new Error(`Entry ${n} is compressed (method ${method}); only stored is read.`);
    const crc = view.getUint32(position + 16, true);
    const size = view.getUint32(position + 20, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const offset = view.getUint32(position + 42, true);
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extraLength + commentLength;

    if (view.getUint32(offset, true) !== LOCAL_HEADER) {
      throw new Error(`${name}: the central directory points at no local header.`);
    }
    const dataStart =
      offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch.`);
    records.push({ name, size, offset, crc, data });
  }
  return records;
}
