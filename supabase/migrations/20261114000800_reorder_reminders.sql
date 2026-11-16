-- PedeOutra V2 — lembretes de reposição com fallback manual (#45)
-- Envio automático continua desligado; o fornecedor só abre o wa.me após clique.

alter table public.organizations
  add column reorder_reminder_enabled boolean not null default false,
  add column reorder_reminder_channel text not null default 'manual', -- NOSONAR: valor de contrato do schema; migration imutável e coberta por DB/restore.
  add column reorder_reminder_frequency_days integer not null default 7;

alter table public.organizations
  add constraint organizations_reorder_reminder_channel_check
    check (reorder_reminder_channel in ('manual', 'whatsapp')),
  add constraint organizations_reorder_reminder_frequency_check
    check (reorder_reminder_frequency_days between 1 and 90);

alter table public.customers
  add column reorder_opt_in boolean not null default false,
  add column reorder_opt_out_at timestamptz;

create table public.reorder_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  channel text not null default 'manual',
  status text not null default 'suggested',
  cycle_key text not null,
  message text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint reorder_reminders_channel_check check (channel in ('manual', 'whatsapp')),
  constraint reorder_reminders_status_check check (
    status in ('suggested', 'manual_opened', 'sent', 'failed', 'opted_out')
  ),
  constraint reorder_reminders_cycle_len check (char_length(cycle_key) between 3 and 160),
  constraint reorder_reminders_message_len check (char_length(message) between 3 and 1000),
  constraint reorder_reminders_customer_fk foreign key (customer_id, organization_id)
    references public.customers(id, organization_id) on delete cascade,
  constraint reorder_reminders_unique unique (organization_id, customer_id, cycle_key, channel)
);

create index reorder_reminders_org_created_idx
  on public.reorder_reminders (organization_id, created_at desc);

alter table public.reorder_reminders enable row level security;

revoke all on public.reorder_reminders from anon, authenticated;

create policy reorder_reminders_select_own
  on public.reorder_reminders for select to authenticated
  using (app.has_org_permission(organization_id, 'orders.read'));

grant select on public.reorder_reminders to authenticated;
grant all on public.reorder_reminders to service_role;
