import { useMemo, useState } from 'react'
import {
  catalogQrUrl,
  createCatalogQrSvg,
  downloadBlob,
  printCatalogQr,
  qrPngBlob,
  qrSvgDataUri,
} from '../lib/qr'
import { FormMessage } from './ui'

const SIZES = [256, 512, 1024]

export function CatalogQrPanel({
  slug,
  organizationName,
}: {
  readonly slug: string
  readonly organizationName: string
}) {
  const [size, setSize] = useState(512)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const url = useMemo(() => catalogQrUrl(slug), [slug])
  const svg = useMemo(() => createCatalogQrSvg(url, size), [url, size])
  const dataUri = useMemo(() => qrSvgDataUri(svg), [svg])

  async function copyLink() {
    setError(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable')
      await navigator.clipboard.writeText(url)
      setFeedback('Link copiado.')
    } catch {
      setFeedback('Não foi possível copiar automaticamente. Selecione o link abaixo.')
    }
  }

  function downloadSvg() {
    setError(null)
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `qr-catalogo-${slug}.svg`,
    )
    setFeedback('SVG baixado.')
  }

  async function downloadPng() {
    setBusy(true)
    setError(null)
    try {
      const blob = await qrPngBlob(url, size)
      downloadBlob(blob, `qr-catalogo-${slug}.png`)
      setFeedback('PNG baixado.')
    } catch {
      setError('Não foi possível gerar o PNG neste navegador.')
    } finally {
      setBusy(false)
    }
  }

  function print() {
    setError(null)
    try {
      printCatalogQr(url, organizationName, svg)
    } catch (printError) {
      setError(
        printError instanceof Error
          ? printError.message
          : 'Não foi possível abrir a impressão.',
      )
    }
  }

  return (
    <section className="card qr-panel">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Compartilhar</span>
          <h2>QR Code do catálogo</h2>
        </div>
        <label className="field qr-size">
          <span>Tamanho</span>
          <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
            {SIZES.map((option) => (
              <option value={option} key={option}>
                {option} px
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="qr-layout">
        <img
          className="qr-image"
          src={dataUri}
          alt={`QR Code do catálogo de ${organizationName}`}
          width={240}
          height={240}
        />
        <div className="qr-copy">
          <p>
            Aponte a câmera para abrir o catálogo público. O QR não dá acesso à conta, não é
            credencial e não contém dados de clientes.
          </p>
          <code className="qr-url">{url}</code>
          <div className="qr-actions">
            <button type="button" className="button button-secondary" onClick={() => void copyLink()}>
              Copiar link
            </button>
            <button type="button" className="button button-secondary" onClick={downloadSvg}>
              Baixar SVG
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void downloadPng()}
              disabled={busy}
            >
              {busy ? 'Gerando…' : 'Baixar PNG'}
            </button>
            <button type="button" className="button button-secondary" onClick={print}>
              Imprimir
            </button>
          </div>
          {feedback && <output className="qr-feedback">{feedback}</output>}
          {error && <FormMessage>{error}</FormMessage>}
        </div>
      </div>
    </section>
  )
}
