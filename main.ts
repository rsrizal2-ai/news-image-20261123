// news-image-20261123 — entry program.
//
// Copies the pre-rendered front-page image (entry.png, in this repository)
// to the output directory as entry.png, after a strict self-check gate.
// No network, no randomness, no timestamps: two runs write identical bytes.
//
// Usage:  MAKEFUN_OUTPUT_DIR=out node main.ts
// Default output directory is ./out when MAKEFUN_OUTPUT_DIR is unset.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1_048_576; // 1 MiB
const MAX_DIMENSION = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (IEEE 802.3) table, built once at startup.
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(message: string): never {
  throw new Error(`entry gate failed: ${message}`);
}

// Validate the PNG fully: signature, IHDR dimensions, every chunk's
// length/CRC, and the terminating IEND chunk. Returns [width, height].
function validatePng(bytes: Buffer): [number, number] {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("not a PNG file (bad signature)");
  }
  if (bytes.length > MAX_BYTES) {
    fail(`file is ${bytes.length} bytes, over the ${MAX_BYTES} byte limit`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let seenIhdr = false;
  let seenIend = false;

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > bytes.length) {
      fail(`chunk ${type} at offset ${offset} runs past end of file`);
    }
    const storedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([bytes.subarray(offset + 4, offset + 8), bytes.subarray(dataStart, dataEnd)]));
    if (storedCrc !== actualCrc) {
      fail(`chunk ${type} has a bad CRC (stored ${storedCrc}, computed ${actualCrc})`);
    }
    if (type === "IHDR") {
      if (seenIhdr || length !== 13) {
        fail("malformed IHDR chunk");
      }
      seenIhdr = true;
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      if (width === 0 || height === 0) {
        fail("image has a zero dimension");
      }
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        fail(`image is ${width}x${height}, over the ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
      }
    }
    if (type === "IEND") {
      seenIend = true;
      if (crcEnd !== bytes.length) {
        fail("trailing bytes after IEND chunk");
      }
      break;
    }
    offset = crcEnd;
  }

  if (!seenIhdr) {
    fail("missing IHDR chunk");
  }
  if (!seenIend) {
    fail("missing IEND chunk");
  }
  return [width, height];
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(scriptDir, "entry.png");
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? join(scriptDir, "out");
  const outputPath = join(outputDir, "entry.png");

  const bytes = readFileSync(sourcePath);
  const [width, height] = validatePng(bytes);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, bytes);

  // Confirm the write landed byte-identical.
  const written = readFileSync(outputPath);
  if (!written.equals(bytes)) {
    fail("output bytes differ from source bytes");
  }
  const size = statSync(outputPath).size;
  console.log(`wrote ${outputPath} (${width}x${height}, ${size} bytes)`);
}

main();
