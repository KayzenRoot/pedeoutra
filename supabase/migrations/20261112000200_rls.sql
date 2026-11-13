-- PedeOutra — RLS default-deny, grants mínimos e view segura (PDA-002/PDA-005)
-- Regra: anon não acessa tabela alguma; authenticated só o próprio tenant;
-- service_role (Edge Functions) é o único caminho para escritas públicas.

alter table public.organizations enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_events enable row level security;
alter table public.reorder_links enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema app from public, anon, authenticated;

grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy organizations_select_own
  on public.organizations for select to authenticated
  using (owner_user_id = auth.uid());

create policy organizations_update_own
  on public.organizations for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy products_select_own
  on public.products for select to authenticated
  using (app.is_org_owner(organization_id));

create policy products_insert_own
  on public.products for insert to authenticated
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy products_update_own
  on public.products for update to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy customers_select_own
  on public.customers for select to authenticated
  using (app.is_org_owner(organization_id));

create policy customers_insert_own
  on public.customers for insert to authenticated
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy customers_update_own
  on public.customers for update to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy orders_select_own
  on public.orders for select to authenticated
  using (app.is_org_owner(organization_id));

create policy orders_update_own
  on public.orders for update to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy order_items_select_own
  on public.order_items for select to authenticated
  using (app.is_org_owner(organization_id));

create policy order_status_events_select_own
  on public.order_status_events for select to authenticated
  using (app.is_org_owner(organization_id));

create policy reorder_links_select_own
  on public.reorder_links for select to authenticated
  using (app.is_org_owner(organization_id));

create policy subscriptions_select_own
  on public.subscriptions for select to authenticated
  using (app.is_org_owner(organization_id));

create policy audit_events_select_own
  on public.audit_events for select to authenticated
  using (app.is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Grants (colunas mínimas)
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant update (name, whatsapp, city) on public.organizations to authenticated;

grant select, insert, update on public.products to authenticated;

grant select, insert, update on public.customers to authenticated;

grant select on public.orders to authenticated;
grant update (status) on public.orders to authenticated;

grant select on public.order_items to authenticated;
grant select on public.order_status_events to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.audit_events to authenticated;

-- A view não contém token_hash e herda a RLS da tabela base (security_invoker).
-- O papel authenticated recebe SELECT apenas nas colunas seguras; token_hash
-- continua inacessível por grant e não aparece em nenhuma resposta.
create or replace view public.reorder_links_safe
with (security_invoker = true) as
select id, organization_id, customer_id, expires_at, revoked_at, last_used_at, created_at
from public.reorder_links;

revoke all on public.reorder_links_safe from anon, authenticated;
grant select on public.reorder_links_safe to authenticated;
grant select (id, organization_id, customer_id, expires_at, revoked_at, last_used_at, created_at)
  on public.reorder_links to authenticated;

-- Funções usadas em policies precisam de EXECUTE para o papel que consulta.
grant execute on function app.is_org_owner(uuid) to authenticated, service_role;
grant execute on function app.org_can_write(uuid) to authenticated, service_role;

-- Triggers rodam com os privilégios de quem executa o DML.
grant execute on function app.set_updated_at() to authenticated, service_role;
grant execute on function app.validate_order_status_transition() to authenticated, service_role;
grant execute on function app.log_order_status() to authenticated, service_role;

-- O backend confiável (Edge Functions) pode operar todas as tabelas.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Nenhum futuro objeto criado em public nasce exposto.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
