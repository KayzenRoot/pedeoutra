# PedeOutra V2 — auditoria de produção (2026-11-16)

Main: `cf3b690`
Pages produção: `d5a49b04`
Escopo: rotas públicas, acessibilidade, catálogo real, gates de admin e RPCs.
Nenhuma cobrança, e-mail, WhatsApp, crédito ou mutação de dados foi executada.

## Rotas

| Rota | Resultado |
| --- | --- |
| `/` | 200 |
| `/app` | 200 |
| `/app/relatorios` | 200 + `X-Robots-Tag: noindex` |
| `/admin` | 200 |
| `/entrar` | 200 |
| `/c/*`, `/r/*`, `/acompanhar/*`, `/p/*`, `/o/*`, `/convite/*` | 200 (SPA) |
| `/rota-inexistente` | 404 real |
| `/demo/`, `/privacidade/`, `/setores/embalagens/` | 200 |

## Acessibilidade (axe-core, WCAG 2.1 A/AA)

Executado em produção com Chrome headless, viewport desktop 1365×900 e mobile
390×844:

- `/` — 0 violações
- `/demo` — 0 violações
- `/privacidade` — 0 violações
- `/termos` — 0 violações
- `/setores/embalagens` — 0 violações
- `/rota-inexistente` (404) — 0 violações
- `/app/relatorios` (shell não autenticado) — 0 violações
- `/admin` (shell não autenticado) — 0 violações
- `/` mobile — 0 violações

Correção aplicada: o link da marca tinha `aria-label` que omitia o texto
visível (“pediu uma vez? pede outra!”), causando
`label-content-name-mismatch` (WCAG 2.1). O label foi removido no modo normal;
o smoke local agora roda também `wcag21a`/`wcag21aa`.

## Backend e isolamento

- `plan-catalog` 200 com Essencial e Profissional.
- `public-catalog` 200 com a organização real e 1 produto.
- `admin-api` sem token: 401; sessão AAL1 real: 403 (AAL2 exigido).
- RPCs administrativas via service_role: overview 1, health 9, financial 17,
  analytics 5 linhas.
- Usuário real AAL1: `api_customer_insights_summary` retorna `plan_required`
  (trial expirado), sem mutação.
- Dados reais preservados: 1 organização, 1 produto, 1 pedido, 1 usuário,
  1 assinatura, 1 platform admin.

## Backup

- Backup manual verificado antes do deploy.
- Workflow diário criptografado testado no run `43908416616`; artefato
  decifrado e validado. Ver `PDA-V2-BACKUP-AUTOMATION.md`.

## Limites

- Auditoria autenticada completa de `/admin` e relatório com TOTP real depende
  do código do autenticador do proprietário; os gates AAL2 e DB foram
  verificados separadamente.
- GSC/Core Web Vitals de campo continuam `EXTERNAL_SETUP_REQUIRED`.
- SMTP, WABA/Meta, growth, PITR, legal/suporte e primeira cobrança real seguem
  bloqueados por credenciais/decisão.
