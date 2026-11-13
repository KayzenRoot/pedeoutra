import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { ThemeToggle } from '../components/ThemeToggle'
import { Icon } from '../components/ui'
import { track } from '../lib/analytics'

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

export function Landing() {
  useEffect(() => {
    track('landing_view')
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
              <Link to="/criar-conta" className="button button-primary button-large">
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
          <strong>embalagens</strong>
          <strong>limpeza</strong>
          <strong>água e gelo</strong>
          <strong>descartáveis</strong>
          <strong>insumos</strong>
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
            <span className="eyebrow">Preço simples</span>
            <h2>Essencial agora. Profissional em preparação.</h2>
            <p>
              Comece grátis por 7 dias no Essencial. Depois, R$ 29,90 por mês. O
              Profissional (R$ 69,90) será liberado após a Parte 2/4.
            </p>
          </div>
          <div className="price-card">
            <div className="price-head">
              <span className="pill pill-lime">Teste sem cartão</span>
              <h3>PedeOutra Essencial</h3>
              <p>Para pequenos distribuidores e fornecedores de recompra.</p>
            </div>
            <div className="price-amount">
              <span>R$</span>
              <strong>29,90</strong>
              <small>/mês</small>
            </div>
            <ul className="price-list">
              <li>
                <Icon name="check" /> Catálogo público ilimitado
              </li>
              <li>
                <Icon name="check" /> Pedidos e clientes ilimitados
              </li>
              <li>
                <Icon name="check" /> Links de recompra com revogação
              </li>
              <li>
                <Icon name="check" /> WhatsApp manual e histórico
              </li>
              <li>
                <Icon name="check" /> Um fornecedor por conta
              </li>
            </ul>
            <Link to="/criar-conta" className="button button-primary button-block button-large">
              Começar teste de 7 dias
            </Link>
            <p className="price-note">
              Sem plano anual, cupom ou taxa por pedido. Cobrança apenas da assinatura do
              fornecedor, em cartão, via Asaas. O Profissional está em preparação e não é
              vendido nesta fase.
            </p>
          </div>
        </section>

        <section id="faq" className="section faq-section">
          <div className="section-heading">
            <span className="eyebrow">Dúvidas</span>
            <h2>O que você precisa saber</h2>
          </div>
          <div className="faq-list">
            {FAQ.map((item) => (
              <details key={item.question} className="faq-item">
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
          <Link to="/criar-conta" className="button button-lime button-large">
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
