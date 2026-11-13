import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, LoadingScreen, QuantityStepper } from '../components/ui'
import { track } from '../lib/analytics'
import { callPublicFunction, getPublicCatalog } from '../lib/edge'
import { formatBRL, phoneDigits, whatsappLink } from '../lib/format'
import type { PublicCatalogResponse, SubmitOrderResponse } from '../lib/types'

export function Catalog() {
  const { slug } = useParams<{ slug: string }>()
  const [catalog, setCatalog] = useState<PublicCatalogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [note, setNote] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SubmitOrderResponse | null>(null)
  const requestId = useRef<string | null>(null)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    if (!slug) return
    let active = true
    setLoading(true)
    setLoadError(null)
    track('catalog_view')

    void getPublicCatalog<PublicCatalogResponse>(slug)
      .then((data) => {
        if (!active) return
        setCatalog(data)
        document.title = `${data.organization.name} — Catálogo`
      })
      .catch(() => {
        if (active) setLoadError('Não foi possível abrir este catálogo.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [slug])

  const selectedItems = useMemo(() => {
    if (!catalog) return []
    return catalog.products
      .filter((product) => (cart[product.id] ?? 0) > 0)
      .map((product) => ({ ...product, quantity: cart[product.id] ?? 0 }))
  }, [catalog, cart])

  const hasUnpriced = selectedItems.some((item) => item.price_cents === null)
  const totalCents = hasUnpriced
    ? null
    : selectedItems.reduce(
        (total, item) => total + (item.price_cents ?? 0) * item.quantity,
        0,
      )

  function setQuantity(productId: string, quantity: number) {
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[productId]
      else next[productId] = Math.min(999, quantity)
      return next
    })
  }

  function resetFlow() {
    setCart({})
    setSuccess(null)
    setBuyerName('')
    setBuyerPhone('')
    setNote('')
    setConsent(false)
    setSubmitError(null)
    requestId.current = null
    mountedAt.current = Date.now()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitError(null)

    if (!catalog || !slug) return
    if (!catalog.accepting_orders) {
      setSubmitError('Este catálogo não está aceitando pedidos no momento.')
      return
    }
    if (selectedItems.length === 0) {
      setSubmitError('Escolha pelo menos um produto e uma quantidade.')
      return
    }
    if (buyerName.trim().length < 2) {
      setSubmitError('Informe seu nome ou o nome da empresa.')
      return
    }
    if (phoneDigits(buyerPhone).length < 10) {
      setSubmitError('Informe um telefone válido com DDD.')
      return
    }
    if (!consent) {
      setSubmitError('É necessário aceitar o aviso de privacidade para enviar.')
      return
    }

    if (!requestId.current) requestId.current = crypto.randomUUID()

    setSubmitting(true)
    try {
      const result = await callPublicFunction<SubmitOrderResponse>('public-order', {
        slug,
        buyer_name: buyerName.trim(),
        buyer_phone: buyerPhone,
        note: note.trim() || null,
        items: selectedItems.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
        })),
        company_website: honeypot,
        elapsed_ms: Date.now() - mountedAt.current,
        consent,
        request_id: requestId.current,
      })
      setSuccess(result)
      track('order_submitted')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (submitFailure) {
      setSubmitError(
        submitFailure instanceof Error
          ? submitFailure.message
          : 'Não foi possível enviar o pedido.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingScreen label="Abrindo catálogo…" />

  if (loadError || !catalog) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
        </header>
        <main className="public-main">
          <div className="card centered-card">
            <span className="eyebrow">Catálogo</span>
            <h1>Catálogo indisponível</h1>
            <p>
              O link pode estar incorreto ou o fornecedor pode ter pausado o catálogo. Tente
              novamente mais tarde.
            </p>
            <Link to="/" className="button button-secondary">
              Voltar ao início
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const supplierWa = whatsappLink(
    catalog.organization.whatsapp,
    `Olá! Vi seu catálogo no PedeOutra.`,
  )

  if (success) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
          <span className="public-supplier">{catalog.organization.name}</span>
        </header>
        <main className="public-main">
          <div className="success-card">
            <div className="success-mark" aria-hidden="true">
              ✓
            </div>
            <span className="eyebrow">Pedido enviado</span>
            <h1>Recebemos seu pedido para análise</h1>
            <p>
              O fornecedor <strong>{catalog.organization.name}</strong> vai conferir os itens
              e confirmar. Este envio não é uma venda paga ou garantida.
            </p>
            <div className="success-summary">
              <div>
                <span>Referência</span>
                <strong>{success.public_reference}</strong>
              </div>
              <div>
                <span>Itens</span>
                <strong>{success.item_count}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatBRL(success.total_cents)}</strong>
              </div>
            </div>
            {supplierWa && (
              <a
                className="button button-whatsapp button-block"
                href={supplierWa}
                target="_blank"
                rel="noreferrer"
              >
                Falar com o fornecedor
              </a>
            )}
            <button type="button" className="button button-secondary button-block" onClick={resetFlow}>
              Fazer outro pedido
            </button>
            <p className="form-note">
              Guarde a referência. Ela não contém seus dados pessoais e serve para o
              fornecedor localizar o pedido.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const categories = catalog.categories ?? []
  const visibleProducts =
    activeCategory === 'all'
      ? catalog.products
      : catalog.products.filter((product) => product.category_id === activeCategory)

  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <div className="public-supplier">
          <strong>{catalog.organization.name}</strong>
          <span>{catalog.organization.city || 'Catálogo online'}</span>
        </div>
        {supplierWa && (
          <a className="button button-ghost" href={supplierWa} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
      </header>

      <main className="public-main">
        <section className="catalog-hero">
          <div>
            <span className="eyebrow">Catálogo de recompra</span>
            <h1>{catalog.organization.name}</h1>
            <p>
              Escolha os itens e as quantidades. O pedido vai para análise do fornecedor; não
              há pagamento nesta página.
            </p>
          </div>
          <span className="pill">Sem cadastro</span>
        </section>

        {!catalog.accepting_orders && (
          <FormMessage tone="info">
            Este catálogo está temporariamente sem receber pedidos. Você pode falar com o
            fornecedor pelo WhatsApp.
          </FormMessage>
        )}

        {categories.length > 0 && (
          <fieldset className="category-filter">
            <legend className="sr-only">Filtrar por categoria</legend>
            <button
              type="button"
              className="category-chip"
              aria-pressed={activeCategory === 'all'}
              onClick={() => setActiveCategory('all')}
            >
              Todos
            </button>
            {categories.map((category) => (
              <button
                type="button"
                className="category-chip"
                aria-pressed={activeCategory === category.id}
                onClick={() => setActiveCategory(category.id)}
                key={category.id}
              >
                {category.name}
              </button>
            ))}
          </fieldset>
        )}

        {visibleProducts.length === 0 ? (
          <div className="card centered-card">
            <h2>Nenhum produto publicado</h2>
            <p>
              {catalog.products.length === 0
                ? 'O fornecedor ainda não ativou itens neste catálogo.'
                : 'Nenhum item nesta categoria.'}
            </p>
          </div>
        ) : (
          <div className="catalog-layout">
            <section className="product-grid" aria-label="Produtos">
              {visibleProducts.map((product) => {
                const quantity = cart[product.id] ?? 0
                const cover = product.images?.[0]
                const imageUrl = cover?.thumb_url ?? cover?.url ?? null
                return (
                  <article
                    className={quantity > 0 ? 'product-card selected' : 'product-card'}
                    key={product.id}
                  >
                    {imageUrl ? (
                      <img
                        className="product-photo"
                        src={imageUrl}
                        alt={cover?.alt_text ?? product.name}
                        loading="lazy"
                      />
                    ) : (
                      <div className="product-photo product-photo-placeholder" aria-hidden="true">
                        {product.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="product-card-body">
                      <span className="product-unit">{product.unit}</span>
                      <h2>{product.name}</h2>
                      <strong className="product-price">{formatBRL(product.price_cents)}</strong>
                    </div>
                    {quantity === 0 ? (
                      <button
                        type="button"
                        className="button button-secondary button-block"
                        onClick={() => setQuantity(product.id, 1)}
                      >
                        Adicionar
                      </button>
                    ) : (
                      <QuantityStepper
                        value={quantity}
                        onChange={(next) => setQuantity(product.id, next)}
                        label={product.name}
                      />
                    )}
                  </article>
                )
              })}
            </section>

            <aside className="cart-panel">
              <div className="card">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">Seu pedido</span>
                    <h2>{selectedItems.length} item(ns)</h2>
                  </div>
                </div>

                {selectedItems.length === 0 ? (
                  <p className="muted">Adicione produtos para montar o pedido.</p>
                ) : (
                  <>
                    <ul className="cart-list">
                      {selectedItems.map((item) => (
                        <li key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            <small>
                              {item.quantity} × {formatBRL(item.price_cents)}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setQuantity(item.id, 0)}
                          >
                            Remover
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="cart-total">
                      <span>Total</span>
                      <strong>{formatBRL(totalCents)}</strong>
                    </div>
                    {hasUnpriced && (
                      <p className="form-note">
                        Há item sem preço definido. O fornecedor confirma o valor depois.
                      </p>
                    )}
                  </>
                )}

                <form className="form" onSubmit={handleSubmit}>
                  {submitError && <FormMessage>{submitError}</FormMessage>}
                  <label className="field">
                    <span>Seu nome ou empresa</span>
                    <input
                      required
                      maxLength={120}
                      value={buyerName}
                      onChange={(event) => setBuyerName(event.target.value)}
                      placeholder="Padaria Pão Bom"
                      autoComplete="organization"
                    />
                  </label>
                  <label className="field">
                    <span>Telefone comercial</span>
                    <input
                      required
                      inputMode="tel"
                      value={buyerPhone}
                      onChange={(event) => setBuyerPhone(event.target.value)}
                      placeholder="(11) 97777-6666"
                      autoComplete="tel"
                    />
                  </label>
                  <label className="field">
                    <span>Observação (opcional)</span>
                    <textarea
                      maxLength={500}
                      rows={3}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Horário de entrega, ponto de referência…"
                    />
                  </label>
                  <label className="honeypot" aria-hidden="true">
                    <span>Não preencher</span>
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={honeypot}
                      onChange={(event) => setHoneypot(event.target.value)}
                    />
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      Autorizo o fornecedor a usar meus dados de contato para responder a este
                      pedido, conforme o <Link to="/privacidade">aviso de privacidade</Link>.
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="button button-primary button-block button-large"
                    disabled={submitting || !catalog.accepting_orders}
                  >
                    {submitting ? 'Enviando pedido…' : 'Enviar pedido para análise'}
                  </button>
                  <p className="form-note">
                    Você não paga nada agora. O fornecedor confirma itens, disponibilidade e
                    valores.
                  </p>
                </form>
              </div>
            </aside>
          </div>
        )}
      </main>

      <footer className="public-footer">
        <span>
          Catálogo operado por {catalog.organization.name} com tecnologia PedeOutra.
        </span>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </footer>
    </div>
  )
}
