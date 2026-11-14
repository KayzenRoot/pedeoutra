import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { organizationAccess } from '../lib/access'
import { callAuthedFunction } from '../lib/edge'
import { centsToInput, formatBRL, parsePriceToCents } from '../lib/format'
import { supabase } from '../lib/supabase'
import type {
  CreatePriceLinkResponse,
  Customer,
  CustomerPriceListAssignment,
  PriceList,
  PriceListItem,
  Product,
} from '../lib/types'
import { CopyButton, EmptyState, FormMessage, PageHeader } from '../components/ui'

function databaseMessage(message: string): string {
  if (message.includes('row-level security')) {
    return 'Seu acesso está pausado ou o plano não inclui preços por comprador.'
  }
  if (message.includes('price_lists_org_name_unique')) {
    return 'Já existe uma tabela com este nome.'
  }
  if (message.includes('price_list_items_price_check')) {
    return 'O preço deve ficar entre R$ 0,00 e R$ 10.000,00.'
  }
  return 'Não foi possível salvar. Revise os dados e tente novamente.'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
}

export function PrivatePrices() {
  const { organization, subscription, user } = useAuth()
  const [lists, setLists] = useState<PriceList[]>([])
  const [items, setItems] = useState<PriceListItem[]>([])
  const [assignments, setAssignments] = useState<CustomerPriceListAssignment[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, CreatePriceLinkResponse>>({})

  const organizationId = organization?.id
  const isProfessional = subscription?.plan_code === 'professional'
  const access = organizationAccess(organization, subscription)
  const canManage = isProfessional && access.canWrite

  async function loadData() {
    if (!supabase || !organizationId) return
    setLoading(true)
    setLoadError(null)
    const [listsResult, itemsResult, assignmentsResult, productsResult, customersResult] =
      await Promise.all([
        supabase
          .from('price_lists')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('price_list_items')
          .select('*')
          .eq('organization_id', organizationId),
        supabase
          .from('customer_price_list_assignments')
          .select('*')
          .eq('organization_id', organizationId),
        supabase
          .from('products')
          .select('*')
          .eq('organization_id', organizationId)
          .order('name', { ascending: true }),
        supabase
          .from('customers')
          .select('*')
          .eq('organization_id', organizationId)
          .order('display_name', { ascending: true }),
      ])

    if (
      listsResult.error ||
      itemsResult.error ||
      assignmentsResult.error ||
      productsResult.error ||
      customersResult.error
    ) {
      setLoadError('Não foi possível carregar as tabelas de preços.')
    } else {
      setLists(listsResult.data ?? [])
      setItems(itemsResult.data ?? [])
      setAssignments(assignmentsResult.data ?? [])
      setProducts(productsResult.data ?? [])
      setCustomers(customersResult.data ?? [])
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

  useEffect(() => {
    if (selectedListId && lists.some((list) => list.id === selectedListId)) return
    setSelectedListId(lists[0]?.id ?? null)
  }, [lists, selectedListId])

  useEffect(() => {
    const drafts: Record<string, string> = {}
    for (const item of items) {
      if (item.price_list_id === selectedListId) {
        drafts[item.product_id] = centsToInput(item.price_cents)
      }
    }
    setItemDrafts(drafts)
  }, [items, selectedListId])

  const selectedList = lists.find((list) => list.id === selectedListId) ?? null
  const selectedItems = useMemo(
    () => items.filter((item) => item.price_list_id === selectedListId),
    [items, selectedListId],
  )
  const itemByProduct = useMemo(() => {
    const map = new Map<string, PriceListItem>()
    for (const item of selectedItems) map.set(item.product_id, item)
    return map
  }, [selectedItems])
  const assignmentByCustomer = useMemo(() => {
    const map = new Map<string, CustomerPriceListAssignment>()
    for (const assignment of assignments) map.set(assignment.customer_id, assignment)
    return map
  }, [assignments])

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase()
    if (!term) return products
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        (product.sku ?? '').toLowerCase().includes(term),
    )
  }, [products, productSearch])

  function emptyPriceState() {
    if (!selectedList) {
      return <p className="muted">Crie ou selecione uma tabela para editar os preços.</p>
    }
    if (filteredProducts.length === 0) {
      return <p className="muted">Nenhum produto encontrado.</p>
    }
    return null
  }

  async function createList(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !organizationId || !canManage) return
    const name = newListName.trim()
    if (name.length < 1) {
      setError('Informe o nome da tabela.')
      return
    }
    setBusy('new-list')
    setError(null)
    setSuccess(null)
    const { data, error: insertError } = await supabase
      .from('price_lists')
      .insert({ organization_id: organizationId, name, created_by: user?.id ?? null })
      .select('id')
      .single()
    if (insertError) {
      setError(databaseMessage(insertError.message))
    } else {
      setNewListName('')
      setSuccess('Tabela criada.')
      await loadData()
      if (data?.id) setSelectedListId(data.id)
    }
    setBusy(null)
  }

  async function toggleList(list: PriceList) {
    if (!supabase || !organizationId || !canManage) return
    setBusy(`list-${list.id}`)
    setError(null)
    const { error: updateError } = await supabase
      .from('price_lists')
      .update({ active: !list.active })
      .eq('id', list.id)
      .eq('organization_id', organizationId)
    if (updateError) setError(databaseMessage(updateError.message))
    else await loadData()
    setBusy(null)
  }

  async function deleteList(list: PriceList) {
    if (!supabase || !organizationId || !canManage) return
    if (!window.confirm(`Excluir a tabela ${list.name}? Clientes atribuídos perdem o preço especial.`)) {
      return
    }
    setBusy(`list-${list.id}`)
    setError(null)
    const { error: deleteError } = await supabase
      .from('price_lists')
      .delete()
      .eq('id', list.id)
      .eq('organization_id', organizationId)
    if (deleteError) setError(databaseMessage(deleteError.message))
    else {
      setSuccess('Tabela excluída.')
      await loadData()
    }
    setBusy(null)
  }

  async function saveItem(product: Product) {
    if (!supabase || !organizationId || !selectedListId || !canManage) return
    const parsed = parsePriceToCents(itemDrafts[product.id] ?? '')
    if (parsed === null) {
      setError('Preço inválido. Use, por exemplo, 12,50.')
      return
    }
    if (parsed > 1_000_000) {
      setError('O preço máximo é R$ 10.000,00.')
      return
    }
    setBusy(`item-${product.id}`)
    setError(null)
    setSuccess(null)
    const { error: upsertError } = await supabase.from('price_list_items').upsert(
      {
        organization_id: organizationId,
        price_list_id: selectedListId,
        product_id: product.id,
        price_cents: parsed,
        valid_from: new Date().toISOString(),
        valid_until: null,
      },
      { onConflict: 'price_list_id,product_id' },
    )
    if (upsertError) {
      setError(databaseMessage(upsertError.message))
    } else {
      setSuccess(`Preço de ${product.name} salvo.`)
      await loadData()
    }
    setBusy(null)
  }

  async function removeItem(product: Product, item: PriceListItem) {
    if (!supabase || !organizationId || !canManage) return
    setBusy(`item-${product.id}`)
    setError(null)
    const { error: deleteError } = await supabase
      .from('price_list_items')
      .delete()
      .eq('id', item.id)
      .eq('organization_id', organizationId)
    if (deleteError) setError(databaseMessage(deleteError.message))
    else {
      setSuccess(`Preço especial de ${product.name} removido.`)
      await loadData()
    }
    setBusy(null)
  }

  async function assignList(customer: Customer, priceListId: string) {
    if (!supabase || !organizationId || !canManage) return
    setBusy(`assign-${customer.id}`)
    setError(null)
    setSuccess(null)
    const existing = assignmentByCustomer.get(customer.id)
    if (!priceListId) {
      if (!existing) {
        setBusy(null)
        return
      }
      const { error: deleteError } = await supabase
        .from('customer_price_list_assignments')
        .delete()
        .eq('id', existing.id)
        .eq('organization_id', organizationId)
      if (deleteError) setError(databaseMessage(deleteError.message))
      else {
        setSuccess(`Tabela removida de ${customer.display_name}.`)
        await loadData()
      }
    } else {
      const { error: upsertError } = await supabase.from('customer_price_list_assignments').upsert(
        {
          organization_id: organizationId,
          customer_id: customer.id,
          price_list_id: priceListId,
        },
        { onConflict: 'customer_id' },
      )
      if (upsertError) setError(databaseMessage(upsertError.message))
      else {
        setSuccess(`Tabela aplicada a ${customer.display_name}.`)
        await loadData()
      }
    }
    setBusy(null)
  }

  async function createLink(customer: Customer) {
    setBusy(`link-${customer.id}`)
    setError(null)
    setSuccess(null)
    try {
      const link = await callAuthedFunction<CreatePriceLinkResponse>(
        'customer-price-link-create',
        { customer_id: customer.id },
      )
      setLinks((current) => ({ ...current, [customer.id]: link }))
      setSuccess(`Link de preços gerado para ${customer.display_name}.`)
    } catch (linkError) {
      setError(errorMessage(linkError))
    } finally {
      setBusy(null)
    }
  }

  async function revokeLink(customer: Customer) {
    setBusy(`link-${customer.id}`)
    setError(null)
    try {
      await callAuthedFunction('customer-price-link-revoke', { customer_id: customer.id })
      setLinks((current) => {
        const next = { ...current }
        delete next[customer.id]
        return next
      })
      setSuccess(`Link de preços de ${customer.display_name} revogado.`)
    } catch (linkError) {
      setError(errorMessage(linkError))
    } finally {
      setBusy(null)
    }
  }

  if (!isProfessional) {
    return (
      <div>
        <PageHeader
          eyebrow="Relacionamento"
          title="Preços por comprador"
          description="Tabelas de preço exclusivas para clientes selecionados, com link privado e sem expor valores no catálogo público."
        />
        <section className="card centered-card">
          <span className="eyebrow">Plano Profissional</span>
          <h2>Preço especial por cliente</h2>
          <p>
            Crie tabelas como “Ouro” ou “Atacado”, aplique a clientes específicos e envie um
            link privado. O catálogo público continua com os preços normais.
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
        eyebrow="Relacionamento"
        title="Preços por comprador"
        description="Cada cliente vê apenas a tabela atribuída a ele. O servidor recalcula o pedido e preserva o preço no histórico."
        action={
          <div className="header-actions">
            <Link to="/app/orcamentos" className="button button-secondary">
              Orçamentos
            </Link>
            <span className="muted">{assignments.length} cliente(s) com tabela</span>
          </div>
        }
      />

      {!canManage && (
        <FormMessage tone="info">
          Seu acesso está pausado. As tabelas continuam visíveis, mas alterações e novos
          links estão bloqueados até regularizar a assinatura.
        </FormMessage>
      )}
      {loadError && <FormMessage>{loadError}</FormMessage>}
      {error && <FormMessage>{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}

      {loading ? (
        <p className="muted">Carregando tabelas de preços…</p>
      ) : (
        <>
          <div className="two-column">
            <section className="card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Tabelas</span>
                  <h2>Suas listas</h2>
                </div>
                <span className="muted">{lists.length}</span>
              </div>

              <form className="inline-form" onSubmit={(event) => void createList(event)}>
                <input
                  className="search-input"
                  placeholder="Nova tabela (ex.: Ouro)"
                  aria-label="Nome da nova tabela de preços"
                  maxLength={80}
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  disabled={!canManage}
                />
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={!canManage || busy === 'new-list'}
                >
                  {busy === 'new-list' ? 'Criando…' : 'Criar tabela'}
                </button>
              </form>

              {lists.length === 0 ? (
                <EmptyState
                  title="Nenhuma tabela ainda"
                  description="Crie uma tabela e defina os preços especiais dos produtos."
                />
              ) : (
                <ul className="price-list-picker">
                  {lists.map((list) => (
                    <li key={list.id} className={list.id === selectedListId ? 'active' : ''}>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedListId(list.id)}
                      >
                        <strong>{list.name}</strong>
                        <small>{list.active ? 'Ativa' : 'Pausada'}</small>
                      </button>
                      {list.id === selectedListId && (
                        <div className="table-actions">
                          <button
                            type="button"
                            className="text-button"
                            disabled={!canManage || busy === `list-${list.id}`}
                            onClick={() => void toggleList(list)}
                          >
                            {list.active ? 'Pausar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            disabled={!canManage || busy === `list-${list.id}`}
                            onClick={() => void deleteList(list)}
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="form-note">
                Tabelas pausadas ou excluídas deixam de valer imediatamente; os pedidos
                antigos mantêm o preço registrado.
              </p>
            </section>

            <section className="card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Preços</span>
                  <h2>{selectedList ? selectedList.name : 'Selecione uma tabela'}</h2>
                </div>
                <input
                  type="search"
                  className="search-input"
                  placeholder="Buscar produto"
                  aria-label="Buscar produto na tabela"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  disabled={!selectedList}
                />
              </div>

              {emptyPriceState() ?? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Preço público</th>
                        <th>Preço na tabela</th>
                        <th aria-label="Ações" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => {
                        const item = itemByProduct.get(product.id)
                        return (
                          <tr key={product.id}>
                            <td data-label="Produto">
                              <strong>{product.name}</strong>
                              <small>
                                {product.unit}
                                {product.sku ? ` · ${product.sku}` : ''}
                              </small>
                            </td>
                            <td data-label="Preço público">{formatBRL(product.price_cents)}</td>
                            <td data-label="Preço na tabela">
                              <input
                                className="price-input"
                                inputMode="decimal"
                                aria-label={`Preço de ${product.name}`}
                                value={itemDrafts[product.id] ?? ''}
                                onChange={(event) =>
                                  setItemDrafts((current) => ({
                                    ...current,
                                    [product.id]: event.target.value,
                                  }))
                                }
                                placeholder={centsToInput(product.price_cents) || 'A combinar'}
                                disabled={!canManage}
                              />
                            </td>
                            <td data-label="Ações" className="table-actions">
                              <button
                                type="button"
                                className="text-button"
                                disabled={!canManage || busy === `item-${product.id}`}
                                onClick={() => void saveItem(product)}
                              >
                                Salvar
                              </button>
                              {item && (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={!canManage || busy === `item-${product.id}`}
                                  onClick={() => void removeItem(product, item)}
                                >
                                  Remover
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="form-note">
                Preço em branco ou sem item usa o preço público do produto. O valor é
                congelado no pedido quando o cliente envia.
              </p>
            </section>
          </div>

          <section className="card">
            <div className="card-heading">
              <div>
                <span className="eyebrow">Atribuições</span>
                <h2>Clientes com preço especial</h2>
              </div>
              <span className="muted">{customers.length} cliente(s)</span>
            </div>

            {customers.length === 0 ? (
              <EmptyState
                title="Nenhum cliente ainda"
                description="Cadastre clientes para atribuir tabelas e gerar links privados."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Tabela</th>
                      <th>Link privado</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => {
                      const assignment = assignmentByCustomer.get(customer.id)
                      const link = links[customer.id]
                      const linkLabel = assignment
                        ? 'Nenhum link ativo nesta sessão'
                        : 'Defina uma tabela'
                      return (
                        <tr key={customer.id}>
                          <td data-label="Cliente">
                            <strong>{customer.display_name}</strong>
                          </td>
                          <td data-label="Tabela">
                            <select
                              className="search-input"
                              aria-label={`Tabela de ${customer.display_name}`}
                              value={assignment?.price_list_id ?? ''}
                              onChange={(event) =>
                                void assignList(customer, event.target.value)
                              }
                              disabled={!canManage || busy === `assign-${customer.id}`}
                            >
                              <option value="">Sem tabela</option>
                              {lists.map((list) => (
                                <option value={list.id} key={list.id}>
                                  {list.name}
                                  {list.active ? '' : ' (pausada)'}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td data-label="Link privado">
                            {link ? (
                              <div className="price-link-row">
                                <a
                                  className="text-link price-link-url"
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Abrir link
                                </a>
                                <CopyButton
                                  value={link.url}
                                  label="Copiar"
                                  className="text-button"
                                />
                                <small>Válido até {new Date(link.expires_at).toLocaleDateString('pt-BR')}</small>
                              </div>
                            ) : (
                              <span className="muted">
                                {linkLabel}
                              </span>
                            )}
                          </td>
                          <td data-label="Ações" className="table-actions">
                            <button
                              type="button"
                              className="text-button"
                              disabled={
                                !canManage ||
                                !assignment ||
                                busy === `link-${customer.id}`
                              }
                              onClick={() => void createLink(customer)}
                            >
                              {link ? 'Gerar novo' : 'Gerar link'}
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={busy === `link-${customer.id}`}
                              onClick={() => void revokeLink(customer)}
                            >
                              Revogar
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="form-note">
              O link é opaco, expira em 30 dias e pode ser revogado a qualquer momento. Quem
              tiver o link vê a tabela do cliente; não envie em grupos públicos.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
