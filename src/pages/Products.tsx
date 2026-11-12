import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../context/auth-context'
import { supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { centsToInput, formatBRL, parsePriceToCents } from '../lib/format'
import { EmptyState, FormMessage, PageHeader } from '../components/ui'

interface ProductForm {
  id: string | null
  name: string
  unit: string
  price: string
  active: boolean
}

const EMPTY_FORM: ProductForm = {
  id: null,
  name: '',
  unit: '',
  price: '',
  active: true,
}

function databaseMessage(message: string): string {
  if (message.includes('row-level security')) {
    return 'Seu acesso está pausado ou você não tem permissão para esta alteração.'
  }
  if (message.includes('products_name_len')) return 'O nome deve ter entre 1 e 120 caracteres.'
  if (message.includes('products_unit_len')) return 'A unidade deve ter entre 1 e 20 caracteres.'
  if (message.includes('products_price_range')) return 'O preço máximo é R$ 10.000,00.'
  return 'Não foi possível salvar. Revise os dados e tente novamente.'
}

export function Products() {
  const { organization } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const organizationId = organization?.id

  async function loadProducts() {
    if (!supabase || !organizationId) return
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (error) {
      setLoadError('Não foi possível carregar os produtos.')
    } else {
      setProducts(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return products
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.unit.toLowerCase().includes(term),
    )
  }, [products, search])

  const activeCount = products.filter((product) => product.active).length

  function startEdit(product: Product) {
    setForm({
      id: product.id,
      name: product.name,
      unit: product.unit,
      price: centsToInput(product.price_cents),
      active: product.active,
    })
    setFormError(null)
    setSuccess(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setSuccess(null)

    if (!supabase || !organizationId) return
    const name = form.name.trim()
    const unit = form.unit.trim()
    if (name.length < 1 || unit.length < 1) {
      setFormError('Informe nome e unidade do produto.')
      return
    }

    let priceCents: number | null = null
    if (form.price.trim()) {
      priceCents = parsePriceToCents(form.price)
      if (priceCents === null) {
        setFormError('Preço inválido. Use, por exemplo, 12,50.')
        return
      }
      if (priceCents > 1_000_000) {
        setFormError('O preço máximo é R$ 10.000,00.')
        return
      }
    }

    setSaving(true)
    const payload = {
      name,
      unit,
      price_cents: priceCents,
      active: form.active,
    }

    const result = form.id
      ? await supabase
          .from('products')
          .update(payload)
          .eq('id', form.id)
          .eq('organization_id', organizationId)
      : await supabase.from('products').insert({
          organization_id: organizationId,
          ...payload,
        })

    if (result.error) {
      setFormError(databaseMessage(result.error.message))
    } else {
      setSuccess(form.id ? 'Produto atualizado.' : 'Produto cadastrado.')
      resetForm()
      await loadProducts()
    }
    setSaving(false)
  }

  async function toggleActive(product: Product) {
    if (!supabase || !organizationId) return
    setFormError(null)
    setSuccess(null)
    const { error } = await supabase
      .from('products')
      .update({ active: !product.active })
      .eq('id', product.id)
      .eq('organization_id', organizationId)

    if (error) {
      setFormError(databaseMessage(error.message))
    } else {
      setSuccess(product.active ? 'Produto pausado.' : 'Produto reativado.')
      await loadProducts()
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Catálogo"
        title="Produtos"
        description="Nome, unidade e preço opcional. Produtos pausados não aparecem no catálogo, mas preservam o histórico."
        action={<span className="muted">{activeCount} ativos de {products.length}</span>}
      />

      {loadError && <FormMessage>{loadError}</FormMessage>}

      <div className="two-column">
        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Lista</span>
              <h2>Seu catálogo</h2>
            </div>
            <input
              type="search"
              className="search-input"
              placeholder="Buscar produto"
              aria-label="Buscar produto"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {loading ? (
            <p className="muted">Carregando produtos…</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={products.length === 0 ? 'Nenhum produto ainda' : 'Nada encontrado'}
              description={
                products.length === 0
                  ? 'Cadastre os itens que seus clientes compram com frequência. Sem estoque e sem planilha.'
                  : 'Tente outro termo de busca.'
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Unidade</th>
                    <th>Preço</th>
                    <th>Status</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product) => (
                    <tr key={product.id} className={product.active ? '' : 'row-muted'}>
                      <td data-label="Produto">
                        <strong>{product.name}</strong>
                      </td>
                      <td data-label="Unidade">{product.unit}</td>
                      <td data-label="Preço">{formatBRL(product.price_cents)}</td>
                      <td data-label="Status">
                        <span className={`badge ${product.active ? 'badge-active' : 'badge-muted'}`}>
                          {product.active ? 'Ativo' : 'Pausado'}
                        </span>
                      </td>
                      <td data-label="Ações" className="table-actions">
                        <button type="button" className="text-button" onClick={() => startEdit(product)}>
                          Editar
                        </button>
                        <button type="button" className="text-button" onClick={() => void toggleActive(product)}>
                          {product.active ? 'Pausar' : 'Ativar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card form-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">{form.id ? 'Edição' : 'Novo item'}</span>
              <h2>{form.id ? 'Editar produto' : 'Cadastrar produto'}</h2>
            </div>
            {form.id && (
              <button type="button" className="text-button" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>

          <form className="form" onSubmit={handleSubmit}>
            {formError && <FormMessage>{formError}</FormMessage>}
            {success && <FormMessage tone="success">{success}</FormMessage>}
            <label className="field">
              <span>Nome do produto</span>
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Copo descartável 200ml"
              />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Unidade</span>
                <input
                  required
                  maxLength={20}
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  placeholder="cento"
                />
              </label>
              <label className="field">
                <span>Preço (opcional)</span>
                <input
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) => setForm({ ...form, price: event.target.value })}
                  placeholder="12,50"
                />
              </label>
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              <span>Produto ativo no catálogo público</span>
            </label>
            <button type="submit" className="button button-primary button-block" disabled={saving}>
              {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Cadastrar produto'}
            </button>
            <p className="form-note">
              Sem preço, o item aparece como “A combinar”. O total do pedido é sempre
              calculado no servidor.
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
