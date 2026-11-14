-- PedeOutra V2 — API B2B v1: credenciais por organização (#64/#65/#67)
-- Chaves são armazenadas apenas como SHA-256; o valor bruto aparece uma vez.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default array['catalog:read'],
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  constraint api_keys_name_len check (char_length(name) between 1 and 80),
  constraint api_keys_prefix_len check (char_length(key_prefix) between 4 and 16),
  constraint api_keys_hash_check check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint api_keys_status_check check (status in ('active', 'revoked')),
  constraint api_keys_scopes_check check (
    scopes <@ array['catalog:read', 'orders:read', 'customers:read']::text[]
    and array_length(scopes, 1) >= 1
  ),
  constraint api_keys_hash_unique unique (key_hash)
);

create index api_keys_org_idx
  on public.api_keys (organization_id, created_at desc);

alter table public.api_keys enable row level security;

revoke all on public.api_keys from anon, authenticated;
grant all on public.api_keys to service_role;
