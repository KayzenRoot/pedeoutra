-- PedeOutra V2 — categorias e mídia de produto (PDA-VALUE-009 / #52)
-- Migration aditiva: produtos existentes permanecem sem categoria/foto.

-- ---------------------------------------------------------------------------
-- Categorias por organização
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_len check (char_length(name) between 1 and 80),
  constraint product_categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint product_categories_position_range check (position between 0 and 10000),
  constraint product_categories_org_slug_unique unique (organization_id, slug),
  constraint product_categories_id_org_unique unique (id, organization_id)
);

create index product_categories_org_position_idx
  on public.product_categories (organization_id, position, name);

create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function app.set_updated_at();

create or replace function app.set_category_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_candidate text;
  v_attempt integer := 0;
begin
  v_base := left(app.slugify(new.name), 60);
  if v_base = '' then
    v_base := 'categoria';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_candidate := v_base;
    if v_attempt > 1 then
      v_candidate := v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end if;
    exit when not exists (
      select 1 from public.product_categories c
       where c.organization_id = new.organization_id
         and c.slug = v_candidate
         and c.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    );
    if v_attempt >= 8 then
      raise exception 'category_slug_generation_failed' using errcode = 'P0001';
    end if;
  end loop;

  new.slug := v_candidate;
  return new;
end;
$$;

create trigger product_categories_set_slug_insert
  before insert on public.product_categories
  for each row execute function app.set_category_slug();

create trigger product_categories_set_slug_update
  before update of name on public.product_categories
  for each row execute function app.set_category_slug();

alter table public.products
  add column category_id uuid;

alter table public.products
  add constraint products_category_fk
  foreign key (category_id, organization_id)
  references public.product_categories(id, organization_id)
  on delete set null (category_id);

create index products_org_category_idx
  on public.products (organization_id, category_id);

-- ---------------------------------------------------------------------------
-- Metadados de imagens (arquivos ficam no bucket privado product-images)
-- ---------------------------------------------------------------------------
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  storage_path text not null,
  thumb_path text,
  alt_text text not null,
  position integer not null default 0,
  is_cover boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_alt_len check (char_length(alt_text) between 3 and 160),
  constraint product_images_position_range check (position between 0 and 1000),
  constraint product_images_storage_path check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  ),
  constraint product_images_thumb_path check (
    thumb_path is null or thumb_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
  ),
  constraint product_images_path_tenant check (
    storage_path like organization_id::text || '/' || product_id::text || '/%'
    and (
      thumb_path is null
      or thumb_path like organization_id::text || '/' || product_id::text || '/%'
    )
  ),
  constraint product_images_storage_unique unique (storage_path),
  constraint product_images_id_org_unique unique (id, organization_id),
  constraint product_images_product_fk foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete cascade
);

create index product_images_product_position_idx
  on public.product_images (product_id, position, created_at);

create unique index product_images_one_cover_idx
  on public.product_images (product_id)
  where is_cover = true;

create trigger product_images_set_updated_at
  before update on public.product_images
  for each row execute function app.set_updated_at();

-- Bucket privado; somente a Edge Function com service_role acessa os objetos.
do $$
begin
  if exists (
    select 1 from information_schema.schemata where schema_name = 'storage'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'product-images',
      'product-images',
      false,
      5242880,
      array['image/jpeg', 'image/png', 'image/webp']
    )
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs de mídia: validação atômica e service_role apenas.
-- ---------------------------------------------------------------------------
create or replace function public.api_add_product_image(
  p_organization_id uuid,
  p_product_id uuid,
  p_storage_path text,
  p_thumb_path text,
  p_alt_text text,
  p_position integer default 0,
  p_is_cover boolean default false,
  p_actor uuid default null
)
returns public.product_images
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_image public.product_images;
  v_count integer;
begin
  if not exists (
    select 1 from public.products p
     where p.id = p_product_id
       and p.organization_id = p_organization_id
  ) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  if p_storage_path not like p_organization_id::text || '/' || p_product_id::text || '/%' then
    raise exception 'invalid_storage_path' using errcode = '22023';
  end if;

  select count(*)::integer into v_count
    from public.product_images i
   where i.product_id = p_product_id;

  if v_count >= 8 then
    raise exception 'image_limit_reached' using errcode = 'P0001';
  end if;

  if coalesce(p_is_cover, false) then
    update public.product_images
       set is_cover = false
     where product_id = p_product_id
       and is_cover = true;
  end if;

  insert into public.product_images (
    organization_id, product_id, storage_path, thumb_path, alt_text,
    position, is_cover, created_by
  ) values (
    p_organization_id, p_product_id, p_storage_path, p_thumb_path,
    btrim(p_alt_text), greatest(coalesce(p_position, 0), 0),
    coalesce(p_is_cover, false), p_actor
  )
  returning * into v_image;

  return v_image;
end;
$$;

create or replace function public.api_set_product_image_cover(
  p_organization_id uuid,
  p_image_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid;
begin
  select i.product_id into v_product_id
    from public.product_images i
   where i.id = p_image_id
     and i.organization_id = p_organization_id;
  if not found then
    raise exception 'image_not_found' using errcode = 'P0002';
  end if;

  update public.product_images
     set is_cover = false
   where product_id = v_product_id
     and is_cover = true;

  update public.product_images
     set is_cover = true
   where id = p_image_id;
end;
$$;

create or replace function public.api_delete_product_image(
  p_organization_id uuid,
  p_image_id uuid
)
returns table (storage_path text, thumb_path text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_storage_path text;
  v_thumb_path text;
begin
  delete from public.product_images i
   where i.id = p_image_id
     and i.organization_id = p_organization_id
  returning i.storage_path, i.thumb_path
  into v_storage_path, v_thumb_path;

  if v_storage_path is null then
    raise exception 'image_not_found' using errcode = 'P0002';
  end if;

  return query select v_storage_path, v_thumb_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS e grants
-- ---------------------------------------------------------------------------
alter table public.product_categories enable row level security;
alter table public.product_images enable row level security;

revoke all on public.product_categories from anon, authenticated;
revoke all on public.product_images from anon, authenticated;

create policy product_categories_select_own
  on public.product_categories for select to authenticated
  using (app.is_org_owner(organization_id));

create policy product_categories_insert_own
  on public.product_categories for insert to authenticated
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy product_categories_update_own
  on public.product_categories for update to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy product_categories_delete_own
  on public.product_categories for delete to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy product_images_select_own
  on public.product_images for select to authenticated
  using (app.is_org_owner(organization_id));

create policy product_images_insert_own
  on public.product_images for insert to authenticated
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy product_images_update_own
  on public.product_images for update to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id))
  with check (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

create policy product_images_delete_own
  on public.product_images for delete to authenticated
  using (app.is_org_owner(organization_id) and app.org_can_write(organization_id));

grant select, insert, update, delete on public.product_categories to authenticated;
grant select, insert, update, delete on public.product_images to authenticated;

grant all on public.product_categories to service_role;
grant all on public.product_images to service_role;

revoke all on function app.set_category_slug() from public, anon, authenticated;
revoke all on function public.api_add_product_image(uuid, uuid, text, text, text, integer, boolean, uuid) from public, anon, authenticated;
revoke all on function public.api_set_product_image_cover(uuid, uuid) from public, anon, authenticated;
revoke all on function public.api_delete_product_image(uuid, uuid) from public, anon, authenticated;

grant execute on function app.set_category_slug() to authenticated, service_role;
grant execute on function public.api_add_product_image(uuid, uuid, text, text, text, integer, boolean, uuid) to service_role;
grant execute on function public.api_set_product_image_cover(uuid, uuid) to service_role;
grant execute on function public.api_delete_product_image(uuid, uuid) to service_role;
