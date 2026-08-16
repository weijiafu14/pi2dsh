// Image dimensions read straight from the file header, for the four inline
// formats Pi accepts. Pi gets these from its resize worker; this bridge does
// not resize, but the caller is still owed the real numbers — Pi's
// `ResizedImage` contract has four dimension fields, and inventing zeros
// there would be a lie a package cannot detect.
//
// Header offsets only: no decoding, no dependency.

/** Width and height in pixels, or undefined when the header is not one we can read. */
export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Read the pixel dimensions out of an image header.
 * @param bytes - the complete image file.
 * @param mimeType - the declared type, used to pick the header layout.
 * @returns the dimensions, or undefined when the header is absent or malformed.
 */
export function readImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | undefined {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'image/png') return pngDimensions(bytes)
  if (type === 'image/jpeg') return jpegDimensions(bytes)
  if (type === 'image/gif') return gifDimensions(bytes)
  if (type === 'image/webp') return webpDimensions(bytes)
  return undefined
}

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** PNG: an 8-byte signature, then an IHDR chunk whose first two fields are the size. */
function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return undefined
  const data = view(bytes)
  return { width: data.getUint32(16, false), height: data.getUint32(20, false) }
}

/** GIF: dimensions sit at a fixed offset, little-endian. */
function gifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10) return undefined
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return undefined
  const data = view(bytes)
  return { width: data.getUint16(6, true), height: data.getUint16(8, true) }
}

/**
 * JPEG: walk the marker segments to the frame header (SOF0…SOF15, skipping
 * the four that are not frames), which carries the size.
 */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return undefined
  const data = view(bytes)
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) { offset += 1; continue }
    const marker = bytes[offset + 1] ?? 0
    // Standalone markers carry no length payload.
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { offset += 2; continue }
    const length = data.getUint16(offset + 2, false)
    const isFrame = marker >= 0xC0 && marker <= 0xCF
      && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    if (isFrame) return { height: data.getUint16(offset + 5, false), width: data.getUint16(offset + 7, false) }
    if (length < 2) return undefined
    offset += 2 + length
  }
  return undefined
}

/** WebP: three container variants (lossy, lossless, extended), each with its own size layout. */
function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined
  const tag = String.fromCharCode(...bytes.slice(0, 4)) + String.fromCharCode(...bytes.slice(8, 12))
  if (tag !== 'RIFFWEBP') return undefined
  const data = view(bytes)
  const format = String.fromCharCode(...bytes.slice(12, 16))
  if (format === 'VP8 ') {
    return { width: data.getUint16(26, true) & 0x3FFF, height: data.getUint16(28, true) & 0x3FFF }
  }
  if (format === 'VP8L') {
    const bits = data.getUint32(21, true)
    return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 }
  }
  if (format === 'VP8X') {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16))
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
    return { width, height }
  }
  return undefined
}
