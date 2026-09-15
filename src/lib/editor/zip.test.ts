import { describe, expect, it } from 'vitest';
import { crc32, dosDateTime, zipEntries, zipStore } from './zip';

const encoder = new TextEncoder();
const bytesOf = (text: string) => encoder.encode(text);
const FIXED = new Date('2026-09-14T10:20:30Z');

describe('crc32', () => {
  it('matches the reference values', () => {
    // The check value every CRC-32 implementation is tested against.
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(bytesOf('a'))).toBe(0xe8b7be43);
  });
});

describe('dosDateTime', () => {
  it('packs the UTC date and time the way MS-DOS did, to two seconds', () => {
    const { time, date } = dosDateTime(FIXED);
    expect(time).toBe((10 << 11) | (20 << 5) | (30 >> 1));
    expect(date).toBe(((2026 - 1980) << 9) | (9 << 5) | 14);
  });

  it('does not go before 1980, which the format cannot express', () => {
    expect(dosDateTime(new Date('1970-01-01T00:00:00Z')).date >> 9).toBe(0);
  });
});

describe('zipStore', () => {
  const entries = [
    { name: 'a.txt', data: bytesOf('hello') },
    { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 3, 255]) },
    { name: 'empty', data: new Uint8Array() },
  ];

  it('round-trips names, bytes and checksums through the reader', () => {
    const archive = zipStore(entries, FIXED);
    expect(Array.from(archive.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const read = zipEntries(archive);
    expect(read.map((r) => r.name)).toEqual(['a.txt', 'dir/b.bin', 'empty']);
    expect(read.map((r) => r.size)).toEqual([5, 5, 0]);
    read.forEach((record, i) => {
      expect(Array.from(record.data)).toEqual(Array.from(entries[i].data));
      expect(record.crc).toBe(crc32(entries[i].data));
    });
  });

  it('writes a central directory whose count, size and offsets are exact', () => {
    const archive = zipStore(entries, FIXED);
    const view = new DataView(archive.buffer);
    const end = archive.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(3);
    expect(view.getUint16(end + 10, true)).toBe(3);
    const directoryStart = view.getUint32(end + 16, true);
    expect(view.getUint32(end + 12, true)).toBe(end - directoryStart);
    expect(view.getUint32(directoryStart, true)).toBe(0x02014b50);

    // Each local header sits exactly where the directory says; stored entries
    // are laid end to end, so the offsets are the running sum of what precedes.
    const read = zipEntries(archive);
    let expected = 0;
    for (const [i, record] of read.entries()) {
      expect(record.offset).toBe(expected);
      expect(view.getUint32(record.offset, true)).toBe(0x04034b50);
      // Method 0, and the two sizes agree, because nothing is compressed.
      expect(view.getUint16(record.offset + 8, true)).toBe(0);
      expect(view.getUint32(record.offset + 18, true)).toBe(entries[i].data.length);
      expect(view.getUint32(record.offset + 22, true)).toBe(entries[i].data.length);
      expected += 30 + bytesOf(entries[i].name).length + entries[i].data.length;
    }
    expect(directoryStart).toBe(expected);
  });

  it('marks names as UTF-8 and keeps an accented one whole', () => {
    const archive = zipStore([{ name: 'diseño/ñandú.xml', data: bytesOf('<x/>') }], FIXED);
    const view = new DataView(archive.buffer);
    // Bit 11 of the general-purpose flags, in the local header and in the directory.
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    const directoryStart = view.getUint32(archive.length - 22 + 16, true);
    expect(view.getUint16(directoryStart + 8, true) & 0x0800).toBe(0x0800);
    expect(zipEntries(archive)[0].name).toBe('diseño/ñandú.xml');
  });

  it('stamps every entry with the date given, so the same input is the same file', () => {
    const a = zipStore(entries, FIXED);
    const b = zipStore(entries, FIXED);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const view = new DataView(a.buffer);
    const { time, date } = dosDateTime(FIXED);
    expect(view.getUint16(10, true)).toBe(time);
    expect(view.getUint16(12, true)).toBe(date);
    expect(
      Buffer.from(zipStore(entries, new Date('2020-01-01T00:00:00Z'))).equals(Buffer.from(a)),
    ).toBe(false);
  });

  it('writes an empty archive that is still an archive', () => {
    const archive = zipStore([], FIXED);
    expect(archive.length).toBe(22);
    expect(zipEntries(archive)).toEqual([]);
  });
});

describe('zipEntries', () => {
  it('refuses bytes that are not an archive, and an entry whose data was altered', () => {
    expect(() => zipEntries(bytesOf('not a zip'))).toThrow(/end record/);
    const archive = zipStore([{ name: 'a', data: bytesOf('abc') }], FIXED);
    archive[30 + 1] ^= 0xff; // the first data byte, right after the 30-byte header and the 1-byte name
    expect(() => zipEntries(archive)).toThrow(/CRC/);
  });
});
