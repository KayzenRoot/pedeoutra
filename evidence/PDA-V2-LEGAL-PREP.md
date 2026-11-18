# PedeOutra — identidade legal publicada e aprovada

Data: 2026-11-18
Main: `681811b` (PRs [#104](https://github.com/KayzenRoot/pedeoutra/pull/104)
a [#109](https://github.com/KayzenRoot/pedeoutra/pull/109))
Veredito: **IDENTIDADE_PUBLICADA / APROVADA_PELO_PROPRIETÁRIO / COMMERCIAL_BLOCKED**

## Entregue

- `src/lib/launch-info.ts`: fonte única para razão social, CNPJ, endereço
  opcional, e-mails, data e estado da aprovação.
- Identidade publicada: PedeOutra, CNPJ `30.317.383/0001-97`,
  `suporte@pedeoutra.com.br` e `admin@pedeoutra.com.br`.
- O CPF informado anteriormente **não** foi publicado; o endereço foi omitido
  por decisão do proprietário e a cláusula não aparece.
- `legalReview: 'approved'` em 18/11/2026 por decisão do proprietário. As
  páginas mostram “Documento vigente” e “Aprovação do proprietário”.
- Não houve parecer jurídico externo; a revisão externa segue recomendada antes
  da primeira cobrança, com o checklist em `docs/legal-launch.md`.
- Termos com os dois planos e a troca sujeita a atendimento; landing e rodapé
  com CNPJ/suporte no lugar do aviso de MVP.
- Testes cobrem os três estados: preliminar, em revisão e aprovado; formatação
  de CNPJ/CPF e endereço opcional.

## Verificação de produção (2026-11-18)

- 8 rotas públicas: `/`, `/demo`, `/privacidade`, `/termos`, setor, `/entrar`,
  `/criar-conta` em 200 e rota inexistente em 404; **0 violações WCAG 2.1
  A/AA** em todas, desktop e mobile.
- `/termos` e `/privacidade`: “Documento vigente”, “Aprovação do proprietário”,
  CNPJ e contatos; sem CPF, sem endereço, sem “Documento em revisão” e sem MVP.
- Landing: 2 planos “Disponível”, CNPJ e suporte; sem “Em preparação” e sem MVP.
- `/app/assinatura` sem sessão redireciona para `/entrar?next=...`.
- `/app/assinatura` autenticada: botões “Assinar Essencial” e “Assinar
  Profissional”, 0 “Indisponível nesta fase”, axe 0; sessão encerrada com “Sair”.
- `create-checkout`, `change-plan` e `admin-api` sem token: 401.
- `/app/relatorios`: 200 com `x-robots-tag: noindex, nofollow`.
- Dados preservados: 1 organização, 1 produto, 1 pedido, 1 assinatura e
  1 admin; 1 usuário em `auth`. Nenhuma cobrança ou mutação real.
- Backup mais recente: run `44300162401`, success em `2026-11-18T12:03:33Z`.
- CI da `main`: o run do merge #109 falhou por “Data limit exceeded” no
  registry Docker; o rerun passou. Os demais runs da main estão verdes.

Screenshots: `evidence/screenshots/prod-termos-identidade.png` e
`prod-billing-professional.png`.

## Limites e pendências

- `pedeoutra.com.br` segue NXDOMAIN; os e-mails publicados só recebem mensagens
  depois de registro, DNS/MX e SMTP.
- Primeira cobrança real, SMTP e Supabase Pro continuam fora desta etapa.
- Parecer jurídico externo é recomendado antes da primeira cobrança; não foi
  executado.
