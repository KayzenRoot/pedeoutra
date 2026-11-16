import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useSeo } from '../lib/seo'

function LegalLayout({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="legal-page">
      <header className="public-header">
        <Brand />
        <Link to="/" className="button button-ghost">
          Voltar ao site
        </Link>
      </header>
      <main className="legal-main">
        <span className="eyebrow">Documento preliminar</span>
        <h1>{title}</h1>
        <p className="legal-meta">
          Última atualização: 12/11/2026 · Revisão jurídica humana pendente. Este texto não
          substitui parecer jurídico.
        </p>
        <div className="legal-body">{children}</div>
      </main>
      <footer className="public-footer">
        <span>PedeOutra — MVP em validação.</span>
        <Link to="/privacidade">Privacidade</Link>
        <Link to="/termos">Termos</Link>
      </footer>
    </div>
  )
}

export function Privacy() {
  useSeo({
    title: 'Aviso de privacidade — PedeOutra',
    description: 'Como o PedeOutra trata dados de fornecedores, compradores e pedidos.',
    path: '/privacidade',
  })

  return (
    <LegalLayout title="Aviso de privacidade">
      <h2>1. Papéis no tratamento</h2>
      <p>
        O fornecedor que compartilha um catálogo é o controlador dos dados dos seus clientes e
        pedidos. O PedeOutra atua como operador ao hospedar e processar essas informações. Para
        os dados de conta e assinatura do fornecedor, o PedeOutra é o controlador.
      </p>

      <h2>2. Dados tratados</h2>
      <ul>
        <li>
          <strong>Conta do fornecedor:</strong> e-mail, organização, nome fantasia, WhatsApp
          comercial e cidade.
        </li>
        <li>
          <strong>Catálogo:</strong> produtos, unidades, preços e status.
        </li>
        <li>
          <strong>Clientes do fornecedor:</strong> nome comercial e telefone, quando cadastrados.
        </li>
        <li>
          <strong>Pedidos:</strong> itens, quantidades, valores, referência, nome/telefone do
          comprador, observação e status.
        </li>
        <li>
          <strong>Segurança:</strong> hash de IP para rate limit e logs técnicos redigidos, sem
          tokens de recompra ou dados de cartão.
        </li>
      </ul>

      <h2>3. Finalidades e bases legais</h2>
      <p>
        Usamos os dados para operar catálogo, pedidos, recompra e assinatura; prevenir abuso e
        fraude; e cumprir obrigações legais. As bases legais podem incluir execução de contrato,
        legítimo interesse de segurança e consentimento do comprador ao enviar o pedido, conforme
        o caso.
      </p>

      <h2>4. Compartilhamento</h2>
      <p>
        Podemos usar operadores de infraestrutura e pagamento estritamente necessários:
        Supabase (banco/autenticação/funções), Cloudflare (hospedagem do frontend) e Asaas
        (assinatura do fornecedor). O PedeOutra não recebe dados de cartão. Não vendemos dados
        pessoais nem enviamos campanhas automáticas de WhatsApp.
      </p>

      <h2>5. Retenção e eliminação</h2>
      <p>
        Dados de conta, catálogo, clientes e pedidos são mantidos enquanto a conta existir ou
        enquanto necessários para a operação. Registros de rate limit têm retenção curta.
        Solicitações de eliminação devem ser dirigidas ao fornecedor controlador; o PedeOutra
        apoia a operação quando aplicável. Alguns registros podem ser mantidos para cumprir
        obrigação legal ou exercer direitos.
      </p>

      <h2>6. Direitos do titular</h2>
      <p>
        Nos termos da LGPD, o titular pode solicitar confirmação de tratamento, acesso,
        correção, eliminação, informação sobre compartilhamento e portabilidade quando
        aplicável. O comprador deve procurar o fornecedor que recebeu o pedido. O fornecedor pode
        usar o painel para corrigir dados sob seu controle.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Aplicamos isolamento por organização no banco (RLS), tokens de recompra opacos com hash,
        rate limit, validação no servidor e separação de chaves privilegiadas. Nenhum sistema é
        imune; incidentes relevantes serão tratados e comunicados conforme a lei.
      </p>

      <h2>8. Cookies e analytics</h2>
      <p>
        O produto não usa cookies de publicidade. Analytics é opcional e, quando habilitado,
        envia apenas nome do evento e rota saneada, sem PII, query string ou token de recompra.
      </p>

      <h2>9. Contato e alterações</h2>
      <p>
        O canal oficial de privacidade e suporte será publicado antes do lançamento
        comercial. Enquanto ele não estiver disponível e a revisão jurídica não for
        concluída, o serviço não deve ser vendido ao público. Solicitações de titulares
        serão tratadas pelo responsável indicado nesse canal. Este aviso pode mudar; a
        data de atualização será revisada.
      </p>
    </LegalLayout>
  )
}

export function Terms() {
  useSeo({
    title: 'Termos de uso — PedeOutra',
    description: 'Termos do serviço PedeOutra para fornecedores assinantes.',
    path: '/termos',
  })

  return (
    <LegalLayout title="Termos de uso">
      <h2>1. Serviço</h2>
      <p>
        O PedeOutra é uma ferramenta de catálogo e pedidos recorrentes B2B. Não é ERP, CRM amplo,
        PDV, marketplace, serviço de logística, emissor de nota fiscal, bot de WhatsApp ou
        gateway de pagamento dos pedidos. O contrato é com o fornecedor assinante.
      </p>

      <h2>2. Conta e organização</h2>
      <p>
        O fornecedor é responsável pelas credenciais, pelos dados da organização e pelas
        informações que publica. No MVP, cada conta administra uma organização.
      </p>

      <h2>3. Teste, assinatura, cancelamento e reembolso</h2>
      <p>
        O teste é de 7 dias, sem cartão. Após o teste, o plano Essencial custa R$ 29,90 por mês e
        é cobrado em cartão via Asaas Checkout recorrente. O plano Profissional (R$ 69,90/mês)
        está em preparação e não pode ser contratado nesta fase. A cobrança é apenas da
        assinatura do fornecedor. O cancelamento interrompe a renovação e mantém o acesso até o fim do período
        já pago. Reembolso, quando cabível, revoga o acesso pago; um trial ainda vigente não é
        estendido. O PedeOutra não recebe nem armazena dados de cartão.
      </p>

      <h2>4. Pedidos dos compradores</h2>
      <p>
        Pedidos enviados por links públicos são solicitações comerciais sujeitas à confirmação
        do fornecedor. O PedeOutra não garante venda, pagamento, entrega, estoque, preço ou
        disponibilidade. O fornecedor é responsável por confirmar, entregar e emitir documentos
        fiscais quando exigidos.
      </p>

      <h2>5. Uso aceitável</h2>
      <p>
        É proibido usar o serviço para spam, fraude, conteúdo ilícito, violação de direitos,
        coleta indevida de dados ou tentativa de burlar controles de segurança. Podemos
        suspender contas que representem risco relevante.
      </p>

      <h2>6. Disponibilidade e limitações</h2>
      <p>
        O MVP é oferecido em evolução e pode ter indisponibilidades. Não há SLA enterprise nesta
        fase. O serviço depende de provedores externos (Supabase, Cloudflare, Asaas), cujos
        limites e políticas se aplicam. Não há promessa de aumento de faturamento.
      </p>

      <h2>7. Propriedade intelectual</h2>
      <p>
        O código e a marca pertencem aos seus titulares. A marca PedeOutra e o domínio estão
        sujeitos a verificação no INPI/Registro.br. Nada nestes termos concede uso de marca.
      </p>

      <h2>8. Privacidade e lei aplicável</h2>
      <p>
        O tratamento de dados segue o <Link to="/privacidade">aviso de privacidade</Link>. Estes
        termos são regidos pela lei brasileira. Este documento é preliminar e será revisado
        antes do lançamento comercial.
      </p>
    </LegalLayout>
  )
}
