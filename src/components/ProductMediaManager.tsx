import { useEffect, useRef, useState, type FormEvent } from 'react'
import { callAuthedForm, callAuthedFunction, callAuthedGet } from '../lib/edge'
import { prepareImage } from '../lib/images'
import type { Product } from '../lib/types'
import { FormMessage } from './ui'

interface ProductImageItem {
  id: string
  product_id: string
  alt_text: string
  position: number
  is_cover: boolean
  url: string | null
  thumb_url: string | null
}

export function ProductMediaManager({ products }: { readonly products: Product[] }) {
  const [images, setImages] = useState<ProductImageItem[]>([])
  const [productId, setProductId] = useState('')
  const [altText, setAltText] = useState('')
  const [isCover, setIsCover] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function loadImages() {
    try {
      const data = await callAuthedGet<{ images: ProductImageItem[] }>('product-image-list')
      setImages(data.images ?? [])
    } catch {
      setError('Não foi possível carregar as imagens agora.')
    }
  }

  useEffect(() => {
    void loadImages()
  }, [])

  useEffect(() => {
    if (!productId && products.length > 0) setProductId(products[0].id)
  }, [productId, products])

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file || !productId) {
      setError('Escolha um produto e uma imagem.')
      return
    }
    if (altText.trim().length < 3) {
      setError('Descreva a imagem em pelo menos 3 caracteres.')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const prepared = await prepareImage(file)
      const data = new FormData()
      data.append('product_id', productId)
      data.append('alt_text', altText.trim())
      data.append('is_cover', String(isCover))
      data.append('image', prepared.image, 'image.webp')
      data.append('thumb', prepared.thumb, 'thumb.webp')
      await callAuthedForm('product-image-upload', data)
      setSuccess('Foto enviada.')
      setAltText('')
      setIsCover(false)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      await loadImages()
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Não foi possível enviar a imagem.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove(image: ProductImageItem) {
    if (!window.confirm('Excluir esta foto? A ação remove o arquivo do catálogo.')) return
    setBusy(true)
    setError(null)
    try {
      await callAuthedFunction('product-image-delete', { image_id: image.id })
      setSuccess('Foto removida.')
      await loadImages()
    } catch {
      setError('Não foi possível remover a foto.')
    } finally {
      setBusy(false)
    }
  }

  async function makeCover(image: ProductImageItem) {
    setBusy(true)
    setError(null)
    try {
      await callAuthedFunction('product-image-cover', { image_id: image.id })
      setSuccess('Foto de capa atualizada.')
      await loadImages()
    } catch {
      setError('Não foi possível definir a capa.')
    } finally {
      setBusy(false)
    }
  }

  const selected = images.filter((image) => image.product_id === productId)

  return (
    <section className="card media-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Fotos do produto</span>
          <h2>Imagens do catálogo</h2>
        </div>
        <span className="muted">até 8 por produto</span>
      </div>
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}
      <form className="form" onSubmit={(event) => void upload(event)}>
        <label className="field">
          <span>Produto</span>
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            {products.map((product) => (
              <option value={product.id} key={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label className="field">
            <span>Arquivo (JPEG, PNG ou WebP)</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>Texto alternativo</span>
            <input
              maxLength={160}
              value={altText}
              onChange={(event) => setAltText(event.target.value)}
              placeholder="Copo de água sobre a mesa"
            />
          </label>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={isCover}
            onChange={(event) => setIsCover(event.target.checked)}
          />
          <span>Usar como foto de capa</span>
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || !products.length}
        >
          {busy ? 'Processando…' : 'Enviar foto'}
        </button>
      </form>

      <div className="image-grid">
        {selected.map((image) => (
          <figure className="image-tile" key={image.id}>
            {image.thumb_url || image.url ? (
              <img
                src={image.thumb_url ?? image.url ?? ''}
                alt={image.alt_text}
                loading="lazy"
              />
            ) : (
              <div className="image-missing">Sem preview</div>
            )}
            <figcaption>
              <span>{image.alt_text}</span>
              {image.is_cover && <span className="pill pill-lime">Capa</span>}
              <div className="image-actions">
                {!image.is_cover && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void makeCover(image)}
                    disabled={busy}
                  >
                    Usar como capa
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void remove(image)}
                  disabled={busy}
                >
                  Excluir
                </button>
              </div>
            </figcaption>
          </figure>
        ))}
        {selected.length === 0 && <p className="muted">Nenhuma foto para este produto.</p>}
      </div>
      <p className="form-note">
        O arquivo é reencodado no navegador, validado por magic bytes na Edge Function e
        guardado em bucket privado. SVG e arquivos acima de 5 MB são recusados.
      </p>
    </section>
  )
}
