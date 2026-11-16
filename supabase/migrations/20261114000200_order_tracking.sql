-- PedeOutra V2 — acompanhamento de pedido por link opaco (PDA-VALUE-007 / #50)
-- Token puro nunca é armazenado; somente SHA-256, TTL e revogação.

create table public.order_tracking_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  order_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_tracking_links_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint order_tracking_links_expiry_check check (expires_at > created_at),
  constraint order_tracking_links_token_unique unique (token_hash),
  constraint order_tracking_links_order_fk foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete cascade
);

create index order_tracking_links_org_order_idx
  on public.order_tracking_links (organization_id, order_id, created_at desc);

create unique index order_tracking_links_one_active_idx
  on public.order_tracking_links (order_id)
  where revoked_at is null;

alter table public.order_tracking_links enable row level security;
revoke all on public.order_tracking_links from anon, authenticated;
grant all on public.order_tracking_links to service_role;
