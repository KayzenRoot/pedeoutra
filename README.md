# PedeOutra

MVP comercial de recompra B2B para pequenos distribuidores brasileiros.
O fornecedor publica um catálogo, recebe pedidos por link e oferece ao cliente
um link de recompra. O comprador não baixa app e não cria conta.

> `Pediu uma vez? Pede outra!`

## Estado da entrega

| Área | Estado |
| --- | --- |
| Aplicação web (landing, painel, catálogo, recompra) | implementada |
| Banco, migrations e RLS | implementados e testados em Postgres local |
| Edge Functions (pedido, recompra, billing) | implementadas; lógica testada com mocks |
| Asaas Sandbox | `PROD BLOCKED` — sem credenciais autorizadas |
| Deploy Cloudflare Pages/Supabase Cloud | `BLOCKED` — sem credenciais autorizadas |

Nenhuma URL de produção, cobrança real ou deploy é declarada sem evidência.
O bundle de evidências fica em [`evidence/PDA-MVP-WO-001.md`](evidence/PDA-MVP-WO-001.md).

## Source Hierarchy

Em caso de conflito, vale a ordem abaixo. Nível superior vence; mudança de
verdade canônica exige ADR/checkpoint, não edição silenciosa.

1. Work Order `PDA-MVP-WO-001` (PDF de origem, 12/11/2026).
2. `docs/` canônico (`requirements`, `scope`, `architecture`, `security`, `test-plan`).
3. `supabase/migrations/` (schema e políticas efetivamente aplicados).
4. Código, testes e CI.
5. Este README.

O contexto de execução e os hashes estão em [`docs/context-lock.md`](docs/context-lock.md).

## Stack

- React + Vite + TypeScript, mobile-first, CSS moderno sem design system pesado.
- Supabase PostgreSQL + Auth; RLS default-deny.
- Supabase Edge Functions para operações privilegiadas e APIs públicas.
- Asaas Checkout de assinatura recorrente (sandbox), via Edge Functions.
- GitHub Actions para lint, typecheck, testes, build, RLS e Edge Functions.
- Cloudflare Pages como alvo de hospedagem do frontend.

## Rodar localmente

Pré-requisitos: Node.js 22+, npm e Docker (para testes de banco).

```bash
npm ci
cp .env.example .env.local   # preencha somente se tiver um projeto Supabase
npm run dev
```

Sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, a aplicação sobe em modo
demonstração: landing, catálogo fictício e páginas legais funcionam; login e
painel informam que o backend não está configurado.

Para subir o Supabase local completo:

```bash
supabase start
supabase db reset
supabase functions serve --env-file supabase/functions/.env.local
```

As variáveis de Edge Functions nunca vão para o navegador. Veja
[`docs/deployment.md`](docs/deployment.md) e [`.env.example`](.env.example).

## Verificações

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:db         # Postgres real em Docker: migrations + RLS A/B + RPCs
npm run test:postgrest  # HTTP real via PostgREST: RPC, RLS e status
npm run test:restore    # dump/restore em dados sintéticos
npm run test:edge       # typecheck das Edge Functions (Deno)
npm run test:edge-http  # handlers Deno reais contra PostgREST (auth stub)
npm run smoke:preview   # smoke do build (browser headless ou HTTP)
npm run verify          # lint + typecheck + unit + build + smoke
```

## Segurança em uma frase

Dados de negócio são isolados por RLS; APIs públicas só devolvem dados
estritamente públicos; tokens de recompra são opacos, armazenados em hash e
revogáveis; acesso pago só é liberado por evento de pagamento validado no
servidor. Detalhes em [`docs/security.md`](docs/security.md).

## Issues

O trabalho segue as issues já publicadas em
[KayzenRoot/pedeoutra/issues](https://github.com/KayzenRoot/pedeoutra/issues):
PDA-001 a PDA-011. Nenhuma issue duplicada foi criada.

## Licença e marca

Código sem licença de distribuição definida nesta WO. A marca `PedeOutra` e o
domínio permanecem sujeitos a verificação no INPI/Registro.br; nada nesta
entrega concede uso de marca.
