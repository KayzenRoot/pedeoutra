# Decisions Ledger

Status: `APPROVED` = decidido pela Work Order ou auditoria autorizada;
`PROPOSED` = implementado nesta WO, aguardando promoção; `SUPERSEDED` = substituído.

## ADR PDA-ADR-001 — Stack do MVP

**Status:** APPROVED (Work Order, seção 4)
**Data:** 2026-11-12
**Contexto:** MVP de baixo custo, time pequeno, multi-tenant, pagamento recorrente.
**Decisão:** React + Vite + TypeScript; CSS moderno; Supabase PostgreSQL/Auth;
Edge Functions para operações privilegiadas; Cloudflare Pages; Asaas Checkout
recorrente; GitHub Actions.
**Consequências:** menos serviços, RLS no banco, funções como fronteira de
confiança; dependência de Supabase/Asaas/Cloudflare e seus limites de plano.
**Alternativas rejeitadas:** Vercel Hobby para SaaS pago; backend próprio;
gateway de pagamento dos pedidos B2B (fora de escopo).

## ADR PDA-ADR-002 — Cobrança e liberação de acesso

**Status:** APPROVED (requisitos de segurança da Work Order, seções 7 e 8)
**Data:** 2026-11-12
**Contexto:** acesso pago não pode depender de callback do navegador.
**Decisão:** checkout hospedado Asaas; assinatura só ativa com evento de
pagamento validado (token do webhook, valor, tenant, assinatura e estado);
`provider_event_id` único; estados `pending|active|past_due|canceled|expired|refunded`;
reembolso revoga; evento atrasado não reativa; reconciliação separada.
**Consequências:** exige credenciais e webhook público; sem elas, billing fica
`PROD BLOCKED`. Nenhum dado de cartão no PedeOutra.

## ADR PDA-ADR-003 — APIs públicas exclusivamente via Edge Functions

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** reduzir superfície de exposição de tabelas e evitar policies
públicas frágeis.
**Decisão:** `anon` não recebe grant em tabelas; catálogo, pedido e recompra
passam por funções que usam `service_role` no servidor e devolvem DTOs mínimos.
**Consequências:** mais uma camada de código; testes de handler e RPC
obrigatórios. PostgREST segue usado apenas pelo fornecedor autenticado.

## ADR PDA-ADR-004 — CSS moderno em vez de Tailwind

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** WO permite Tailwind ou CSS moderno; evitar design system pesado.
**Decisão:** CSS com custom properties e componentes pequenos.
**Consequências:** menos dependências e build simples; exige disciplina de
nomenclatura e revisão visual.

## ADR PDA-ADR-005 — Máquina de estados de pedido no banco

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** impedir transições inválidas mesmo se o frontend for contornado.
**Decisão:** trigger valida `new → confirmed|canceled`, `confirmed → completed|canceled`;
cada transição grava `order_status_events` com autor e horário.
**Consequências:** regra única no banco; UI apenas reflete as opções válidas.

## ADR PDA-ADR-006 — Recompra por token opaco com hash

**Status:** PROPOSED
**Data:** 2026-11-12
**Contexto:** link de recompra não pode virar credencial permanente nem expor PII.
**Decisão:** 32 bytes CSPRNG, SHA-256 no banco, TTL 60 dias, revogação, rate
limit, template com IDs/quantidades; preço atual recalculado no servidor.
**Consequências:** token só aparece uma vez; perda exige novo link; sem dados
do cliente na página.

## ADR PDA-ADR-007 — Região e plano do Supabase no lançamento

**Status:** APPROVED (decisão de lançamento, 2026-11-13)
**Contexto:** o projeto `waygtbclkxklexnabwvj` está em East US/Ohio; o lançamento
inicial usa `pedeoutra.pages.dev`, sem domínio próprio, e a migração para São
Paulo/Pro exigiria custo recorrente e recriação de chaves, Auth, secrets, Edge
Functions e webhook.
**Decisão:** manter East US/Ohio e Supabase Free no lançamento, com keepalive
diário via GitHub Actions e risco de pausa/backup aceito explicitamente.
Reavaliar Pro e `sa-east-1` quando houver os primeiros clientes pagantes ou
antes de aumentar o volume.
**Consequências:** latência maior, risco de pausa por inatividade e ausência de
backups de produção; o keepalive reduz o risco, mas não garante disponibilidade.
**Alternativas rejeitadas:** migrar agora sem domínio/cobrança real; manter Free
indefinidamente com crescimento e pagantes.

## ADR PDA-ADR-008 — Asaas produção configurado

**Status:** APPROVED (13/11/2026)
**Contexto:** a conta de produção foi aprovada; o staging já validou checkout,
webhook, idempotência e estados de billing no Sandbox.
**Decisão:** usar API key/base URLs de produção, webhook exclusivo com 13 eventos
e o mesmo código de Edge Functions. Validar com checkout de produção sem
pagamento; a primeira cobrança real exige autorização explícita.
**Consequências:** produção pronta para teste controlado, sem dinheiro real
movimentado; Sandbox removido. Domínio não é requisito da fase; backup
(ADR-009 PROPOSED), SMTP, suporte/legal e auditoria continuam gates do go-live
comercial.

## ADR PDA-ADR-009 — Backup e continuidade para lançamento pago (PROPOSED)

**Status:** PROPOSED (não substitui a ADR-007 aprovada; exige aceite do proprietário)
**Data:** 2026-11-13
**Contexto:** a ADR-007 aceita Free/Ohio no lançamento, mas o Free não tem
backup automático nem PITR. O restore sintético prova a capacidade de
exportação/restauração, não garante backup contínuo de produção. A decisão
precisa equilibrar custo, RPO/RTO, residência de dados e continuidade.
**Decisão proposta:** antes do primeiro cliente pagante, contratar Supabase Pro
em Ohio (US$ 25/mês, backup diário com retenção de 7 dias) e manter export
manual periódico off-site. PITR (US$ 100/mês por 7 dias, RPO de até 2 minutos)
fica opcional após receita. Migrar para `sa-east-1` apenas com decisão de
latência/residência e janela aprovada.
**Consequências:** custo recorrente mínimo de US$ 25/mês; RPO de até 24h com
backup diário e RTO dependente do tamanho do banco (meta operacional de 1–2h);
dados em Ohio exigem avaliação de transferência internacional/LGPD. Sem Pro ou
sem export off-site aceito formalmente, o lançamento pago permanece
`GO_LIVE_BLOCKED`.
**Alternativas:** Free + export manual somente (RPO alto, não recomendado para
pagantes); Pro + PITR (maior custo, menor RPO); Pro em `sa-east-1` (melhor
latência, exige migração e reconfiguração).

## ADR PDA-ADR-010 — Catálogo de dois planos e entitlements server-side (PROPOSED)

**Status:** PROPOSED (Parte 1/5; não substitui a ADR-002, que permanece válida
para a cobrança validada por evento)
**Data:** 2026-11-13
**Contexto:** o MVP tinha um plano único de R$ 29,90 fixado em constante de
código. A V2 exige Essencial e Profissional, com preços, limites e recursos
definidos no servidor, sem confiar em `plan_code`, preço ou callback do
navegador.
**Decisão proposta:** `plan_catalog` versionado (`plan_code`,
`plan_version`, `price_cents`, `currency`, `trial_days`, `active`) e
`plan_feature_entitlements` (`feature_key`, limite e janela). A assinatura
guarda `plan_code`/`plan_version`; contas legadas de R$ 29,90 e trials viram
`essential` sem perder período, dados ou histórico. `app.assert_entitlement`
e `app.consume_quota` são a fonte de verdade server-side; flags de UI são apenas
ergonomia. Downgrade/expiração revoga novas ações premium, mas preserva leitura
do histórico e não apaga registros. Nenhum backfill cobra, cancela ou chama o
Asaas.
**Consequências:** toda feature premium precisa de feature key e teste negativo
(Edge/PostgREST/DB); o Profissional só é liberado após pagamento de 6990
confirmado e reconciliado; a matriz comercial fica em ADR/requirements e não no
frontend.

## ADR PDA-ADR-011 — Superadministrador singleton com UUID e AAL2 (PROPOSED)

**Status:** PROPOSED
**Data:** 2026-11-13
**Contexto:** a operadora precisa de um console global, mas um admin extraído
de e-mail, `user_metadata` ou JWT editável seria elevação de privilégio. Ainda
não há e-mail de admin fornecido pelo proprietário.
**Decisão proposta:** tabela privada `platform_admins` singleton com
`user_id uuid references auth.users(id)` único; bootstrap server-side exige,
cumulativamente, `ADMIN_EMAIL` configurado no ambiente, token de bootstrap
dedicado, usuário autenticado com o UUID/e-mail correspondente e sessão AAL2
(TOTP). Endpoints `/admin` revalidam UUID + `aal=aal2` no servidor em toda
leitura/escrita, usam `service_role` apenas na Edge Function e registram
auditoria com ator, ação, motivo e timestamp. Sem `ADMIN_EMAIL`, o bootstrap e o
console falham fechados (`ADMIN_BOOTSTRAP_BLOCKED`).
**Consequências:** não existe promoção por e-mail isolado nem segundo admin;
revogação remove o acesso no próximo request; o console não compartilha token
com fornecedores e não expõe PII de compradores.

## ADR PDA-ADR-012 — Antifraude de trial proporcional (PROPOSED)

**Status:** PROPOSED
**Data:** 2026-11-13
**Contexto:** o trial de 7 dias precisa ser idempotente e resistente a recriação
de conta, sem transformar IP, aparelho ou telefone não verificado em veto
permanente.
**Decisão proposta:** `trial_grants` imutável por `organization_id` e
`user_id`, concedido apenas no servidor dentro de `create_organization`; um
mesmo usuário não reinicia o trial recriando organização. Sinais de contato
(e-mail/telefone/CNPJ) são normalizados e guardados como HMAC-SHA-256 com
segredo server-side e retenção mínima; repetição gera `review_required` e
fila de revisão no admin, não bloqueio automático definitivo. Apenas
identificador realmente verificado pode fundamentar bloqueio definitivo.
IP/dispositivo são sinais fracos, não prova. Toda suspensão/reativação é
auditada e o fornecedor pode contestar.
**Consequências:** falsos positivos preservam o trial até revisão manual;
nenhum fingerprint invasivo, CPF ou SMS pago é coletado; legado mantém o trial
vigente.

## ADR PDA-ADR-013 — Transição entre planos e limite do Asaas (PROPOSED)

**Status:** PROPOSED
**Data:** 2026-11-13
**Contexto:** assinaturas de cartão do Asaas podem não permitir editar valor ou
vencimento. Criar uma segunda recorrência sem encerrar a primeira pode gerar
cobrança dupla.
**Decisão proposta:** a troca de plano é registrada em `plan_changes` e só
produz efeito após pagamento confirmado do novo valor, no próximo ciclo, sem
prorrateamento automático. O acesso do período já pago é preservado. Enquanto
não houver caminho comprovado no provedor para editar/substituir a assinatura
sem sobreposição, a Edge Function bloqueia a troca automática
(`409 plan_change_requires_support`) e orienta suporte humano; nunca cria duas
recorrências. O checkout Profissional permanece desativado por flag até a
funcionalidade real da Parte 2/4 estar pronta e auditada.
**Consequências:** nenhuma cobrança real é feita nesta WO; upgrade/downgrade
têm contrato e testes de decisão, mas a mutação no provedor fica explicitamente
bloqueada até validação em sandbox/autorização específica.

## ADR PDA-ADR-014 — Categorias e mídia de produto com Storage privado (PROPOSED)

**Status:** PROPOSED (Parte 2/5; depende da Parte 1 ativa)
**Data:** 2026-11-13
**Contexto:** o catálogo precisa de categorias ordenáveis e fotos sem expor
objetos privados entre tenants, sem depender de transformação paga e sem
aceitar SVG/arquivo ativo.
**Decisão proposta:** categorias são linhas por organização, opcionais e
ordenáveis; produtos antigos permanecem sem categoria. Fotos ficam em bucket
privado `product-images`, acessado apenas por Edge Function com `service_role`;
o upload valida tenant, produto, tamanho, MIME real por magic bytes
(JPEG/PNG/WebP) e rejeita SVG. O navegador gera uma miniatura local; a Edge
grava imagem + thumb e o metadado em `product_images`. O catálogo público
recebe apenas URLs assinadas e de curta duração para imagens de produtos
ativos; produto inativo ou imagem órfã não é servido. Limites iniciais: 5 MB
por imagem, 1 MB por thumb, até 8 imagens por produto.
**Consequências:** não há policy de Storage para `anon/authenticated`; todo
acesso passa pela Edge. Excluir imagem remove metadado e objetos; órfãos são
tratados por rotina administrativa. Custo de Storage Free é monitorado e não
há transformação paga.
