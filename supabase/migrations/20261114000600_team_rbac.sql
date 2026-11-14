-- PedeOutra V2 — equipe, RBAC e convites manuais (#58)
-- SMTP não é necessário para o convite: o owner copia um link opaco.
-- Nenhum membro vira owner ou superadmin por payload.

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null,
  status text not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint organization_memberships_role_check check (
    role in ('owner', 'manager', 'operator', 'viewer')
  ),
  constraint organization_memberships_status_check check (
    status in ('active', 'revoked')
  ),
  constraint organization_memberships_email_len check (email = '' or char_length(email) between 3 and 254),
  constraint organization_memberships_unique unique (organization_id, user_id)
);

create unique index organization_memberships_one_active_idx
  on public.organization_memberships (user_id)
  where status = 'active';

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function app.set_updated_at();

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organization_invitations_role_check check (
    role in ('manager', 'operator', 'viewer')
  ),
  constraint organization_invitations_email_len check (char_length(email) between 3 and 254),
  constraint organization_invitations_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint organization_invitations_expiry_check check (expires_at > created_at),
  constraint organization_invitations_token_unique unique (token_hash)
);

create unique index organization_invitations_one_active_idx
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create or replace function app.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  select coalesce(lower(u.email), '') into v_email
    from auth.users u where u.id = new.owner_user_id;
  insert into public.organization_memberships (
    organization_id, user_id, email, role, status
  ) values (
    new.id, new.owner_user_id, coalesce(v_email, ''), 'owner', 'active'
  )
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

create trigger organizations_add_owner_membership
  after insert on public.organizations
  for each row execute function app.add_owner_membership();

create or replace function app.protect_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'owner' and not exists (
      select 1 from public.organizations o
       where o.id = new.organization_id and o.owner_user_id = new.user_id
    ) then
      raise exception 'owner_membership_forbidden' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.role = 'owner' then
    if new.role <> 'owner' or new.status <> 'active' then
      raise exception 'owner_membership_protected' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger organization_memberships_protect_owner
  before insert or update or delete on public.organization_memberships
  for each row execute function app.protect_owner_membership();

insert into public.organization_memberships (
  organization_id, user_id, email, role, status
)
select o.id, o.owner_user_id, coalesce(lower(u.email), ''), 'owner', 'active'
  from public.organizations o
  join auth.users u on u.id = o.owner_user_id
on conflict (organization_id, user_id) do nothing;

create or replace function app.org_role_for(
  p_organization_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when o.owner_user_id = p_user_id then 'owner'
    else m.role
  end
  from public.organizations o
  left join public.organization_memberships m
    on m.organization_id = o.id
   and m.user_id = p_user_id
   and m.status = 'active'
  where o.id = p_organization_id
$$;

create or replace function app.org_role(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.org_role_for(p_organization_id, auth.uid())
$$;

create or replace function app.role_has_permission(p_role text, p_permission text)
returns boolean
language sql
immutable
as $$
  select case p_role
    when 'owner' then true
    when 'manager' then p_permission = any(array[
      'catalog.read', 'catalog.write',
      'customers.read', 'customers.write',
      'orders.read', 'orders.write',
      'pricing.read', 'pricing.write',
      'quotes.read', 'quotes.write',
      'reports.read',
      'whatsapp.read', 'whatsapp.write',
      'team.read'
    ])
    when 'operator' then p_permission = any(array[
      'catalog.read',
      'customers.read', 'customers.write',
      'orders.read', 'orders.write',
      'pricing.read',
      'quotes.read',
      'reports.read',
      'whatsapp.read'
    ])
    when 'viewer' then p_permission = any(array[
      'catalog.read', 'customers.read', 'orders.read',
      'pricing.read', 'quotes.read', 'reports.read'
    ])
    else false
  end
$$;

create or replace function app.has_org_permission_for(
  p_organization_id uuid,
  p_user_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.role_has_permission(
    app.org_role_for(p_organization_id, p_user_id), p_permission
  )
$$;

create or replace function app.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.org_role(p_organization_id) is not null
$$;

create or replace function app.has_org_permission(
  p_organization_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.role_has_permission(app.org_role(p_organization_id), p_permission)
$$;

-- ---------------------------------------------------------------------------
-- Convites e gestão de membros.
-- ---------------------------------------------------------------------------
create or replace function app.create_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_role text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_count integer;
  v_invitation_id uuid;
begin
  if not app.has_org_permission_for(p_organization_id, p_actor_user_id, 'team.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.has_entitlement(p_organization_id, 'team') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'operator', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_invitation_token' using errcode = '22023';
  end if;
  if p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '30 days' then
    raise exception 'invalid_invitation_expiry' using errcode = '22023';
  end if;

  select count(*)::integer into v_count
    from public.organization_memberships m
   where m.organization_id = p_organization_id and m.status = 'active';
  select v_count + count(*)::integer into v_count
    from public.organization_invitations i
   where i.organization_id = p_organization_id
     and i.accepted_at is null
     and i.revoked_at is null
     and i.expires_at > now();
  if v_count >= 3 then
    raise exception 'team_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, expires_at, invited_by
  ) values (
    p_organization_id, v_email, p_role, p_token_hash, p_expires_at, p_actor_user_id
  )
  returning id into v_invitation_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'team.invite_created', 'organization_invitation',
    v_invitation_id, jsonb_build_object('role', p_role, 'email_domain', split_part(v_email, '@', 2))
  );

  return query select v_invitation_id, p_expires_at;
end;
$$;

create or replace function app.accept_invitation(
  p_token_hash text,
  p_actor_user_id uuid
)
returns table (organization_id uuid, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.organization_invitations;
  v_email text;
  v_confirmed timestamptz;
begin
  if p_actor_user_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select lower(u.email), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u where u.id = p_actor_user_id;
  if v_email is null or v_confirmed is null then
    raise exception 'email_not_verified' using errcode = '42501';
  end if;

  select * into v_invitation
    from public.organization_invitations i
   where i.token_hash = p_token_hash
   for update;
  if not found
     or v_invitation.accepted_at is not null
     or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() then
    raise exception 'invitation_unavailable' using errcode = 'P0002';
  end if;
  if v_invitation.email <> v_email then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;
  if not app.has_entitlement(v_invitation.organization_id, 'team') then
    raise exception 'plan_required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.organization_memberships m
     where m.user_id = p_actor_user_id and m.status = 'active'
  ) then
    raise exception 'already_in_team' using errcode = 'P0001';
  end if;

  insert into public.organization_memberships (
    organization_id, user_id, email, role, status, invited_by
  ) values (
    v_invitation.organization_id, p_actor_user_id, v_email,
    v_invitation.role, 'active', v_invitation.invited_by
  );

  update public.organization_invitations
     set accepted_at = now(), accepted_by = p_actor_user_id
   where id = v_invitation.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id, metadata
  ) values (
    v_invitation.organization_id, p_actor_user_id, 'team.invite_accepted',
    'organization_membership', p_actor_user_id,
    jsonb_build_object('role', v_invitation.role)
  );

  return query select v_invitation.organization_id, v_invitation.role;
end;
$$;

create or replace function app.change_member_role(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_role text
)
returns table (membership_id uuid, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.organization_memberships;
begin
  if not app.has_org_permission_for(p_organization_id, p_actor_user_id, 'team.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'operator', 'viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  select * into v_member
    from public.organization_memberships m
   where m.id = p_membership_id
     and m.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if v_member.role = 'owner' then
    raise exception 'owner_membership_protected' using errcode = '42501';
  end if;
  update public.organization_memberships
     set role = p_role, updated_at = now()
   where id = p_membership_id;
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'team.role_changed',
    'organization_membership', p_membership_id,
    jsonb_build_object('from', v_member.role, 'to', p_role)
  );
  return query select p_membership_id, p_role;
end;
$$;

create or replace function app.revoke_member(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid
)
returns table (membership_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.organization_memberships;
begin
  if not app.has_org_permission_for(p_organization_id, p_actor_user_id, 'team.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_member
    from public.organization_memberships m
   where m.id = p_membership_id
     and m.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if v_member.role = 'owner' then
    raise exception 'owner_membership_protected' using errcode = '42501';
  end if;
  update public.organization_memberships
     set status = 'revoked', revoked_at = now(), updated_at = now()
   where id = p_membership_id;
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'team.member_revoked',
    'organization_membership', p_membership_id,
    jsonb_build_object('role', v_member.role)
  );
  return query select p_membership_id, 'revoked'::text;
end;
$$;

create or replace function app.revoke_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_invitation_id uuid
)
returns table (invitation_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.has_org_permission_for(p_organization_id, p_actor_user_id, 'team.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organization_invitations
     set revoked_at = now()
   where id = p_invitation_id
     and organization_id = p_organization_id
     and accepted_at is null
     and revoked_at is null;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity, entity_id
  ) values (
    p_organization_id, p_actor_user_id, 'team.invite_revoked',
    'organization_invitation', p_invitation_id
  );
  return query select p_invitation_id, 'revoked'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS por permissão. Billing, settings e owner continuam exclusivos do owner.
-- ---------------------------------------------------------------------------
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;

revoke all on public.organization_memberships from anon, authenticated;
revoke all on public.organization_invitations from anon, authenticated;

create policy organization_memberships_select_self_or_owner
  on public.organization_memberships for select to authenticated
  using (user_id = auth.uid() or app.is_org_owner(organization_id));

grant select on public.organization_memberships to authenticated;
grant all on public.organization_memberships to service_role;
grant all on public.organization_invitations to service_role;

alter policy organizations_select_own on public.organizations
  using (app.is_org_member(id));

alter policy products_select_own on public.products
  using (app.has_org_permission(organization_id, 'catalog.read'));
alter policy products_insert_own on public.products
  with check (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));
alter policy products_update_own on public.products
  using (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id))
  with check (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));

alter policy product_categories_select_own on public.product_categories
  using (app.has_org_permission(organization_id, 'catalog.read'));
alter policy product_categories_insert_own on public.product_categories
  with check (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));
alter policy product_categories_update_own on public.product_categories
  using (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id))
  with check (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));
alter policy product_categories_delete_own on public.product_categories
  using (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));

alter policy product_images_select_own on public.product_images
  using (app.has_org_permission(organization_id, 'catalog.read'));
alter policy product_images_insert_own on public.product_images
  with check (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));
alter policy product_images_update_own on public.product_images
  using (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id))
  with check (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));
alter policy product_images_delete_own on public.product_images
  using (app.has_org_permission(organization_id, 'catalog.write') and app.org_can_write(organization_id));

alter policy customers_select_own on public.customers
  using (app.has_org_permission(organization_id, 'customers.read'));
alter policy customers_insert_own on public.customers
  with check (app.has_org_permission(organization_id, 'customers.write') and app.org_can_write(organization_id));
alter policy customers_update_own on public.customers
  using (app.has_org_permission(organization_id, 'customers.write') and app.org_can_write(organization_id))
  with check (app.has_org_permission(organization_id, 'customers.write') and app.org_can_write(organization_id));

alter policy orders_select_own on public.orders
  using (app.has_org_permission(organization_id, 'orders.read'));
alter policy orders_update_own on public.orders
  using (app.has_org_permission(organization_id, 'orders.write') and app.org_can_write(organization_id))
  with check (app.has_org_permission(organization_id, 'orders.write') and app.org_can_write(organization_id));
alter policy order_items_select_own on public.order_items
  using (app.has_org_permission(organization_id, 'orders.read'));
alter policy order_status_events_select_own on public.order_status_events
  using (app.has_org_permission(organization_id, 'orders.read'));
alter policy reorder_links_select_own on public.reorder_links
  using (app.has_org_permission(organization_id, 'orders.read'));

alter policy price_lists_select_own on public.price_lists
  using (app.has_org_permission(organization_id, 'pricing.read'));
alter policy price_lists_write_own on public.price_lists
  using (app.has_org_permission(organization_id, 'pricing.write') and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id))
  with check (app.has_org_permission(organization_id, 'pricing.write') and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id));
alter policy price_list_items_select_own on public.price_list_items
  using (app.has_org_permission(organization_id, 'pricing.read'));
alter policy price_list_items_write_own on public.price_list_items
  using (app.has_org_permission(organization_id, 'pricing.write') and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id))
  with check (app.has_org_permission(organization_id, 'pricing.write') and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id));
alter policy customer_price_assignments_select_own on public.customer_price_list_assignments
  using (app.has_org_permission(organization_id, 'pricing.read'));
alter policy customer_price_assignments_write_own on public.customer_price_list_assignments
  using (app.has_org_permission(organization_id, 'pricing.write') and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id))
  with check (app.has_org_permission(organization_id, 'pricing.write') and app.org_can_write(organization_id) and app.org_has_private_prices(organization_id));

alter policy quotes_select_own on public.quotes
  using (app.has_org_permission(organization_id, 'quotes.read'));
alter policy quote_items_select_own on public.quote_items
  using (app.has_org_permission(organization_id, 'quotes.read'));
alter policy quote_events_select_own on public.quote_events
  using (app.has_org_permission(organization_id, 'quotes.read'));

alter policy whatsapp_connections_select_own on public.whatsapp_connections
  using (app.has_org_permission(organization_id, 'whatsapp.read'));
alter policy whatsapp_templates_select_own on public.whatsapp_templates
  using (app.has_org_permission(organization_id, 'whatsapp.read'));
alter policy whatsapp_outbox_select_own on public.whatsapp_outbox
  using (app.has_org_permission(organization_id, 'whatsapp.read'));
alter policy whatsapp_events_select_own on public.whatsapp_events
  using (app.has_org_permission(organization_id, 'whatsapp.read'));

-- ---------------------------------------------------------------------------
-- Wrappers service_role.
-- ---------------------------------------------------------------------------
create or replace function public.api_create_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_role text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table (invitation_id uuid, expires_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.create_invitation(
    p_organization_id, p_actor_user_id, p_email, p_role, p_token_hash, p_expires_at
  )
$$;

create or replace function public.api_accept_invitation(
  p_token_hash text,
  p_actor_user_id uuid
)
returns table (organization_id uuid, role text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.accept_invitation(p_token_hash, p_actor_user_id)
$$;

create or replace function public.api_change_member_role(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_role text
)
returns table (membership_id uuid, role text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.change_member_role(
    p_organization_id, p_actor_user_id, p_membership_id, p_role
  )
$$;

create or replace function public.api_revoke_member(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid
)
returns table (membership_id uuid, status text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.revoke_member(p_organization_id, p_actor_user_id, p_membership_id)
$$;

create or replace function public.api_revoke_invitation(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_invitation_id uuid
)
returns table (invitation_id uuid, status text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from app.revoke_invitation(p_organization_id, p_actor_user_id, p_invitation_id)
$$;

revoke all on function app.add_owner_membership() from public, anon, authenticated;
revoke all on function app.protect_owner_membership() from public, anon, authenticated;
revoke all on function app.org_role_for(uuid, uuid) from public, anon, authenticated;
revoke all on function app.org_role(uuid) from public, anon, authenticated;
revoke all on function app.role_has_permission(text, text) from public, anon, authenticated;
revoke all on function app.has_org_permission_for(uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.is_org_member(uuid) from public, anon, authenticated;
revoke all on function app.has_org_permission(uuid, text) from public, anon, authenticated;
revoke all on function app.create_invitation(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function app.accept_invitation(text, uuid) from public, anon, authenticated;
revoke all on function app.change_member_role(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app.revoke_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.revoke_invitation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_create_invitation(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.api_accept_invitation(text, uuid) from public, anon, authenticated;
revoke all on function public.api_change_member_role(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.api_revoke_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_revoke_invitation(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function app.add_owner_membership() to service_role;
grant execute on function app.protect_owner_membership() to service_role;
grant execute on function app.org_role_for(uuid, uuid) to service_role;
grant execute on function app.org_role(uuid) to authenticated, service_role;
grant execute on function app.role_has_permission(text, text) to authenticated, service_role;
grant execute on function app.has_org_permission_for(uuid, uuid, text) to service_role;
grant execute on function app.is_org_member(uuid) to authenticated, service_role;
grant execute on function app.has_org_permission(uuid, text) to authenticated, service_role;
grant execute on function app.create_invitation(uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function app.accept_invitation(text, uuid) to service_role;
grant execute on function app.change_member_role(uuid, uuid, uuid, text) to service_role;
grant execute on function app.revoke_member(uuid, uuid, uuid) to service_role;
grant execute on function app.revoke_invitation(uuid, uuid, uuid) to service_role;
grant execute on function public.api_create_invitation(uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.api_accept_invitation(text, uuid) to service_role;
grant execute on function public.api_change_member_role(uuid, uuid, uuid, text) to service_role;
grant execute on function public.api_revoke_member(uuid, uuid, uuid) to service_role;
grant execute on function public.api_revoke_invitation(uuid, uuid, uuid) to service_role;
