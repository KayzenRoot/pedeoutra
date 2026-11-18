# PedeOutra — checkout Profissional habilitado

Data: 2026-11-18
Main: `51f8338` (PRs [#100](https://github.com/KayzenRoot/pedeoutra/pull/100),
[#101](https://github.com/KayzenRoot/pedeoutra/pull/101) e
[#102](https://github.com/KayzenRoot/pedeoutra/pull/102))
Produção: `https://pedeoutra.pages.dev`
Veredito: **PROFISSIONAL DISPONÍVEL / COMMERCIAL_BLOCKED mantido**

## Mudança

- Secret de produção `PRO_PLAN_CHECKOUT_ENABLED` alterado de `false` para `true`.
- `plan-catalog` passou a retornar `professional` com `available=true` e
  `unavailable_reason=null`.
- Textos públicos que ainda diziam “Profissional em preparação”, “Parte 2/4” e
  “Parte 1/5” foram corrigidos na landing, billing e configurações.
- PR #101 removeu o aviso de trial que ainda dizia que o Profissional só seria
  liberado após a Parte 2/4; PR #102 esconde “Recursos previstos, ainda não
  contratáveis” quando o plano está disponível.
- O HTML pré-renderizado da landing passou de um selo “Disponível” para dois.
- Nenhuma migration, cobrança, e-mail, WhatsApp, crédito ou mutação de dados
  reais foi executada.

## Catálogo ao vivo

| Plano | Preço | Disponível | Recursos habilitados |
| --- | --- | --- | --- |
| Essencial | R$ 29,90/mês | sim | 15 |
| Profissional | R$ 69,90/mês | sim | 24 |

## Verificação no Chrome (produção)

Executada com Chrome headless, viewport desktop 1365×900 e mobile 390×844,
axe-core WCAG 2.1 A/AA.

| Rota | Status | axe |
| --- | --- | --- |
| `/` | 200 | 0 |
| `/demo` | 200 | 0 |
| `/privacidade` | 200 | 0 |
| `/termos` | 200 | 0 |
| `/setores/embalagens` | 200 | 0 |
| `/entrar` | 200 | 0 |
| `/criar-conta` | 200 | 0 |
| `/rota-inexistente` | 404 real | 0 |
| `/` mobile | 200 | 0 |

- Landing: 2 selos “Disponível”, 0 “Em preparação”, preços 29,90 e 69,90,
  CTA do Profissional apontando para `/criar-conta`.
- `/app/assinatura` sem sessão redireciona para
  `/entrar?next=%2Fapp%2Fassinatura`.
- `/app/assinatura` autenticada (magic link de admin, sem clicar em cobrança):
  2 cartões de plano, botões “Assinar Essencial por R$ 29,90/mês” e
  “Assinar Profissional por R$ 69,90/mês”, 0 “Indisponível nesta fase”,
  axe 0 e nenhum erro de página. Sessão encerrada com “Sair”.
- `create-checkout` e `change-plan` sem token retornam 401.
- `admin-api` sem token retorna 401.
- `/app/relatorios` responde 200 com `x-robots-tag: noindex, nofollow`.

Screenshots: `evidence/screenshots/prod-landing-plans.png`,
`prod-landing-mobile-plans.png` e `prod-billing-professional.png`.

## Regressão e CI

- Lint, typecheck, build, `test:seo` e smoke local com axe: PASS.
- Unitários: 161/161 em 34 arquivos.
- PR #100: 12 checks verdes, incluindo SonarCloud, DB/RLS, Edge typecheck,
  full-local E2E e Cloudflare Pages preview.
- PRs #101/#102: checks verdes e deploy automático do Pages.
- CI da `main` após os merges: success.

## Dados preservados

Leitura com `service_role`, sem alteração:

| Tabela | Contagem |
| --- | --- |
| `organizations` | 1 |
| `products` | 1 |
| `orders` | 1 |
| `subscriptions` | 1 (`expired`, `essential`) |
| `platform_admins` | 1 |
| usuários em `auth` | 1 |

A assinatura real continua `expired/essential`; o magic link usado na
verificação não criou usuário nem assinatura.

## Backup

Backup manual disparado após a verificação: run `44300162401`, success em
`2026-11-18T12:03:33Z`. O workflow diário continua agendado para 06:00 UTC;
o último run agendado observado foi `2026-11-17T15:29Z`, com atraso em relação
ao horário nominal — monitorar a regularidade do cron.

## Ainda bloqueado (inalterado)

- SMTP e domínio próprio: o proprietário fará depois do restante.
- Legal/suporte e revisão jurídica: último item da fila.
- Supabase Free/Ohio: manter até o limite de uso; upgrade após receita mínima.
- Primeira cobrança real: por último, com autorização explícita.
- WhatsApp oficial, growth/Meta Ads/DeepSeek/Resend, PITR e recompensa de
  indicação permanecem fora do go-live atual.
- Troca entre planos continua exigindo suporte (`PLAN_CHANGE_MODE=disabled`);
  nenhuma segunda recorrência é criada.
