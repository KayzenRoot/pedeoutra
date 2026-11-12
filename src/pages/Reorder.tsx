import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, LoadingScreen, QuantityStepper } from '../components/ui'
import { track } from '../lib/analytics'
import { EdgeFunctionError, callPublicFunction } from '../lib/edge'
import { formatBRL, whatsappLink } from '../lib/format'
import type { ReorderGetResponse, SubmitOrderResponse } from '../lib/types'

export function Reorder() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ReorderGetResponse | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ message: string; catalogUrl?: string } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<SubmitOrderResponse | null>(null)
  const requestId = useRef<string | null>(null)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => {
      meta.remove()
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setLoadError({ message: 'Link inválido.' })
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    track('reorder_view')

    void callPublicFunction<ReorderGetResponse>('reorder-get', { token })
      .then((response) => {
        if (!active) return
        setData(response)
        const initial: Record<string, number> = {}
        for (const item of response.items) initial[item.product_id] = item.quantity
        setCart(initial)
        document.title = `Repetir pedido — ${response.supplier.name}`
      })
      .catch((error: unknown) => {
        if (!active) return
        const catalogUrl =
          error instanceof EdgeFunctionError &&
          typeof error.details.catalog_url === 'string'
            ? error.details.catalog_url
            : undefined
        setLoadError({
          message:
            error instanceof Error
              ? error.message
              : 'Este link não está mais disponível.',
          catalogUrl,
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [token])

  const selectedItems = useMemo(() => {
    if (!data) return []
    return data.items
      .filter((item) => (cart[item.product_id] ?? 0) > 0)
      .map((item) => ({ ...item, quantity: cart[item.product_id] ?? 0 }))
  }, [data, cart])

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitError(null)

    if (!token || !data) return
    if (!data.accepting_orders) {
      setSubmitError('O fornecedor não está aceitando pedidos no momento.')
      return
    }
    if (selectedItems.length === 0) {
      setSubmitError('Mantenha pelo menos um item para enviar.')
      return
    }

    if (!requestId.current) requestId.current = crypto.randomUUID()

    setSubmitting(true)
    try {
      const result = await callPublicFunction<SubmitOrderResponse>('reorder-submit', {
        token,
        items: selectedItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
        })),
        company_website: '',
        elapsed_ms: Date.now() - mountedAt.current,
        request_id: requestId.current,
      })
      setSuccess(result)
      track('reorder_submitted')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'Não foi possível enviar o pedido.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingScreen label="Abrindo link de recompra…" />

  if (loadError || !data) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
        </header>
        <main className="public-main">
          <div className="card centered-card">
            <span className="eyebrow">Link de recompra</span>
            <h1>Este link não está mais disponível</h1>
            <p>
              Ele pode ter expirado ou sido revogado pelo fornecedor. Nenhum dado pessoal é
              exibido aqui. Peça um novo link ou abra o catálogo.
            </p>
            <div className="centered-actions">
              {loadError?.catalogUrl && (
                <a className="button button-primary" href={loadError.catalogUrl}>
                  Abrir catálogo
                </a>
              )}
              <Link to="/" className="button button-secondary">
                Ir para o início
              </Link>
            </div>
          </div>
        </main>
      </div>
    )
  }

  const supplierWa = whatsappLink(
    data.supplier.whatsapp,
    'Olá! Estou usando o link de recompra do PedeOutra.',
  )

  if (success) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
          <span className="public-supplier">{data.supplier.name}</span>
        </header>
        <main className="public-main">
          <div className="success-card">
            <div className="success-mark" aria-hidden="true">
              ✓
            </div>
            <span className="eyebrow">Pedido reenviado</span>
            <h1>Pedido enviado para análise</h1>
            <p>
              O fornecedor <strong>{data.supplier.name}</strong> vai conferir os itens e
              confirmar. Repetir não gera compra paga nem entrega automática.
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
            <a className="button button-secondary button-block" href={data.catalog_url}>
              Abrir catálogo completo
            </a>
            <p className="form-note">Guarde a referência para acompanhar com o fornecedor.</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <div className="public-supplier">
          <strong>{data.supplier.name}</strong>
          <span>{data.supplier.city || 'Recompra'}</span>
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
            <span className="eyebrow">Pedir outra vez</span>
            <h1>Repita seu pedido anterior</h1>
            <p>
              Ajuste as quantidades e envie. O fornecedor confirma os itens, os valores atuais
              e a disponibilidade.
            </p>
          </div>
          <span className="pill pill-lime">Link pessoal</span>
        </section>

        {!data.accepting_orders && (
          <FormMessage tone="info">
            O fornecedor está temporariamente sem receber pedidos. Você pode falar pelo
            WhatsApp.
          </FormMessage>
        )}

        {data.items.length === 0 ? (
          <div className="card centered-card">
            <h2>Itens indisponíveis</h2>
            <p>Os produtos desta sugestão não estão mais ativos no catálogo.</p>
            <a className="button button-primary" href={data.catalog_url}>
              Abrir catálogo atualizado
            </a>
          </div>
        ) : (
          <form className="reorder-layout" onSubmit={handleSubmit}>
            <section className="reorder-items">
              {data.items.map((item) => {
                const quantity = cart[item.product_id] ?? 0
                return (
                  <article
                    className={quantity > 0 ? 'product-card selected' : 'product-card'}
                    key={item.product_id}
                  >
                    <div className="product-card-body">
                      <span className="product-unit">{item.unit}</span>
                      <h2>{item.name}</h2>
                      <strong className="product-price">{formatBRL(item.price_cents)}</strong>
                    </div>
                    {quantity === 0 ? (
                      <button
                        type="button"
                        className="button button-secondary button-block"
                        onClick={() => setQuantity(item.product_id, 1)}
                      >
                        Incluir novamente
                      </button>
                    ) : (
                      <QuantityStepper
                        value={quantity}
                        onChange={(next) => setQuantity(item.product_id, next)}
                        label={item.name}
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
                    <span className="eyebrow">Sua sugestão</span>
                    <h2>{selectedItems.length} item(ns)</h2>
                  </div>
                </div>

                <ul className="cart-list">
                  {selectedItems.map((item) => (
                    <li key={item.product_id}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.quantity} × {formatBRL(item.price_cents)}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setQuantity(item.product_id, 0)}
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="cart-total">
                  <span>Total atual</span>
                  <strong>{formatBRL(totalCents)}</strong>
                </div>
                {hasUnpriced && (
                  <p className="form-note">
                    Há item sem preço definido. O fornecedor confirma o valor depois.
                  </p>
                )}

                {submitError && <FormMessage>{submitError}</FormMessage>}

                <button
                  type="submit"
                  className="button button-primary button-block button-large"
                  disabled={submitting || !data.accepting_orders || selectedItems.length === 0}
                >
                  {submitting ? 'Enviando…' : 'Enviar pedido para análise'}
                </button>
                <p className="form-note">
                  Este link é opaco: não mostra nome, telefone, histórico ou dados de outros
                  clientes. Você pode ajustar ou remover itens.
                </p>
                <a className="text-link" href={data.catalog_url}>
                  Ver catálogo completo →
                </a>
              </div>
            </aside>
          </form>
        )}
      </main>

      <footer className="public-footer">
        <span>Recompra segura com tecnologia PedeOutra.</span>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </footer>
    </div>
  )
}
