import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../context/auth-context'
import { supabase } from '../lib/supabase'
import type { Customer } from '../lib/types'
import { formatPhone, phoneDigits, whatsappLink } from '../lib/format'
import { EmptyState, FormMessage, PageHeader } from '../components/ui'

interface CustomerForm {
  id: string | null
  name: string
  phone: string
}

const EMPTY_FORM: CustomerForm = { id: null, name: '', phone: '' }

function databaseMessage(message: string): string {
  if (message.includes('row-level security')) {
    return 'Seu acesso está pausado ou você não tem permissão para esta alteração.'
  }
  if (message.includes('customers_org_phone_unique')) {
    return 'Já existe um cliente com este telefone.'
  }
  if (message.includes('customers_phone_format')) {
    return 'Informe um telefone com DDD (10 a 15 dígitos).'
  }
  return 'Não foi possível salvar. Revise os dados e tente novamente.'
}

export function Customers() {
  const { organization } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const organizationId = organization?.id

  async function loadCustomers() {
    if (!supabase || !organizationId) return
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('organization_id', organizationId)
      .order('display_name', { ascending: true })

    if (error) {
      setLoadError('Não foi possível carregar os clientes.')
    } else {
      setCustomers(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter(
      (customer) =>
        customer.display_name.toLowerCase().includes(term) ||
        customer.contact_phone.includes(term.replace(/\D/g, '')),
    )
  }, [customers, search])

  function startEdit(customer: Customer) {
    setForm({
      id: customer.id,
      name: customer.display_name,
      phone: formatPhone(customer.contact_phone),
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
    const phone = phoneDigits(form.phone)
    if (name.length < 1 || name.length > 120) {
      setFormError('Informe o nome comercial do cliente.')
      return
    }
    if (phone.length < 10 || phone.length > 15) {
      setFormError('Informe um telefone com DDD (10 a 15 dígitos).')
      return
    }

    setSaving(true)
    const payload = { display_name: name, contact_phone: phone }
    const result = form.id
      ? await supabase
          .from('customers')
          .update(payload)
          .eq('id', form.id)
          .eq('organization_id', organizationId)
      : await supabase.from('customers').insert({
          organization_id: organizationId,
          ...payload,
        })

    if (result.error) {
      setFormError(databaseMessage(result.error.message))
    } else {
      setSuccess(form.id ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      resetForm()
      await loadCustomers()
    }
    setSaving(false)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Relacionamento"
        title="Clientes"
        description="Dados privados do seu negócio. Nome comercial e telefone bastam para manter o histórico e criar links de recompra."
        action={<span className="muted">{customers.length} cadastrados</span>}
      />

      {loadError && <FormMessage>{loadError}</FormMessage>}

      <div className="two-column">
        <section className="card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Lista</span>
              <h2>Clientes comerciais</h2>
            </div>
            <input
              type="search"
              className="search-input"
              placeholder="Buscar cliente"
              aria-label="Buscar cliente"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {loading ? (
            <p className="muted">Carregando clientes…</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={customers.length === 0 ? 'Nenhum cliente ainda' : 'Nada encontrado'}
              description={
                customers.length === 0
                  ? 'Cadastre quem compra de você com frequência. Não importamos planilha nem cobramos por cliente.'
                  : 'Tente outro termo de busca.'
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Telefone</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((customer) => {
                    const wa = whatsappLink(
                      customer.contact_phone,
                      `Olá, ${customer.display_name}! Tudo bem?`,
                    )
                    return (
                      <tr key={customer.id}>
                        <td data-label="Cliente">
                          <strong>{customer.display_name}</strong>
                        </td>
                        <td data-label="Telefone">{formatPhone(customer.contact_phone)}</td>
                        <td data-label="Ações" className="table-actions">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => startEdit(customer)}
                          >
                            Editar
                          </button>
                          {wa && (
                            <a className="text-link" href={wa} target="_blank" rel="noreferrer">
                              WhatsApp
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card form-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">{form.id ? 'Edição' : 'Novo cliente'}</span>
              <h2>{form.id ? 'Editar cliente' : 'Cadastrar cliente'}</h2>
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
              <span>Nome comercial</span>
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Padaria Pão Bom"
              />
            </label>
            <label className="field">
              <span>Telefone com DDD</span>
              <input
                required
                inputMode="tel"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="(11) 97777-6666"
              />
            </label>
            <button type="submit" className="button button-primary button-block" disabled={saving}>
              {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Cadastrar cliente'}
            </button>
            <p className="form-note">
              Não enviamos mensagens automáticas. O WhatsApp abre com uma mensagem pronta
              apenas quando você clica.
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
