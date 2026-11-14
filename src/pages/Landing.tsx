import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { ThemeToggle } from '../components/ThemeToggle'
import { Icon } from '../components/ui'
import { track } from '../lib/analytics'
import { useSeo } from '../lib/seo'
import { getPlanCatalog } from '../lib/edge'
import { featureLabel, PLAN_NAMES } from '../lib/plans'
import type { PlanCatalogResponse, PublicPlan } from '../lib/types'

const FAQ = [
  {
    question: 'O comprador precisa criar conta ou baixar app?',
    answer:
      'Não. Ele abre o link do catálogo no celular, escolhe as quantidades e envia o pedido. O fornecedor recebe no painel para confirmar.',
  },
  {
    question: 'O PedeOutra cobra os pedidos dos meus clientes?',
    answer:
      'Não. O PedeOutra cobra apenas a mensalidade do fornecedor. Os pedidos são solicitações comerciais entre você e seu cliente, sem pagamento dentro da plataforma.',
  },
  {
    question: 'Como funciona o teste de 7 dias?',
    answer:
      'Você cria a conta e usa o catálogo, os pedidos e os links de recompra por 7 dias sem cartão. Ao final, pode assinar o Essencial de R$ 29,90/mês ou parar.',
  },
  {
    question: 'O link de recompra mostra os dados do meu cliente?',
    answer:
      'Não. O link é opaco e serve apenas para recriar a sugestão de itens. Ele não exibe nome, telefone, histórico nem dados de outros clientes.',
  },
  {
    question: 'Preciso integrar WhatsApp?',
    answer:
      'No MVP, não. Você compartilha links de WhatsApp pré-preenchidos com um clique. Nenhuma mensagem é enviada automaticamente.',
  },
  {
    question: 'Meus dados ficam separados de outros fornecedores?',
    answer:
      'Sim. O banco aplica isolamento por organização (RLS) e as APIs públicas só devolvem dados estritamente públicos do catálogo.',
  },
]

function planOrder(code: PublicPlan['plan_code']): number {
  return code === 'essential' ? 0 : 1
}

const FALLBACK_PLANS: PublicPlan[] = [
  {
    plan_code: 'essential',
    plan_version: 1,
    price_cents: 2990,
    currency: 'BRL',
    trial_days: 7,
    available: true,
    unavailable_reason: null,
    features: [
      ['catalog_public', 'products', 'customers', 'orders', 'order_tracking_link'],
      ['reorder_manual', 'whatsapp_manual', 'dashboard_basic', 'import_csv', 'pdf_nonfiscal'],
      ['qr_code', 'onboarding_templates', 'sku_quick_order', 'order_minimum'],
    ].flatMap((keys) =>
      keys.map((key) => ({ key, enabled: true, limit_value: null, limit_window: null })),
    ),
  },
  {
    plan_code: 'professional',
    plan_version: 1,
    price_cents: 6990,
    currency: 'BRL',
    trial_days: 0,
    available: false,
    unavailable_reason: 'PRO_PLAN_CHECKOUT_DISABLED',
    features: [
      ['private_prices', 'quotes', 'team', 'whatsapp_automation', 'api_access'],
      ['import_csv', 'pdf_nonfiscal', 'qr_code', 'sku_quick_order', 'order_minimum'],
    ].flatMap((keys) =>
      keys.map((key) => ({ key, enabled: true, limit_value: null, limit_window: null })),
    ),
  },
]

export function Landing() {
  useSeo({
    title: 'PedeOutra — Pediu uma vez? Pede outra!',
    description:
      'Catálogo B2B, pedidos organizados e links de recompra para pequenos distribuidores. Teste o Essencial por 7 dias sem cartão.',
    path: '/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'PedeOutra',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Catálogo e pedidos recorrentes para pequenos distribuidores, com catálogo público e links de recompra.',
      offers: {
        '@type': 'Offer',
        price: '29.90',
        priceCurrency: 'BRL',
      },
    },
  })

  const [plans, setPlans] = useState<PublicPlan[]>(FALLBACK_PLANS)

  useEffect(() => {
    track('landing_view')
    track('plan_view')
    let active = true
    void getPlanCatalog<PlanCatalogResponse>()
      .then((data) => {
        if (!active || !data.plans?.length) return
        setPlans(
          [...data.plans].sort((a, b) => planOrder(a.plan_code) - planOrder(b.plan_code)),
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="landing">
      <header className="site-header">
        <Brand />
        <nav className="site-nav" aria-label="Navegação do site">
          <a href="#como-funciona">Como funciona</a>
          <a href="#preco">Preço</a>
          <a href="#faq">Dúvidas</a>
          <Link to="/demo">Demonstração</Link>
        </nav>
        <div className="site-actions">
          <ThemeToggle compact />
          <Link to="/entrar" className="button button-ghost">
            Entrar
          </Link>
          <Link to="/criar-conta" className="button button-primary">
            Começar grátis
          </Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Recompra B2B sem complicação</span>
            <h1>
              Pediu uma vez?
              <br />
              <span className="highlight">Pede outra!</span>
            </h1>
            <p className="hero-lead">
              Seus clientes repetem a compra em poucos toques. Você recebe o pedido
              organizado, confirma e mantém o histórico. Sem app para o comprador e sem
              planilha no WhatsApp.
            </p>
            <div className="hero-actions">
              <Link
                to="/criar-conta"
                className="button button-primary button-large"
                onClick={() => track('cta_click', { event_target: 'hero_signup' })}
              >
                Testar 7 dias grátis
              </Link>
              <Link to="/demo" className="button button-secondary button-large">
                Ver demonstração
              </Link>
            </div>
            <p className="hero-note">Sem cartão no teste. Cancele quando quiser.</p>
            <ul className="hero-bullets">
              <li>
                <Icon name="check" /> Catálogo pronto em minutos
              </li>
              <li>
                <Icon name="check" /> Comprador sem conta
              </li>
              <li>
                <Icon name="check" /> Link de recompra seguro
              </li>
            </ul>
          </div>

          <div className="hero-visual" aria-label="Demonstração visual do fluxo PedeOutra">
            <div className="chat-card">
              <div className="chat-top">
                <span className="avatar">D</span>
                <div>
                  <strong>Distribuidora Aurora</strong>
                  <small>WhatsApp comercial</small>
                </div>
              </div>
              <div className="chat-bubble inbound">
                Oi! Manda o mesmo pedido da outra vez?
              </div>
              <div className="chat-bubble outbound">
                Claro! Use este link e ajuste as quantidades:
                <span className="chat-link">pedeoutra.app/c/aurora</span>
              </div>
              <div className="chat-bubble inbound">Pronto, enviei!</div>
            </div>

            <div className="mini-catalog">
              <div className="mini-catalog-top">
                <span className="mini-logo">A</span>
                <div>
                  <strong>Catálogo Aurora</strong>
                  <small>Entrega para empresas</small>
                </div>
                <span className="pill">Ativo</span>
              </div>
              <div className="mini-product">
                <div>
                  <strong>Copo descartável 200ml</strong>
                  <small>cento · R$ 12,50</small>
                </div>
                <span className="mini-qty">2</span>
              </div>
              <div className="mini-product">
                <div>
                  <strong>Água mineral 5L</strong>
                  <small>galão · R$ 8,99</small>
                </div>
                <span className="mini-qty">3</span>
              </div>
              <div className="mini-total">
                <span>Total</span>
                <strong>R$ 51,97</strong>
              </div>
              <button type="button" className="button button-primary button-block" tabIndex={-1}>
                Pedir outra vez
              </button>
            </div>
          </div>
        </section>

        <section className="logos-strip" aria-label="Perfis de uso">
          <span>Feito para quem vende de novo:</span>
          <Link to="/setores/embalagens">embalagens</Link>
          <Link to="/setores/limpeza">limpeza</Link>
          <Link to="/setores/agua-gelo">água e gelo</Link>
          <Link to="/setores/descartaveis">descartáveis</Link>
          <Link to="/setores/insumos">insumos</Link>
        </section>

        <section id="como-funciona" className="section">
          <div className="section-heading">
            <span className="eyebrow">Como funciona</span>
            <h2>Do catálogo ao pedido confirmado</h2>
            <p>Três passos, sem instalação e sem treinamento longo.</p>
          </div>
          <div className="steps-grid">
            <article className="step-card">
              <span className="step-number">1</span>
              <h3>Monte seu catálogo</h3>
              <p>
                Cadastre produtos com nome, unidade e preço opcional. Ative ou pause itens
                sem perder o histórico.
              </p>
            </article>
            <article className="step-card">
              <span className="step-number">2</span>
              <h3>Compartilhe o link</h3>
              <p>
                Envie o catálogo no WhatsApp. Cada cliente monta o pedido no celular, sem
                criar conta.
              </p>
            </article>
            <article className="step-card">
              <span className="step-number">3</span>
              <h3>Confirme e repita</h3>
              <p>
                Receba no painel, confirme o pedido e gere um link para o cliente repetir a
                compra depois.
              </p>
            </article>
          </div>
        </section>

        <section className="section section-split">
          <div>
            <span className="eyebrow">Para o fornecedor</span>
            <h2>Menos digitação, mais controle</h2>
            <p className="section-lead">
              O pedido chega com itens, quantidades, referência e contato. Você confirma,
              acompanha o status e compartilha a confirmação com um clique.
            </p>
            <ul className="feature-list">
              <li>
                <strong>Status claro:</strong> novo, confirmado, concluído ou cancelado, com
                histórico de quem alterou.
              </li>
              <li>
                <strong>Recompra com um link:</strong> o cliente repete a sugestão anterior e
                ajusta o que quiser.
              </li>
              <li>
                <strong>Preço sempre atual:</strong> o servidor recalcula o total na hora da
                recompra.
              </li>
              <li>
                <strong>WhatsApp manual:</strong> mensagens prontas, enviadas só quando você
                clica.
              </li>
            </ul>
          </div>
          <div className="panel-preview">
            <div className="panel-preview-head">
              <span>Pedidos de hoje</span>
              <span className="pill">3 novos</span>
            </div>
            {[
              ['PD-8F2A11C4B0', 'Padaria Pão Bom', 'R$ 51,97', 'Novo'],
              ['PD-4C9D22A17E', 'Mercado Central', 'R$ 128,40', 'Confirmado'],
              ['PD-B71E90D3A2', 'Café da Esquina', 'A combinar', 'Novo'],
            ].map(([reference, customer, total, status]) => (
              <div className="panel-row" key={reference}>
                <div>
                  <strong>{customer}</strong>
                  <small>{reference}</small>
                </div>
                <span>{total}</span>
                <span className={`badge badge-${status === 'Novo' ? 'new' : 'confirmed'}`}>
                  {status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section id="preco" className="section pricing-section">
          <div className="section-heading">
            <span className="eyebrow">Planos</span>
            <h2>Essencial para começar. Profissional para crescer.</h2>
            <p>
              O Essencial libera o catálogo e os pedidos. O Profissional adiciona preços
              por comprador, orçamentos e equipe. Nenhum plano cobra pedidos dos seus
              clientes.
            </p>
          </div>
          <div className="pricing-grid">
            {plans.map((plan) => {
              const enabledFeatures = plan.features.filter((feature) => feature.enabled)
              const isProfessional = plan.plan_code === 'professional'
              return (
                <article
                  className={isProfessional ? 'price-card price-card-pro' : 'price-card'}
                  key={plan.plan_code}
                >
                  <div className="price-head">
                    <span className={plan.available ? 'pill pill-lime' : 'pill'}>
                      {plan.available ? 'Disponível' : 'Em preparação'}
                    </span>
                    <h3>PedeOutra {PLAN_NAMES[plan.plan_code]}</h3>
                    <p>
                      {isProfessional
                        ? 'Para quem vende com tabela por cliente, orçamentos e equipe.'
                        : 'Para pequenos distribuidores e fornecedores de recompra.'}
                    </p>
                  </div>
                  <div className="price-amount">
                    <span>R$</span>
                    <strong>{(plan.price_cents / 100).toFixed(2).replace('.', ',')}</strong>
                    <small>/mês</small>
                  </div>
                  <ul className="price-list">
                    {enabledFeatures.slice(0, 7).map((feature) => (
                      <li key={feature.key}>
                        <Icon name="check" /> {featureLabel(feature.key)}
                      </li>
                    ))}
                    {isProfessional && (
                      <li className="price-list-muted">
                        WhatsApp automático depende de WABA/templates aprovados
                      </li>
                    )}
                  </ul>
                  {plan.available ? (
                    <Link
                      to="/criar-conta"
                      className="button button-primary button-block button-large"
                    >
                      Começar {plan.trial_days > 0 ? `teste de ${plan.trial_days} dias` : 'agora'}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="button button-secondary button-block button-large"
                      disabled
                    >
                      Checkout em preparação
                    </button>
                  )}
                  <p className="price-note">
                    {isProfessional
                      ? 'Recursos Pro em validação. Sem promessa de disponibilidade, cobrança ou envio automático nesta fase.'
                      : 'Sem plano anual, cupom ou taxa por pedido. Cobrança apenas da assinatura do fornecedor, em cartão, via Asaas.'}
                  </p>
                </article>
              )
            })}
          </div>
        </section>

        <section id="faq" className="section faq-section">
          <div className="section-heading">
            <span className="eyebrow">Dúvidas</span>
            <h2>O que você precisa saber</h2>
          </div>
          <div className="faq-list">
            {FAQ.map((item) => (
              <details
                key={item.question}
                className="faq-item"
                onToggle={(event) => {
                  if (event.currentTarget.open) {
                    track('faq_expand', { event_target: item.question.slice(0, 80) })
                  }
                }}
              >
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final-cta">
          <div>
            <span className="eyebrow">Próximo pedido</span>
            <h2>Seu cliente já sabe o que quer. Facilite a repetição.</h2>
          </div>
          <Link
            to="/criar-conta"
            className="button button-lime button-large"
            onClick={() => track('cta_click', { event_target: 'final_signup' })}
          >
            Criar catálogo grátis
          </Link>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <Brand />
          <p>
            PedeOutra é um MVP em validação. Preço, marca e domínio são hipóteses sujeitas a
            verificação.
          </p>
        </div>
        <div className="footer-links">
          <Link to="/demo">Demonstração</Link>
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos de uso</Link>
          <a href="https://github.com/KayzenRoot/pedeoutra" target="_blank" rel="noreferrer">
            Código
          </a>
        </div>
        <small>© {new Date().getFullYear()} PedeOutra. Documentos legais preliminares.</small>
      </footer>
    </div>
  )
}
