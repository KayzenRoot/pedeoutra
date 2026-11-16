import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { organizationAccess } from '../lib/access'
import { callAuthedFunction } from '../lib/edge'
import { formatBRL, formatDateTime } from '../lib/format'
import { supabase } from '../lib/supabase'
import type {
  Customer,
  Product,
  Quote,
  QuoteCreateResponse,
  QuoteEvent,
  QuoteItem,
  QuoteSendResponse,
  QuoteUpdateResponse,
} from '../lib/types'
import {
  CopyButton,
  EmptyState,
  FormMessage,
  PageHeader,
} from '../components/ui'

interface DraftItem {
  productId: string
  quantity: number
}

const STATUS_TEXT: Record<string, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  accepted: 'Aceito',
  declined: 'Recusado',
  expired: 'Expirado',
  canceled: 'Cancelado',
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'badge-muted',
  sent: 'badge-confirmed',
  accepted: 'badge-success',
  declined: 'badge-muted',
  expired: 'badge-muted',
  canceled: 'badge-muted',
}

function defaultValidity(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function toIsoDate(value: string): string {
  return new Date(`${value}T23:59:59`).toISOString()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

function effectiveStatus(quote: Quote): string {
  if (quote.status === 'sent' && Date.parse(quote.valid_until) <= Date.now()) {
    return 'expired'
  }
  return quote.status
}

export function Quotes() {
  const { organization, subscription } = useAuth()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([])
  const [quoteEvents, setQuoteEvents] = useState<QuoteEvent[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, QuoteSendResponse>>({})

  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [productToAdd, setProductToAdd] = useState('')
  const [quantityToAdd, setQuantityToAdd] = useState('1')
  const [validUntil, setValidUntil] = useState(defaultValidity)
  const [notes, setNotes] = useState('')

  const organizationId = organization?.id
  const isProfessional = subscription?.plan_code === 'professional'
  const access = organizationAccess(organization, subscription)
  const canManage = isProfessional && access.canWrite

  async function loadData() {
    if (!supabase || !organizationId) return
    setLoading(true)
    setLoadError(null)
    const [quotesResult, itemsResult, eventsResult, customersResult, productsResult] =
      await Promise.all([
        supabase
          .from('quotes')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('quote_items')
          .select('*')
          .eq('organization_id', organizationId),
        supabase
          .from('quote_events')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: true }),
        supabase
          .from('customers')
          .select('*')
          .eq('organization_id', organizationId)
          .order('display_name', { ascending: true }),
        supabase
          .from('products')
          .select('*')
          .eq('organization_id', organizationId)
          .order('name', { ascending: true }),
      ])

    if (
      quotesResult.error ||
      itemsResult.error ||
      eventsResult.error ||
      customersResult.error ||
      productsResult.error
    ) {
      setLoadError('Não foi possível carregar os orçamentos.')
    } else {
      setQuotes(quotesResult.data ?? [])
      setQuoteItems(itemsResult.data ?? [])
      setQuoteEvents(eventsResult.data ?? [])
      setCustomers(customersResult.data ?? [])
      setProducts(productsResult.data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!isProfessional || !organizationId) {
      setLoading(false)
      return
    }
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProfessional, organizationId])

  const customerName = (id: string) =>
    customers.find((customer) => customer.id === id)?.display_name ?? 'Cliente'
  const productById = useMemo(() => {
    const map = new Map<string, Product>()
    for (const product of products) map.set(product.id, product)
    return map
  }, [products])
  const itemsByQuote = useMemo(() => {
    const map = new Map<string, QuoteItem[]>()
    for (const item of quoteItems) {
      const list = map.get(item.quote_id) ?? []
      list.push(item)
      map.set(item.quote_id, list)
    }
    return map
  }, [quoteItems])
  const eventsByQuote = useMemo(() => {
    const map = new Map<string, QuoteEvent[]>()
    for (const event of quoteEvents) {
      const list = map.get(event.quote_id) ?? []
      list.push(event)
      map.set(event.quote_id, list)
    }
    return map
  }, [quoteEvents])

  const selectedQuote = quotes.find((quote) => quote.id === selectedQuoteId) ?? null
  const selectedDraftProducts = draftItems
    .map((item) => {
      const product = productById.get(item.productId)
      return product ? { ...item, product } : null
    })
    .filter((item): item is DraftItem & { product: Product } => item !== null)
  const previewTotal = selectedDraftProducts.reduce(
    (total, item) => total + (item.product.price_cents ?? 0) * item.quantity,
    0,
  )
  const previewUnpriced = selectedDraftProducts.some(
    (item) => item.product.price_cents === null,
  )
  let saveLabel = 'Criar orçamento'
  if (busy === 'save') saveLabel = 'Salvando…'
  else if (editing) saveLabel = 'Salvar rascunho'

  function resetForm() {
    setEditing(null)
    setCustomerId('')
    setDraftItems([])
    setProductToAdd('')
    setQuantityToAdd('1')
    setValidUntil(defaultValidity())
    setNotes('')
  }

  function startEdit(quote: Quote) {
    if (quote.status !== 'draft') return
    setEditing({ id: quote.id, version: quote.version })
    setCustomerId(quote.customer_id)
    setDraftItems(
      (itemsByQuote.get(quote.id) ?? [])
        .filter((item) => item.product_id)
        .map((item) => ({ productId: item.product_id as string, quantity: item.quantity })),
    )
    setValidUntil(quote.valid_until.slice(0, 10))
    setNotes(quote.notes ?? '')
    setError(null)
    setSuccess(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startRevision(quote: Quote) {
    setEditing(null)
    setCustomerId(quote.customer_id)
    setDraftItems(
      (itemsByQuote.get(quote.id) ?? [])
        .filter((item) => item.product_id)
        .map((item) => ({ productId: item.product_id as string, quantity: item.quantity })),
    )
    setValidUntil(defaultValidity())
    setNotes(quote.notes ?? '')
    setError(null)
    setSuccess(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function addItem() {
    setError(null)
    const product = productById.get(productToAdd)
    if (!product) {
      setError('Selecione um produto.')
      return
    }
    const quantity = Number(quantityToAdd)
    if (!Number.isInteger(quantity) || quantity < product.min_quantity) {
      setError(`A quantidade mínima deste item é ${product.min_quantity}.`)
      return
    }
    if (quantity % product.quantity_increment !== 0) {
      setError(`A quantidade deve ser múltipla de ${product.quantity_increment}.`)
      return
    }
    setDraftItems((current) => {
      if (current.some((item) => item.productId === product.id)) {
        return current.map((item) =>
          item.productId === product.id ? { ...item, quantity } : item,
        )
      }
      return [...current, { productId: product.id, quantity }]
    })
    setProductToAdd('')
    setQuantityToAdd('1')
  }

  function removeItem(productId: string) {
    setDraftItems((current) => current.filter((item) => item.productId !== productId))
  }

  async function submitQuote(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    if (!canManage) return
    if (!customerId) {
      setError('Selecione o cliente do orçamento.')
      return
    }
    if (draftItems.length === 0) {
      setError('Adicione pelo menos um item.')
      return
    }
    if (!validUntil) {
      setError('Informe a validade do orçamento.')
      return
    }

    setBusy('save')
    try {
      const payload = {
        items: draftItems.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
        })),
        valid_until: toIsoDate(validUntil),
        notes: notes.trim() || null,
      }
      if (editing) {
        const result = await callAuthedFunction<QuoteUpdateResponse>('quote-update', {
          quote_id: editing.id,
          expected_version: editing.version,
          ...payload,
        })
        setSuccess(`Orçamento atualizado: ${formatBRL(result.total_cents)}.`)
      } else {
        const result = await callAuthedFunction<QuoteCreateResponse>('quote-create', {
          customer_id: customerId,
          ...payload,
        })
        setSuccess(`Orçamento ${result.public_reference} criado: ${formatBRL(result.total_cents)}.`)
      }
      resetForm()
      await loadData()
    } catch (submitError) {
      setError(errorMessage(submitError))
    } finally {
      setBusy(null)
    }
  }

  async function sendQuote(quote: Quote) {
    setBusy(`send-${quote.id}`)
    setError(null)
    setSuccess(null)
    try {
      const link = await callAuthedFunction<QuoteSendResponse>('quote-send', {
        quote_id: quote.id,
        expected_version: quote.version,
      })
      setLinks((current) => ({ ...current, [quote.id]: link }))
      setSuccess(`Link do orçamento ${quote.public_reference} gerado.`)
      await loadData()
    } catch (sendError) {
      setError(errorMessage(sendError))
    } finally {
      setBusy(null)
    }
  }

  async function cancelQuote(quote: Quote) {
    if (!window.confirm(`Cancelar o orçamento ${quote.public_reference}? O link deixa de valer.`)) {
      return
    }
    setBusy(`cancel-${quote.id}`)
    setError(null)
    setSuccess(null)
    try {
      await callAuthedFunction('quote-cancel', {
        quote_id: quote.id,
        expected_version: quote.version,
      })
      setSuccess(`Orçamento ${quote.public_reference} cancelado.`)
      await loadData()
    } catch (cancelError) {
      setError(errorMessage(cancelError))
    } finally {
      setBusy(null)
    }
  }

  function renderActions(quote: Quote) {
    const status = effectiveStatus(quote)
    if (status === 'draft') {
      return (
        <>
          <button type="button" className="text-button" onClick={() => startEdit(quote)}>
            Editar
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!canManage || busy === `send-${quote.id}`}
            onClick={() => void sendQuote(quote)}
          >
            Enviar
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy === `cancel-${quote.id}`}
            onClick={() => void cancelQuote(quote)}
          >
            Cancelar
          </button>
        </>
      )
    }
    if (status === 'sent') {
      return (
        <>
          <button
            type="button"
            className="text-button"
            disabled={!canManage || busy === `send-${quote.id}`}
            onClick={() => void sendQuote(quote)}
          >
            Novo link
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy === `cancel-${quote.id}`}
            onClick={() => void cancelQuote(quote)}
          >
            Cancelar
          </button>
        </>
      )
    }
    return (
      <button type="button" className="text-button" onClick={() => startRevision(quote)}>
        Revisar
      </button>
    )
  }

  function quotesListState() {
    if (loading) return <p className="muted">Carregando orçamentos…</p>
    if (quotes.length === 0) {
      return (
        <EmptyState
          title="Nenhum orçamento ainda"
          description="Monte a primeira proposta ao lado e envie um link privado ao cliente."
        />
      )
    }
    return null
  }

  if (!isProfessional) {
    return (
      <div>
        <PageHeader
          eyebrow="Comercial"
          title="Orçamentos"
          description="Propostas com preço congelado, validade e aceite por link opaco — sem login do comprador."
        />
        <section className="card centered-card">
          <span className="eyebrow">Plano Profissional</span>
          <h2>Orçamentos com aceite seguro</h2>
          <p>
            Monte a proposta com os preços do cliente, envie um link privado e converta o
            aceite em um único pedido, com trilha de auditoria.
          </p>
          <Link to="/app/assinatura" className="button button-primary">
            Conhecer o Profissional
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Comercial"
        title="Orçamentos"
        description="O preço é calculado e congelado no servidor. Depois do envio, qualquer mudança exige uma nova proposta."
        action={<span className="muted">{quotes.length} orçamento(s)</span>}
      />

      {!canManage && (
        <FormMessage tone="info">
          Seu acesso está pausado. Você pode consultar o histórico, mas novos orçamentos e
          links estão bloqueados até regularizar a assinatura.
        </FormMessage>
      )}
      {loadError && <FormMessage>{loadError}</FormMessage>}
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      <div className="two-column">
        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">{editing ? 'Edição' : 'Novo orçamento'}</span>
              <h2>{editing ? 'Editar rascunho' : 'Montar proposta'}</h2>
            </div>
            {(editing || draftItems.length > 0) && (
              <button type="button" className="text-button" onClick={resetForm}>
                Limpar
              </button>
            )}
          </div>

          <form className="form" onSubmit={(event) => void submitQuote(event)}>
            <label className="field">
              <span>Cliente</span>
              <select
                required
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                disabled={Boolean(editing) || !canManage}
              >
                <option value="">Selecione</option>
                {customers.map((customer) => (
                  <option value={customer.id} key={customer.id}>
                    {customer.display_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="quote-add-row">
              <label className="field">
                <span>Produto</span>
                <select
                  value={productToAdd}
                  onChange={(event) => setProductToAdd(event.target.value)}
                  disabled={!canManage}
                >
                  <option value="">Selecione</option>
                  {products.map((product) => (
                    <option value={product.id} key={product.id}>
                      {product.name} — {formatBRL(product.price_cents)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field quote-quantity-field">
                <span>Qtd.</span>
                <input
                  inputMode="numeric"
                  value={quantityToAdd}
                  onChange={(event) => setQuantityToAdd(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                onClick={addItem}
                disabled={!canManage || !productToAdd}
              >
                Adicionar
              </button>
            </div>

            {selectedDraftProducts.length === 0 ? (
              <p className="muted">Nenhum item adicionado.</p>
            ) : (
              <ul className="quote-draft-list">
                {selectedDraftProducts.map((item) => (
                  <li key={item.productId}>
                    <span>
                      <strong>{item.product.name}</strong>
                      <small>
                        {item.quantity} × {formatBRL(item.product.price_cents)} ·{' '}
                        {item.product.unit}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => removeItem(item.productId)}
                      disabled={!canManage}
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="form-row">
              <label className="field">
                <span>Válido até</span>
                <input
                  type="date"
                  required
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <div className="quote-preview">
                <span>Prévia (preço público)</span>
                <strong>{previewUnpriced ? 'A combinar' : formatBRL(previewTotal)}</strong>
                <small>O servidor aplica a tabela privada do cliente.</small>
              </div>
            </div>

            <label className="field">
              <span>Condições e observações (opcional)</span>
              <textarea
                maxLength={1000}
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={!canManage}
                placeholder="Prazo de entrega, condições de pagamento…"
              />
            </label>

            <button
              type="submit"
              className="button button-primary button-block"
              disabled={!canManage || busy === 'save'}
            >
              {saveLabel}
            </button>
            <p className="form-note">
              O orçamento não é nota fiscal nem cobrança. O comprador aceita por link e o
              sistema cria um pedido para o fornecedor confirmar.
            </p>
          </form>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Histórico</span>
              <h2>Seus orçamentos</h2>
            </div>
            <span className="muted">{quotes.filter((quote) => quote.status === 'sent').length} enviados</span>
          </div>

          {quotesListState() ?? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Referência</th>
                    <th>Cliente</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Validade</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => {
                    const link = links[quote.id]
                    return (
                      <tr key={quote.id}>
                        <td data-label="Referência">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setSelectedQuoteId(quote.id)}
                          >
                            <strong>{quote.public_reference}</strong>
                          </button>
                          {link && (
                            <div className="quote-link-row">
                              <CopyButton
                                value={link.url}
                                label="Copiar link"
                                className="text-button"
                              />
                              <a
                                className="text-link"
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Abrir
                              </a>
                            </div>
                          )}
                        </td>
                        <td data-label="Cliente">{customerName(quote.customer_id)}</td>
                        <td data-label="Status">
                          <span
                            className={`badge ${STATUS_CLASS[effectiveStatus(quote)] ?? 'badge-muted'}`}
                          >
                            {STATUS_TEXT[effectiveStatus(quote)] ?? effectiveStatus(quote)}
                          </span>
                        </td>
                        <td data-label="Total">{formatBRL(quote.total_cents)}</td>
                        <td data-label="Validade">{formatDateTime(quote.valid_until)}</td>
                        <td data-label="Ações" className="table-actions">
                          {renderActions(quote)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selectedQuote && (
        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Detalhe</span>
              <h2>{selectedQuote.public_reference}</h2>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelectedQuoteId(null)}
            >
              Fechar
            </button>
          </div>
          <p className="muted">
            {customerName(selectedQuote.customer_id)} · validade{' '}
            {formatDateTime(selectedQuote.valid_until)}
          </p>
          {selectedQuote.notes && <p>{selectedQuote.notes}</p>}
          <ul className="quote-detail-items">
            {(itemsByQuote.get(selectedQuote.id) ?? []).map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.name_snapshot}</strong>
                  <small>
                    {item.quantity} × {formatBRL(item.unit_price_cents)} · {item.unit_snapshot}
                  </small>
                </span>
                <strong>{formatBRL(item.subtotal_cents)}</strong>
              </li>
            ))}
          </ul>
          <div className="quote-total">
            <span>Total congelado</span>
            <strong>{formatBRL(selectedQuote.total_cents)}</strong>
          </div>
          <h3>Histórico</h3>
          <ol className="tracking-timeline">
            {(eventsByQuote.get(selectedQuote.id) ?? []).map((event) => (
              <li key={event.id}>
                <strong>{STATUS_TEXT[event.to_status ?? ''] ?? event.event}</strong>
                <span>{formatDateTime(event.created_at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
