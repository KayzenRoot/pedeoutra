import { Link, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useSeo } from '../lib/seo'
import { NotFound } from './NotFound'

interface SectorContent {
  slug: string
  name: string
  title: string
  description: string
  bullets: string[]
  examples: string[]
}

const SECTORS: Record<string, SectorContent> = {
  embalagens: {
    slug: 'embalagens',
    name: 'Embalagens',
    title: 'Catálogo e recompra para distribuidores de embalagens',
    description:
      'Organize copos, sacolas, potes e descartáveis em um catálogo B2B com preços por cliente e recompra em poucos toques.',
    bullets: [
      'Catálogo por categoria, com foto, SKU e unidade de venda.',
      'Pedido mínimo, múltiplos de embalagem e preço por comprador.',
      'Cliente repete a compra sem criar conta ou instalar aplicativo.',
    ],
    examples: ['copos', 'sacolas', 'potes', 'marmitas', 'tampas'],
  },
  limpeza: {
    slug: 'limpeza',
    name: 'Limpeza',
    title: 'Catálogo B2B para distribuidores de produtos de limpeza',
    description:
      'Venda detergentes, desinfetantes, panos e descartáveis com histórico de pedidos e lembretes de reposição.',
    bullets: [
      'Produtos por galão, caixa, fardo ou unidade, sem planilha paralela.',
      'Preço particular para clientes recorrentes e orçamento com aceite.',
      'Radar de recompra para saber quem está fora da cadência.',
    ],
    examples: ['detergente', 'desinfetante', 'água sanitária', 'panos', 'sacos de lixo'],
  },
  'agua-gelo': {
    slug: 'agua-gelo',
    name: 'Água e gelo',
    title: 'Pedidos recorrentes para distribuidores de água e gelo',
    description:
      'Facilite a reposição de galões, garrafas e sacos de gelo com catálogo mobile e acompanhamento de pedido.',
    bullets: [
      'Catálogo leve, pensado para o cliente pedir pelo celular.',
      'Mínimos e múltiplos por item para organizar a entrega.',
      'Link de acompanhamento sem expor telefone ou observações.',
    ],
    examples: ['galão 20L', 'garrafa 5L', 'gelo em cubos', 'gelo em escamas'],
  },
  descartaveis: {
    slug: 'descartaveis',
    name: 'Descartáveis',
    title: 'Catálogo e recompra para lojas de descartáveis',
    description:
      'Copos, pratos, guardanapos e embalagens para food service em um catálogo B2B simples de atualizar.',
    bullets: [
      'Importe produtos por CSV/XLSX com prévia antes de confirmar.',
      'Organize categorias e fotos para o comprador encontrar rápido.',
      'Pedido por lista de SKU para clientes que já sabem o que querem.',
    ],
    examples: ['copos', 'pratos', 'guardanapos', 'talheres', 'caixas para delivery'],
  },
  insumos: {
    slug: 'insumos',
    name: 'Insumos',
    title: 'Catálogo B2B para distribuidores de insumos',
    description:
      'Atenda padarias, restaurantes e mercados com catálogo organizado, preços por cliente e histórico de recompra.',
    bullets: [
      'Produtos com unidade, SKU e preço opcional para orçamento.',
      'Clientes, pedidos e status em um painel único.',
      'Exportação de comprovante em PDF não fiscal para conferência.',
    ],
    examples: ['farinha', 'açúcar', 'óleo', 'fermento', 'cobertura'],
  },
}

export function Sector() {
  const { slug } = useParams<{ slug: string }>()
  const sector = slug ? SECTORS[slug] : undefined

  useSeo({
    title: sector ? `${sector.title} — PedeOutra` : 'Setores — PedeOutra',
    description: sector?.description ?? 'Catálogo e recompra B2B por setor.',
    path: sector ? `/setores/${sector.slug}` : '/setores',
    noindex: !sector,
  })

  if (!sector) return <NotFound />

  return (
    <div className="public-shell">
      <header className="public-header">
        <Brand />
        <Link to="/" className="button button-ghost">
          Voltar ao site
        </Link>
      </header>
      <main className="public-main">
        <section className="catalog-hero">
          <div>
            <span className="eyebrow">PedeOutra para {sector.name.toLowerCase()}</span>
            <h1>{sector.title}</h1>
            <p>{sector.description}</p>
          </div>
          <span className="pill">Catálogo B2B</span>
        </section>

        <div className="two-column">
          <section className="card">
            <h2>O que o fornecedor resolve</h2>
            <ul className="feature-list">
              {sector.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <p className="muted">
              Exemplos de itens: {sector.examples.join(', ')}. O catálogo é seu; o PedeOutra
              organiza o pedido e a recompra.
            </p>
            <Link to="/criar-conta" className="button button-primary">
              Criar catálogo grátis
            </Link>
          </section>
          <section className="card">
            <h2>Comece pelo que já vende</h2>
            <p>
              Cadastre os produtos atuais, compartilhe o link no WhatsApp e receba o primeiro
              pedido organizado. O comprador não precisa criar conta.
            </p>
            <Link to="/demo" className="button button-secondary">
              Ver demonstração
            </Link>
            <p className="form-note">
              Sem cobrança de pedidos dos seus clientes. A assinatura é do fornecedor.
            </p>
          </section>
        </div>
      </main>
      <footer className="public-footer">
        <span>PedeOutra — catálogo e recompra B2B.</span>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </footer>
    </div>
  )
}
