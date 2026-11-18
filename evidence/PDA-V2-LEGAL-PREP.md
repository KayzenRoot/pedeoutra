# PedeOutra — preparação legal para lançamento

Data: 2026-11-18
Main: `bad959f` (PR [#104](https://github.com/KayzenRoot/pedeoutra/pull/104))
Veredito: **LEGAL_PREP_READY / DADOS_OFICIAIS_PENDENTES**

## Entregue

- `src/lib/launch-info.ts`: fonte única para razão social, CNPJ, endereço,
  e-mails de suporte/privacidade e data de revisão. Hoje `null`.
- `Legal.tsx`: alterna entre “Documento preliminar” e “Documento vigente”,
  mostra a identificação oficial e remove os avisos preliminares somente quando
  os dados existem.
- Termos corrigidos: Profissional disponível a R$ 69,90/mês; troca entre planos
  exige atendimento; removida a frase “em preparação/não pode ser contratado”.
- Landing, onboarding e FAQ trocaram “MVP” por “nesta versão” onde descrevia
  apenas o estado atual do produto.
- `docs/legal-launch.md`: checklist de revisão jurídica, dados necessários e
  sequência de fechamento.
- Testes novos cobrem os estados configurado e não configurado.

## Verificação

- lint, typecheck, build, SEO e smoke com axe: PASS.
- Unitários: 36 arquivos verdes.
- PR #104: checks verdes; CI da `main` success.
- Produção (`/termos`): 200, “Documento preliminar” presente, “R$ 69,90 por
  mês” presente, “em preparação” ausente.
- Chrome em produção: `/termos`, `/privacidade` e `/` com 0 violações WCAG 2.1
  A/AA; landing com 2 planos disponíveis.
- O rodapé da landing e das páginas legais continua com o aviso de MVP porque
  `LAUNCH_INFO` ainda é `null`.
- Nenhuma cobrança, e-mail, WhatsApp, crédito ou mutação de dados.

## Dados pendentes (bloqueiam o fechamento da parte 3)

| Campo | Status |
| --- | --- |
| Razão social / nome empresarial | PENDENTE |
| CNPJ ou MEI | PENDENTE |
| Endereço comercial completo | PENDENTE |
| E-mail de suporte | PENDENTE |
| E-mail de privacidade/titulares | PENDENTE |
| Encarregado LGPD (nome/canal) | PENDENTE |
| Data da revisão jurídica | PENDENTE |

## Próxima sequência

1. Proprietário fornece os dados acima.
2. Preencher `src/lib/launch-info.ts`.
3. Rodar verificação e abrir PR.
4. Advogado revisa `/termos` e `/privacidade` no preview.
5. Publicar; só então remover avisos residuais de MVP e liberar a primeira
   cobrança.
