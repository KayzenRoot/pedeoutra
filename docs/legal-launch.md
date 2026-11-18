# Legal e suporte para o lançamento comercial

Data: 2026-11-18
Status: **APROVADO PELO PROPRIETÁRIO / PARECER EXTERNO RECOMENDADO**
Este documento organiza decisões e pendências. Não substitui parecer jurídico
externo.

## 1. Dados oficiais

| Campo | Definido | Observação |
| --- | --- | --- |
| Razão social / nome empresarial | PedeOutra | — |
| CNPJ | 30.317.383/0001-97 | CNPJ informado; CPF não será publicado |
| Endereço comercial | **omitido** | Decisão do proprietário; a cláusula não aparece |
| E-mail de suporte | suporte@pedeoutra.com.br | Domínio ainda não registrado |
| E-mail de privacidade/titulares | admin@pedeoutra.com.br | Escolha do proprietário |
| Encarregado LGPD | Clayton | Canal: admin@pedeoutra.com.br |
| Data de atualização | 18/11/2026 | — |
| Aprovação dos documentos | **APROVADA PELO PROPRIETÁRIO** | Em 18/11/2026; sem parecer externo |

O domínio `pedeoutra.com.br` ainda não existe (NXDOMAIN). Os e-mails oficiais
foram publicados por decisão do proprietário, mas só receberão mensagens depois
do registro do domínio, DNS/MX e SMTP.

## 2. Onde preencher no código

Arquivo: `src/lib/launch-info.ts`

```ts
export const LAUNCH_INFO: LaunchInfo | null = {
  legalName: 'PedeOutra',
  taxId: '30.317.383/0001-97',
  supportEmail: 'suporte@pedeoutra.com.br',
  privacyEmail: 'admin@pedeoutra.com.br',
  updatedAt: '18/11/2026',
  legalReview: 'approved',
}
```

Estados possíveis:

- `LAUNCH_INFO = null`: “Documento preliminar”, aviso de MVP e de que o serviço
  não deve ser vendido. Coberto por `Legal.test.tsx`.
- `legalReview: 'pending'`: “Documento em revisão”, CNPJ e contatos visíveis,
  aviso de revisão jurídica mantido. Coberto por `Legal.pending.test.tsx`.
- `legalReview: 'approved'`: “Documento vigente” e “Aprovação do proprietário”.
  Estado atual, coberto por `Legal.configured.test.tsx`.

O campo `address` é opcional; quando ausente, `launchIdentity` não inclui a
cláusula de endereço. A landing usa a mesma fonte para mostrar CNPJ e suporte.

## 3. Checklist para parecer jurídico externo (recomendado)

### Termos de uso

- [ ] Objeto do serviço e limites (não é ERP, PDV, marketplace, logística,
      emissor fiscal, gateway dos pedidos ou bot de WhatsApp).
- [ ] Planos, preços, trial de 7 dias, renovação e cobrança recorrente.
- [ ] Profissional disponível a R$ 69,90/mês; troca de plano exige suporte.
- [ ] Cancelamento, reembolso e acesso após cancelamento.
- [ ] Responsabilidades do fornecedor sobre catálogo, preços, pedidos,
      entrega e documentos fiscais.
- [ ] Uso aceitável, suspensão e fraude.
- [ ] Disponibilidade, limitação de responsabilidade e ausência de SLA.
- [ ] Propriedade intelectual e uso da marca.
- [ ] Lei aplicável e foro.

### Aviso de privacidade (LGPD)

- [ ] Controlador e operador: PedeOutra é operador dos dados de clientes do
      fornecedor e controlador dos dados de conta/assinatura.
- [ ] Dados tratados, finalidades e bases legais.
- [ ] Compartilhamento com Supabase, Cloudflare e Asaas.
- [ ] Transferência internacional: Supabase em Ohio/EUA e demais operadores.
- [ ] Retenção e eliminação, incluindo obrigações legais.
- [ ] Direitos do titular e canal de atendimento.
- [ ] Encarregado de dados e forma de contato.
- [ ] Segurança, incidentes e comunicação.
- [ ] Cookies, analytics first-party e consentimento.
- [ ] Dados de compradores (nome/telefone) enviados pelo fornecedor.

### Negócio e fiscal

- [ ] Regime tributário e emissão de nota da assinatura.
- [ ] Contrato/termos com fornecedores e responsabilidade sobre pedidos.
- [ ] Política de reembolso compatível com o código: reembolso revoga o acesso
      pago; trial vigente não é estendido.
- [ ] Marca e domínio (INPI/Registro.br).
- [ ] Se WhatsApp oficial for ativado: termos e templates aprovados pela Meta.

## 4. Pontos de atenção já identificados

- O produto não recebe dados de cartão; a cobrança é hospedada pelo Asaas.
- O comprador não cria conta; o fornecedor é o controlador dos dados dele.
- Analytics é opcional, first-party, sem PII, com DNT/GPC e consentimento.
- O plano Profissional não tem trial; o Essencial tem 7 dias sem cartão.
- A API B2B e os webhooks são do Profissional e exigem chaves com escopo.
- O WhatsApp oficial está implementado, mas o envio segue desligado até WABA e
  templates aprovados.

## 5. Sequência para fechar a parte 3

1. ~~Proprietário define entidade, CNPJ, endereço, canais e encarregado.~~ Feito.
2. ~~Preencher `src/lib/launch-info.ts`.~~ Feito com `legalReview: 'approved'`.
3. ~~Rodar lint, typecheck, testes, build e SEO; abrir PR.~~ Feito.
4. Proprietário aprovou os documentos em 18/11/2026, sem parecer externo.
5. Parecer jurídico externo segue recomendado antes da primeira cobrança.
6. Avisos residuais de MVP removidos; primeira cobrança continua bloqueada
   por SMTP/domínio e pela decisão do proprietário.
7. Ativar domínio, DNS/MX e SMTP para os e-mails oficiais funcionarem.

## 6. Cobertura atual no código

- `src/lib/launch-info.ts` centraliza a identidade, os contatos, a formatação de
  CNPJ/CPF e a cláusula opcional de endereço.
- `src/pages/Legal.tsx` alterna entre preliminar, em revisão e vigente.
- `src/pages/Landing.tsx` usa a mesma fonte no rodapé.
- `src/pages/Legal.test.tsx`, `Legal.pending.test.tsx` e
  `Legal.configured.test.tsx` cobrem os três estados.
- `src/lib/launch-info.test.ts` cobre rótulo/formatação e endereço opcional.
