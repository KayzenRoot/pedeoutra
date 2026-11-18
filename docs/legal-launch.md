# Legal e suporte para o lançamento comercial

Data: 2026-11-18
Status: **PREPARAÇÃO — nenhum dado oficial preenchido**
Este documento organiza o que falta e onde preencher. Não substitui parecer
jurídico humano.

## 1. Dados que só o proprietário pode definir

| Campo | Exemplo | Onde aparece |
| --- | --- | --- |
| Razão social / nome empresarial | PedeOutra Tecnologia Ltda. | Termos, privacidade, rodapé |
| CNPJ ou MEI | 00.000.000/0001-00 | Termos, privacidade, rodapé |
| Endereço comercial completo | Rua, número, complemento, bairro, cidade/UF, CEP | Termos, privacidade |
| E-mail de suporte | suporte@pedeoutra.com.br | Termos, landing, suporte |
| E-mail de privacidade/titulares | privacidade@pedeoutra.com.br | Aviso de privacidade |
| Encarregado LGPD (nome/canal) | proprietário ou terceiro | Aviso de privacidade |
| Data da revisão jurídica | 18/11/2026 | Cabeçalho dos documentos |

Definir também se os e-mails usarão domínio próprio. Hoje o produto está em
`pedeoutra.pages.dev` e o SMTP ainda não está configurado.

## 2. Onde preencher no código

Arquivo: `src/lib/launch-info.ts`

```ts
export const LAUNCH_INFO: LaunchInfo | null = {
  legalName: '...',
  taxId: '...',
  address: '...',
  supportEmail: '...',
  privacyEmail: '...',
  updatedAt: 'DD/MM/AAAA',
}
```

Enquanto `LAUNCH_INFO` for `null`:

- `/termos` e `/privacidade` continuam com “Documento preliminar” e o aviso de
  que o serviço não deve ser vendido.
- A landing continua com o aviso de MVP em validação.
- A frase que dizia que o Profissional estava em preparação já foi corrigida;
  os dois planos aparecem como disponíveis.

Quando preenchido:

- Os documentos passam a “Documento vigente”.
- Razão social, CNPJ, endereço e canais aparecem nos dois documentos.
- O rodapé da landing troca o aviso de MVP pela identificação oficial.
- O aviso de revisão jurídica pendente desaparece.

## 3. Checklist de revisão jurídica humana

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

1. Proprietário define entidade, CNPJ, endereço, canais e encarregado.
2. Preencher `src/lib/launch-info.ts`.
3. Rodar lint, typecheck, testes, build e SEO; abrir PR.
4. Advogado revisa `/termos` e `/privacidade` no preview do Pages.
5. Aplicar ajustes finais e publicar.
6. Só então remover avisos residuais de MVP e liberar a primeira cobrança.

## 6. Cobertura atual no código

- `src/lib/launch-info.ts` centraliza a identidade e os contatos.
- `src/pages/Legal.tsx` alterna entre documento preliminar e vigente.
- `src/pages/Landing.tsx` usa a mesma fonte no rodapé.
- `src/pages/Legal.test.tsx` e `Legal.configured.test.tsx` cobrem os dois
  estados.
