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

## Entrega

- [ ] Commit pequeno e legível na branch da WO.
- [ ] CI verde.
- [ ] PR revisável com resumo, testes, riscos e status real; Draft até autorização.
- [ ] Merge somente após auditoria e autorização (PR #12 autorizado em 13/11/2026).
- [ ] Nenhuma alegação de deploy/cobrança sem URL/teste reais.
