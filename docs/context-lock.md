# Context Lock

## Identificação

- Data do lock: 2026-11-12
- Repositório: `https://github.com/KayzenRoot/pedeoutra`
- Branch: `feat/PDA-MVP-WO-001-pedeoutra-mvp`
- Base SHA: `40990e437a455f161fd8c60f35be983f29209794`
- HEAD no fechamento: registrado em `evidence/PDA-MVP-WO-001.md`
- Work Order: `PDA-MVP-WO-001` (PDF, 12/11/2026)

## Issues verificadas (sem duplicatas)

PDA-001 a PDA-011 estavam abertas na base. Nenhuma issue foi criada ou
duplicada. Links: `https://github.com/KayzenRoot/pedeoutra/issues/<n>`.

## Hashes dos documentos canônicos (SHA-256)

| Arquivo | SHA-256 |
| --- | --- |
| `README.md` | `8e2c79c9394ce9dc34e15d4ebffb2589b1cadd2a4464b25c65ed0d9bf480d6d3` |
| `docs/architecture.md` | `ec63adb7d3d8dc85c08a076ca6d839c9a7e4cd30a77fc518aea804e62a20e365` |
| `docs/backlog.md` | `9f58ab2e6cf1e217e38083aa32be50783b4d9c3fe3cfdc76abeeceba217ea921` |
| `docs/decisions-ledger.md` | `54bde31b9f67b88687998ca93c9509b898dd8cd5a4497a2417fc6cde9f869fe9` |
| `docs/definition-of-done.md` | `254be49cb375fdc5d1618be2c9292329038bf41161b596e6c44e9bae2a02cf86` |
| `docs/deployment.md` | `51d68898ff1fe1613a518ba5601eb754d2e6f93d321f8a62b5a99b44f55f14ef` |
| `docs/project-overview.md` | `c8942184a0aef2cd67a3533866f64d06c374b784eaef324e1d904ec04d353496` |
| `docs/requirements.md` | `3afaa5ab2294d2169859f0db1f4c8ae8899759c5240470d1247440e23462c2c7` |
| `docs/scope.md` | `c29249118df01f474514024e27703a9e938144f288767fac527d88dc22137db8` |
| `docs/security.md` | `a55411169dfb5724cf4a7e1f32aadc248794377bf2802db3f574db1930af6494` |
| `docs/test-plan.md` | `76b03b3667ba14f247c97b064216e9fdf4af635d5bff736741bd0b2bc7b7c0f1` |

Hashes de migrations, Edge Functions e configuração crítica são recalculados
no fechamento (`scripts/context-lock.mjs`) e registrados no Evidence Bundle.

## Fontes externas verificadas

- Asaas Checkout recorrente: `POST /v3/checkouts`, header `access_token`,
  `billingTypes`/`chargeTypes`/`subscription`, resposta com `id` e `link`.
- Webhook Asaas: `POST`, header `asaas-access-token`, payload `id`/`event`/objeto.
- Idempotência: `provider_event_id` único, persistir antes de processar.
- Supabase RLS/Edge Functions e Cloudflare Pages: documentação oficial.

## Regra de staleness

Se qualquer fonte acima mudar durante a execução, marcar `STALE`, atualizar o
contexto e registrar a mudança antes de continuar. Não promover verdade
canônica sem auditoria.
