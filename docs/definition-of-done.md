# Definition of Done

Uma issue só é `DONE` quando todos os itens aplicáveis forem verdadeiros.

## Código

- [ ] Aceite da issue implementado, sem escopo FUTURE.
- [ ] Validação server-side para toda entrada nova.
- [ ] RLS/authorization aplicáveis, com teste.
- [ ] Sem segredo, token ou dado pessoal em log/bundle/repo.
- [ ] Migrations reproduzíveis e idempotentes no fluxo `db push`.
- [ ] Erros retornam mensagens úteis sem vazar detalhes internos.

## Testes

- [ ] Teste crítico proporcional ao risco.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`.
- [ ] `npm run test:db` quando schema/RLS/RPC muda.
- [ ] `npm run test:restore` quando schema/dados mudam.
- [ ] `deno check` das funções alteradas.
- [ ] Nenhum teste depende de credencial real.

## Documentação e evidência

- [ ] Docs canônicos atualizados se a decisão mudou.
- [ ] ADR/checkpoint proposto, não promovido sozinho.
- [ ] Comando, saída e exit code registrados no Evidence Bundle.
- [ ] Riscos, limitações e bloqueios declarados com precisão.

## Delta V2 — Parte 1/5

- [ ] Preço/plano/entitlement sempre validados no servidor, com teste negativo
  por Edge, PostgREST e banco.
- [ ] Admin exige UUID singleton + AAL2 no servidor, falha fechado sem
  `ADMIN_EMAIL` e registra auditoria de toda ação.
- [ ] Trial é idempotente por identidade e não pune sinal fraco sem revisão.
- [ ] Migration aditiva/backfill preserva assinatura, período e dados legados;
  restore sintético verde.
- [ ] Tema light/dark/system sem flash, com contraste e smoke desktop/mobile.
- [ ] Nenhum recurso Pro é vendido como disponível antes de implementação,
  teste e deploy; checkout Pro desativado por flag.
- [ ] ADRs e docs ficam PROPOSED até auditoria; nenhuma decisão APPROVED é
  sobrescrita.

## Entrega

- [ ] Commit pequeno e legível na branch da WO.
- [ ] CI verde.
- [ ] PR revisável com resumo, testes, riscos e status real; Draft até autorização.
- [ ] Merge somente após auditoria e autorização (PR #12 autorizado em 13/11/2026).
- [ ] Nenhuma alegação de deploy/cobrança sem URL/teste reais.
