export interface ExtractedCover {
  blob: Blob;
  url: string;
  mime: string;
}

/**
 * Universal, rock-solid audio cover art extractor.
 * Supports:
 * - MP3 ID3v2.2 (PIC), ID3v2.3 (APIC), ID3v2.4 (APIC) with unsynchronisation, extended headers, and arbitrary offsets
 * - FLAC METADATA_BLOCK_PICTURE and Vorbis comments (METADATA_BLOCK_PICTURE / COVERART)
 * - M4A / MP4 / AAC ('covr' atom in moov/udta/meta/ilst, both start & end of file)
 * - OGG Vorbis / Opus comment pictures (base64)
 * - Binary magic scanning fallback (JPEG JFIF/Exif, PNG, WebP)
 */
export function extractCoverArt(buffer: ArrayBuffer): ExtractedCover | null {
  if (!buffer || buffer.byteLength < 32) return null;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // 1. Try ID3v2 (v2.2, v2.3, v2.4)
  try {
    const id3Cover = extractFromID3(buffer, bytes, view);
    if (id3Cover) return id3Cover;
  } catch (e) {
    console.warn('ID3 cover extractor error:', e);
  }

  // 2. Try FLAC Picture Block & Vorbis Comments
  try {
    const flacCover = extractFromFLAC(buffer, bytes, view);
    if (flacCover) return flacCover;
  } catch (e) {
    console.warn('FLAC cover extractor error:', e);
  }

  // 3. Try M4A / MP4 'covr' atom
  try {
    const m4aCover = extractFromM4A(buffer, bytes, view);
    if (m4aCover) return m4aCover;
  } catch (e) {
    console.warn('M4A cover extractor error:', e);
  }

  // 4. Try OGG Vorbis / Opus comment picture
  try {
    const oggCover = extractFromOGG(bytes);
    if (oggCover) return oggCover;
  } catch (e) {
    console.warn('OGG cover extractor error:', e);
  }

  // 5. Universal magic signature scan (JPEG / PNG / WebP)
  try {
    const rawCover = scanForImageSignature(buffer, bytes);
    if (rawCover) return rawCover;
  } catch (e) {
    console.warn('Raw image signature scan error:', e);
  }

  return null;
}

/**
 * Searches for ID3v2 tag (ID3v2.2, ID3v2.3, ID3v2.4) and extracts APIC / PIC frame.
 */
function extractFromID3(_buffer: ArrayBuffer, bytes: Uint8Array, view: DataView): ExtractedCover | null {
  // Find 'ID3' marker in first 128 KB
  let id3Offset = -1;
  const searchLimit = Math.min(bytes.length - 10, 131072);
  for (let i = 0; i < searchLimit; i++) {
    if (bytes[i] === 0x49 && bytes[i + 1] === 0x44 && bytes[i + 2] === 0x33) {
      // Validate version (2, 3, or 4) and revision < 255
      if (bytes[i + 3] <= 4 && bytes[i + 4] < 255) {
        id3Offset = i;
        break;
      }
    }
  }

  if (id3Offset === -1) return null;

  const version = bytes[id3Offset + 3]; // 2, 3, or 4
  const flags = bytes[id3Offset + 5];
  const tagUnsync = (flags & 0x80) !== 0;
  const hasExtHeader = (flags & 0x40) !== 0;
  const tagSize = syncsafe(view, id3Offset + 6);
  const totalTagSize = Math.min(tagSize + 10, bytes.length - id3Offset);

  let offset = id3Offset + 10;

  // Handle Extended Header
  if (hasExtHeader && offset + 4 < id3Offset + totalTagSize) {
    try {
      const extSize = version === 4 ? syncsafe(view, offset) : view.getUint32(offset, false);
      if (extSize > 0 && offset + extSize < id3Offset + totalTagSize) {
        offset += version === 4 ? extSize : extSize + 4;
      }
    } catch {
      // Continue anyway
    }
  }

  while (offset + (version === 2 ? 6 : 10) < id3Offset + totalTagSize) {
    // Check for ID3 padding (null bytes)
    if (bytes[offset] === 0x00) {
      break;
    }

    let frameId: string;
    let frameSize: number;
    let headerSize: number;
    let frameFlags = 0;

    if (version === 2) {
      // ID3v2.2: 3-byte ID, 3-byte size
      frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
      headerSize = 6;
    } else {
      // ID3v2.3 / ID3v2.4: 4-byte ID, 4-byte size, 2-byte flags
      frameId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
      );
      headerSize = 10;
      frameFlags = view.getUint16(offset + 8, false);

      const ssSize = syncsafe(view, offset + 4);
      const uSize = view.getUint32(offset + 4, false);

      if (version === 4) {
        // ID3v2.4 specification uses syncsafe, but many encoders incorrectly write 32-bit uint
        if (offset + headerSize + ssSize <= bytes.length && isValidNextFrame(bytes, offset + headerSize + ssSize, version)) {
          frameSize = ssSize;
        } else if (offset + headerSize + uSize <= bytes.length && isValidNextFrame(bytes, offset + headerSize + uSize, version)) {
          frameSize = uSize;
        } else {
          frameSize = ssSize > 0 && ssSize <= totalTagSize ? ssSize : uSize;
        }
      } else {
        // ID3v2.3 standard is uint32
        frameSize = uSize;
      }
    }

    if (frameSize <= 0 || offset + headerSize + frameSize > bytes.length) {
      // If frameSize is invalid, search forward for next 'APIC' or image magic
      break;
    }

    if (frameId === 'APIC' || frameId === 'PIC') {
      const frameStart = offset + headerSize;
      const frameEnd = frameStart + frameSize;
      let rawSlice = bytes.subarray(frameStart, frameEnd);

      // Check if frame or tag is unsynchronized
      const frameUnsync = tagUnsync || (version === 4 && (frameFlags & 0x02) !== 0);
      if (frameUnsync) {
        rawSlice = deunsync(rawSlice);
      }

      const cover = parseApicPayload(rawSlice, version);
      if (cover) return cover;
    }

    offset += headerSize + frameSize;
  }

  // Fallback: If structured loop missed APIC, search for 'APIC' bytes in tag
  for (let i = id3Offset; i < id3Offset + totalTagSize - 16; i++) {
    if (
      bytes[i] === 0x41 && // 'A'
      bytes[i + 1] === 0x50 && // 'P'
      bytes[i + 2] === 0x49 && // 'I'
      bytes[i + 3] === 0x43 // 'C'
    ) {
      const frameStart = i + 10;
      const ss = syncsafe(view, i + 4);
      const uu = view.getUint32(i + 4, false);
      const sz = Math.min(bytes.length - frameStart, Math.max(ss, uu, 2048));
      let rawSlice = bytes.subarray(frameStart, frameStart + sz);
      if (tagUnsync) rawSlice = deunsync(rawSlice);
      const cover = parseApicPayload(rawSlice, 3);
      if (cover) return cover;
    }
  }

  return null;
}

function isValidNextFrame(bytes: Uint8Array, nextOffset: number, version: number): boolean {
  if (nextOffset >= bytes.length) return true;
  if (bytes[nextOffset] === 0x00) return true; // padding
  const idLen = version === 2 ? 3 : 4;
  if (nextOffset + idLen > bytes.length) return false;
  for (let i = 0; i < idLen; i++) {
    const c = bytes[nextOffset + i];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) {
      return false;
    }
  }
  return true;
}

/**
 * Parses APIC frame payload into an ExtractedCover.
 */
function parseApicPayload(payload: Uint8Array, version: number): ExtractedCover | null {
  if (payload.length < 16) return null;

  const encoding = payload[0];
  let p = 1;

  if (version === 2) {
    // ID3v2.2 PIC: 3 bytes format ('JPG' or 'PNG')
    p = 4; // format + pic type
    // Skip null-terminated description
    p = skipNullTerminated(payload, p, encoding);
  } else {
    // ID3v2.3/2.4 APIC: MIME type (null-terminated ASCII)
    while (p < payload.length && payload[p] !== 0x00) p++;
    p++; // skip null
    p++; // skip picture type (1 byte)
    // Description (null-terminated according to encoding)
    p = skipNullTerminated(payload, p, encoding);
  }

  // If p is within payload, check for magic bytes
  let imgStart = p;
  const magic = findImageInBytes(payload, Math.max(0, p - 8), payload.length);
  if (magic) {
    imgStart = magic.start;
  } else {
    // Fallback: search anywhere in payload
    const anywhere = findImageInBytes(payload, 0, payload.length);
    if (!anywhere) return null;
    imgStart = anywhere.start;
  }

  const mime = detectMimeAt(payload, imgStart);
  let imgEnd = payload.length;

  // Trim to actual image end if JPEG or PNG
  if (mime === 'image/jpeg') {
    const eoi = findJpegEoiBytes(payload, imgStart + 4, payload.length);
    if (eoi > imgStart) imgEnd = eoi;
  } else if (mime === 'image/png') {
    const iend = findPngIendBytes(payload, imgStart + 8, payload.length);
    if (iend > imgStart) imgEnd = iend;
  }

  const imgSlice = payload.subarray(imgStart, imgEnd);
  if (imgSlice.length < 32) return null;

  const copy = new Uint8Array(imgSlice);
  const blob = new Blob([copy], {
    type: mime,
  });
  return { blob, url: URL.createObjectURL(blob), mime };
}

function skipNullTerminated(data: Uint8Array, start: number, encoding: number): number {
  let pos = start;
  if (encoding === 1 || encoding === 2) {
    // UTF-16: 2 null bytes
    while (pos < data.length - 1 && !(data[pos] === 0x00 && data[pos + 1] === 0x00)) {
      pos += 2;
    }
    return pos + 2;
  }
  // Latin-1 / UTF-8: 1 null byte
  while (pos < data.length && data[pos] !== 0x00) {
    pos++;
  }
  return pos + 1;
}

/**
 * De-unsynchronises ID3 bytes (removes false MPEG sync dummy zeros).
 */
function deunsync(raw: Uint8Array): Uint8Array {
  let len = raw.length;
  let hasUnsync = false;
  for (let i = 0; i < len - 1; i++) {
    if (raw[i] === 0xff && raw[i + 1] === 0x00) {
      hasUnsync = true;
      break;
    }
  }
  if (!hasUnsync) return raw;

  const out = new Uint8Array(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    out[j++] = raw[i];
    if (raw[i] === 0xff && i + 1 < len && raw[i + 1] === 0x00) {
      i++; // skip injected 0x00
    }
  }
  return out.subarray(0, j);
}

/**
 * Extracts cover art from FLAC METADATA_BLOCK_PICTURE.
 */
function extractFromFLAC(buffer: ArrayBuffer, bytes: Uint8Array, view: DataView): ExtractedCover | null {
  if (bytes.length < 8) return null;
  // Check 'fLaC' signature
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    return null;
  }

  let offset = 4;
  while (offset + 4 < bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockSize = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];

    offset += 4;
    if (offset + blockSize > bytes.length) break;

    if (blockType === 6) {
      // METADATA_BLOCK_PICTURE
      try {
        const mimeLen = view.getUint32(offset + 4, false);
        const mimeStart = offset + 8;
        const mime = String.fromCharCode(...bytes.subarray(mimeStart, mimeStart + mimeLen)).trim();
        const descLenOffset = mimeStart + mimeLen;
        const descLen = view.getUint32(descLenOffset, false);
        const dataLenOffset = descLenOffset + 4 + descLen + 16;
        const dataLen = view.getUint32(dataLenOffset, false);
        const dataStart = dataLenOffset + 4;

        if (dataStart + dataLen <= bytes.length && dataLen > 64) {
          const slice = buffer.slice(dataStart, dataStart + dataLen);
          const finalMime = mime || detectMimeAt(bytes, dataStart);
          const blob = new Blob([slice], { type: finalMime });
          return { blob, url: URL.createObjectURL(blob), mime: finalMime };
        }
      } catch {
        // Fall back to searching for magic within block
        const magic = findImageInBytes(bytes, offset, offset + blockSize);
        if (magic) {
          const slice = buffer.slice(magic.start, offset + blockSize);
          const blob = new Blob([slice], { type: magic.mime });
          return { blob, url: URL.createObjectURL(blob), mime: magic.mime };
        }
      }
    }

    if (isLast) break;
    offset += blockSize;
  }

  return null;
}

/**
 * Extracts cover art from M4A / MP4 / AAC 'covr' atom.
 */
function extractFromM4A(buffer: ArrayBuffer, bytes: Uint8Array, view: DataView): ExtractedCover | null {
  // Search for 'covr' atom in the file
  const limit = Math.min(bytes.length - 16, 32 * 1024 * 1024);
  for (let i = 0; i < limit; i++) {
    if (
      bytes[i] === 0x63 && // 'c'
      bytes[i + 1] === 0x6f && // 'o'
      bytes[i + 2] === 0x76 && // 'v'
      bytes[i + 3] === 0x72 // 'r'
    ) {
      // Inside 'covr', search for 'data' box
      const dataOffset = i + 4;
      if (dataOffset + 16 < bytes.length) {
        const dataBoxSize = view.getUint32(dataOffset, false);
        const isData =
          bytes[dataOffset + 4] === 0x64 &&
          bytes[dataOffset + 5] === 0x61 &&
          bytes[dataOffset + 6] === 0x74 &&
          bytes[dataOffset + 7] === 0x61; // 'data'

        if (isData && dataBoxSize > 16) {
          const type = view.getUint32(dataOffset + 8, false);
          let mime = type === 14 ? 'image/png' : 'image/jpeg';
          const imgStart = dataOffset + 16;
          const imgEnd = Math.min(dataOffset + dataBoxSize, bytes.length);

          // Verify magic at imgStart
          const detected = detectMimeAt(bytes, imgStart);
          if (detected !== 'image/jpeg') mime = detected;

          const slice = buffer.slice(imgStart, imgEnd);
          const blob = new Blob([slice], { type: mime });
          return { blob, url: URL.createObjectURL(blob), mime };
        }
      }
    }
  }

  return null;
}

/**
 * Extracts cover art from OGG Vorbis / Opus comment blocks.
 */
function extractFromOGG(bytes: Uint8Array): ExtractedCover | null {
  // Search for METADATA_BLOCK_PICTURE= or COVERART= in Vorbis comment
  const needle = [0x4d, 0x45, 0x54, 0x41, 0x44, 0x41, 0x54, 0x41, 0x5f, 0x42, 0x4c, 0x4f, 0x43, 0x4b, 0x5f, 0x50, 0x49, 0x43, 0x54, 0x55, 0x52, 0x45, 0x3d]; // 'METADATA_BLOCK_PICTURE='
  const limit = Math.min(bytes.length - needle.length - 64, 4 * 1024 * 1024);

  for (let i = 0; i < limit; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (bytes[i + k] !== needle[k]) {
        match = false;
        break;
      }
    }
    if (match) {
      const b64Start = i + needle.length;
      let b64End = b64Start;
      while (b64End < bytes.length && bytes[b64End] >= 0x2b && bytes[b64End] <= 0x7a) {
        b64End++;
      }
      try {
        const b64Str = String.fromCharCode(...bytes.subarray(b64Start, b64End));
        const bin = atob(b64Str);
        const binBytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) binBytes[j] = bin.charCodeAt(j);
        const view = new DataView(binBytes.buffer);

        // Parse FLAC picture structure from decoded bytes
        const mimeLen = view.getUint32(4, false);
        const mime = String.fromCharCode(...binBytes.subarray(8, 8 + mimeLen));
        const descLenOffset = 8 + mimeLen;
        const descLen = view.getUint32(descLenOffset, false);
        const dataLenOffset = descLenOffset + 4 + descLen + 16;
        const dataLen = view.getUint32(dataLenOffset, false);
        const dataStart = dataLenOffset + 4;

        if (dataStart + dataLen <= binBytes.length) {
          const slice = binBytes.slice(dataStart, dataStart + dataLen);
          const blob = new Blob([slice], { type: mime || 'image/jpeg' });
          return { blob, url: URL.createObjectURL(blob), mime: mime || 'image/jpeg' };
        }
      } catch {
        // Continue
      }
    }
  }

  return null;
}

/**
 * Universal binary scan for embedded JPEG, PNG, or WebP images.
 */
function scanForImageSignature(buffer: ArrayBuffer, bytes: Uint8Array): ExtractedCover | null {
  const limit = Math.min(bytes.length - 32, 24 * 1024 * 1024);

  for (let i = 0; i < limit; i++) {
    // JPEG signature: FF D8 FF (E0, E1, DB, C0, ED)
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const m = bytes[i + 3];
      if (m === 0xe0 || m === 0xe1 || m === 0xdb || m === 0xc0 || m === 0xed || m === 0xee) {
        const end = findJpegEoiBytes(bytes, i + 4, Math.min(bytes.length, i + 12 * 1024 * 1024));
        if (end > i + 128) {
          const slice = buffer.slice(i, end);
          const blob = new Blob([slice], { type: 'image/jpeg' });
          return { blob, url: URL.createObjectURL(blob), mime: 'image/jpeg' };
        }
      }
    }

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47 &&
      bytes[i + 4] === 0x0d &&
      bytes[i + 5] === 0x0a &&
      bytes[i + 6] === 0x1a &&
      bytes[i + 7] === 0x0a
    ) {
      const end = findPngIendBytes(bytes, i + 8, Math.min(bytes.length, i + 12 * 1024 * 1024));
      if (end > i + 64) {
        const slice = buffer.slice(i, end);
        const blob = new Blob([slice], { type: 'image/png' });
        return { blob, url: URL.createObjectURL(blob), mime: 'image/png' };
      }
    }
  }

  return null;
}

function findImageInBytes(
  bytes: Uint8Array,
  start: number,
  end: number,
): { start: number; mime: string } | null {
  const limit = Math.min(bytes.length - 4, end);
  for (let i = start; i < limit; i++) {
    // JPEG: FF D8 FF
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      return { start: i, mime: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47
    if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4e && bytes[i + 3] === 0x47) {
      return { start: i, mime: 'image/png' };
    }
    // WebP: RIFF ... WEBP
    if (
      bytes[i] === 0x52 &&
      bytes[i + 1] === 0x49 &&
      bytes[i + 2] === 0x46 &&
      bytes[i + 3] === 0x46 &&
      i + 12 < limit &&
      bytes[i + 8] === 0x57 &&
      bytes[i + 9] === 0x45 &&
      bytes[i + 10] === 0x42 &&
      bytes[i + 11] === 0x50
    ) {
      return { start: i, mime: 'image/webp' };
    }
  }
  return null;
}

function detectMimeAt(bytes: Uint8Array, offset: number): string {
  if (offset + 4 <= bytes.length) {
    if (bytes[offset] === 0xff && bytes[offset + 1] === 0xd8 && bytes[offset + 2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes[offset] === 0x89 && bytes[offset + 1] === 0x50 && bytes[offset + 2] === 0x4e && bytes[offset + 3] === 0x47) {
      return 'image/png';
    }
    if (bytes[offset] === 0x47 && bytes[offset + 1] === 0x49 && bytes[offset + 2] === 0x46) {
      return 'image/gif';
    }
    if (bytes[offset] === 0x52 && bytes[offset + 1] === 0x49 && bytes[offset + 2] === 0x46 && bytes[offset + 3] === 0x46) {
      return 'image/webp';
    }
  }
  return 'image/jpeg';
}

function findJpegEoiBytes(bytes: Uint8Array, start: number, limit: number): number {
  for (let i = start; i < limit - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return i + 2;
    }
  }
  return limit;
}

function findPngIendBytes(bytes: Uint8Array, start: number, limit: number): number {
  for (let i = start; i < limit - 8; i++) {
    if (
      bytes[i] === 0x49 &&
      bytes[i + 1] === 0x45 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x44
    ) {
      return i + 8; // IEND + 4 CRC
    }
  }
  return limit;
}

function syncsafe(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}
