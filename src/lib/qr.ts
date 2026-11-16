import qrcode from 'qrcode-generator'

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

function isValidSlug(slug: string): boolean {
  if (slug.length < 1 || slug.length > 120) return false
  return slug.split('-').every((part) => /^[a-z0-9]+$/.test(part))
}

export function catalogQrUrl(slug: string, origin?: string): string {
  if (!isValidSlug(slug)) throw new Error('Slug de catálogo inválido.')

  const base =
    (origin ? stripTrailingSlashes(origin) : '') ||
    (import.meta.env.VITE_APP_URL
      ? stripTrailingSlashes(import.meta.env.VITE_APP_URL as string)
      : '') ||
    window.location.origin
  const url = new URL(`${base}/c/${slug}`)

  if (url.username || url.password) throw new Error('URL de catálogo inválida.')
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(url.hostname)
  ) {
    throw new Error('O QR Code exige HTTPS em produção.')
  }
  if (!url.pathname.startsWith('/c/')) throw new Error('URL de catálogo inválida.')

  return url.toString()
}

export function createCatalogQrSvg(url: string, size = 256, margin = 4): string {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL do QR inválida.')
  }
  if (!parsed.pathname.startsWith('/c/')) throw new Error('URL do catálogo inválida.')

  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()

  const count = qr.getModuleCount()
  const total = count + margin * 2
  const cell = size / total
  let modules = ''
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!qr.isDark(row, column)) continue
      modules += `<rect x="${(column + margin) * cell}" y="${(row + margin) * cell}" width="${cell}" height="${cell}"/>`
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<g fill="#000000" shape-rendering="crispEdges">${modules}</g>`,
    '</svg>',
  ].join('')
}

export function qrSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export async function qrPngBlob(
  url: string,
  size = 512,
  margin = 4,
): Promise<Blob> {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL do QR inválida.')
  }
  if (!parsed.pathname.startsWith('/c/')) throw new Error('URL do catálogo inválida.')

  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const count = qr.getModuleCount()
  const total = count + margin * 2
  const cell = size / total

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  context.fillStyle = '#000000'
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) {
        context.fillRect(
          Math.floor((column + margin) * cell),
          Math.floor((row + margin) * cell),
          Math.ceil(cell),
          Math.ceil(cell),
        )
      }
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG indisponível.'))),
      'image/png',
    )
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function printCatalogQr(
  url: string,
  organizationName: string,
  svg: string,
): void {
  const printWindow = window.open('', '_blank')
  if (!printWindow) throw new Error('Permita pop-ups para imprimir o QR Code.')
  printWindow.opener = null

  const documentRef = printWindow.document
  documentRef.title = `QR Code — ${organizationName}`
  const style = documentRef.createElement('style')
  style.textContent =
    'body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#111}h1{font-size:20px}img{width:320px;height:320px}p{word-break:break-all;font-size:13px}'
  documentRef.head.append(style)

  const heading = documentRef.createElement('h1')
  heading.textContent = organizationName
  const image = documentRef.createElement('img')
  image.src = qrSvgDataUri(svg)
  image.alt = `QR Code do catálogo de ${organizationName}`
  const text = documentRef.createElement('p')
  text.textContent = url
  documentRef.body.append(heading, image, text)
  printWindow.focus()
  printWindow.print()
}
