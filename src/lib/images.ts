const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SOURCE_BYTES = 10 * 1024 * 1024

export interface PreparedImage {
  image: Blob
  thumb: Blob
  width: number
  height: number
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('image_encode_failed'))
      },
      type,
      quality,
    )
  })
}

async function encode(
  bitmap: ImageBitmap,
  maxSize: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas_unavailable')
  context.drawImage(bitmap, 0, 0, width, height)

  let blob: Blob
  try {
    blob = await canvasBlob(canvas, 'image/webp', 0.86)
  } catch {
    blob = await canvasBlob(canvas, 'image/jpeg', 0.86)
  }
  return { blob, width, height }
}

/** Redimensiona e reencoda a imagem no navegador antes do upload. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Envie uma imagem JPEG, PNG ou WebP.')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('A imagem original deve ter no máximo 10 MB.')
  }
  if (typeof createImageBitmap !== 'function') {
    throw new TypeError('Seu navegador não consegue processar a imagem. Use outro navegador.')
  }

  const bitmap = await createImageBitmap(file)
  try {
    const full = await encode(bitmap, 1600)
    const thumb = await encode(bitmap, 480)
    return {
      image: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
    }
  } finally {
    bitmap.close()
  }
}
