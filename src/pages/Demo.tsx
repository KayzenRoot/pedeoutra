import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { track } from '../lib/analytics'
import { useSeo } from '../lib/seo'
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { FormMessage, QuantityStepper } from '../components/ui'
import { formatBRL } from '../lib/format'

const DEMO_PRODUCTS = [
  { id: 'demo-copo', name: 'Copo descartável 200ml', unit: 'cento', price_cents: 1250 },
  { id: 'demo-agua', name: 'Água mineral 5L', unit: 'galão', price_cents: 899 },
  { id: 'demo-saco', name: 'Saco de lixo 100L', unit: 'pacote', price_cents: 1890 },
  { id: 'demo-detergente', name: 'Detergente neutro 5L', unit: 'galão', price_cents: 2750 },
  { id: 'demo-guardanapo', name: 'Guardanapo branco', unit: 'pacote', price_cents: 640 },
  { id: 'demo-gelo', name: 'Gelo em cubos 5kg', unit: 'saco', price_cents: 1500 },
]

export function Demo() {
  useSeo({
    title: 'Demonstração — PedeOutra',
    description: 'Veja um catálogo B2B fictício e simule um pedido sem cadastro de comprador.',
    path: '/demo',
  })

  useEffect(() => {
    track('demo_open')
  }, [])

  const [cart, setCart] = useState<Record<string, number>>({
    'demo-copo': 2,
    'demo-agua': 3,
  })
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const items = useMemo(
    () =>
      DEMO_PRODUCTS.filter((product) => (cart[product.id] ?? 0) > 0).map((product) => ({
        ...product,
        quantity: cart[product.id] ?? 0,
      })),
    [cart],
  )

  const total = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0)

  function setQuantity(id: string, quantity: number) {
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[id]
      else next[id] = Math.min(999, quantity)
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (items.length === 0) {
      setError('Adicione pelo menos um produto.')
      return
    }
    if (buyerName.trim().length < 2) {
      setError('Informe um nome para a demonstração.')
      return
    }
    if (!consent) {
      setError('Aceite o aviso de privacidade para simular o envio.')
      return
    }
    setSuccess(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (success) {
    return (
      <div className="public-shell">
        <header className="public-header">
          <Brand />
          <span className="demo-flag">Demonstração</span>
        </header>
        <main className="public-main">
          <div className="success-card">
            <div className="success-mark" aria-hidden="true">
              ✓
            </div>
            <span className="eyebrow">Simulação concluída</span>
            <h1>Pedido demonstrativo enviado</h1>
            <p>
              Esta é uma demonstração com dados fictícios. Nenhum pedido foi enviado, nenhum
              fornecedor foi notificado e nenhum pagamento existe.
            </p>
            <div className="success-summary">
              <div>
                <span>Referência fictícia</span>
                <strong>DEMO-8F2A11</strong>
              </div>
              <div>
                <span>Itens</span>
                <strong>{items.reduce((sum, item) => sum + item.quantity, 0)}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatBRL(total)}</strong>
              </div>
            </div>
            <button
              type="button"
              className="button button-secondary button-block"
              onClick={() => {
                setSuccess(false)
                setBuyerName('')
                setBuyerPhone('')
                setConsent(false)
              }}
            >
              Voltar à demonstração
            </button>
            <Link to="/criar-conta" className="button button-primary button-block">
              Criar meu catálogo de verdade
            </Link>
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
          <strong>Distribuidora Bella Limpeza</strong>
          <span>Fornecedor fictício</span>
        </div>
        <span className="demo-flag">Demonstração</span>
      </header>

      <main className="public-main">
        <section className="catalog-hero">
          <div>
            <span className="eyebrow">Catálogo de demonstração</span>
            <h1>Bella Limpeza</h1>
            <p>
              Esta é a visão do comprador. Monte um pedido, preencha os dados fictícios e veja
              a confirmação. Nada é enviado e nada é cobrado.
            </p>
          </div>
          <Link to="/criar-conta" className="button button-primary">
            Quero o meu
          </Link>
        </section>

        <FormMessage tone="info">
          Demonstração com dados fictícios. Nenhum pedido real é criado, nenhuma mensagem é
          enviada e não há cobrança.
        </FormMessage>

        <div className="catalog-layout">
          <section className="product-grid" aria-label="Produtos fictícios">
            {DEMO_PRODUCTS.map((product) => {
              const quantity = cart[product.id] ?? 0
              return (
                <article
                  className={quantity > 0 ? 'product-card selected' : 'product-card'}
                  key={product.id}
                >
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
                  <span className="eyebrow">Pedido fictício</span>
                  <h2>{items.length} item(ns)</h2>
                </div>
              </div>

              <ul className="cart-list">
                {items.length === 0 ? (
                  <li className="muted">Nenhum item selecionado.</li>
                ) : (
                  items.map((item) => (
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
                  ))
                )}
              </ul>

              <div className="cart-total">
                <span>Total</span>
                <strong>{formatBRL(total)}</strong>
              </div>

              <form className="form" onSubmit={handleSubmit}>
                {error && <FormMessage>{error}</FormMessage>}
                <label className="field">
                  <span>Nome fictício</span>
                  <input
                    required
                    value={buyerName}
                    onChange={(event) => setBuyerName(event.target.value)}
                    placeholder="Empresa de exemplo"
                  />
                </label>
                <label className="field">
                  <span>Telefone fictício</span>
                  <input
                    value={buyerPhone}
                    onChange={(event) => setBuyerPhone(event.target.value)}
                    placeholder="(11) 90000-0000"
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>Entendo que esta é uma simulação e aceito o aviso de privacidade.</span>
                </label>
                <button type="submit" className="button button-primary button-block">
                  Simular envio do pedido
                </button>
              </form>
            </div>
          </aside>
        </div>
      </main>

      <footer className="public-footer">
        <span>Demonstração fictícia do PedeOutra. Nenhum dado é persistido.</span>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </footer>
    </div>
  )
}

