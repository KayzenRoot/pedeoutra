export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_THUMB_BYTES = 1024 * 1024
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type ImageMime = (typeof ALLOWED_IMAGE_MIMES)[number]

export type ImageValidation =
  | { ok: true; mime: ImageMime; extension: 'jpg' | 'png' | 'webp' }
  | {
      ok: false
      reason: 'empty' | 'too_large' | 'unsupported_type' | 'mime_mismatch'
    }

export function isAllowedImageMime(value: unknown): value is ImageMime {
  return (
    typeof value === 'string' &&
    (ALLOWED_IMAGE_MIMES as readonly string[]).includes(value)
  )
}

export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

export function extensionForMime(mime: ImageMime): 'jpg' | 'png' | 'webp' {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

export function validateImageBytes(
  bytes: Uint8Array,
  declaredType: string,
  maxBytes: number = MAX_IMAGE_BYTES,
): ImageValidation {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' }
  if (!isAllowedImageMime(declaredType)) {
    return { ok: false, reason: 'unsupported_type' }
  }

  const detected = detectImageMime(bytes)
  if (!detected) return { ok: false, reason: 'unsupported_type' }
  if (detected !== declaredType) return { ok: false, reason: 'mime_mismatch' }

  return { ok: true, mime: detected, extension: extensionForMime(detected) }
}

export function validateAltText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (normalized.length < 3 || normalized.length > 160) return null
  return normalized
}
