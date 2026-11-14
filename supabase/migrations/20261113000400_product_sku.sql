-- PedeOutra V2 — SKU opcional por organização (PDA-VALUE-004 / #47)
-- Migration aditiva: produtos existentes permanecem sem SKU.

alter table public.products
  add column sku text;

alter table public.products
  add constraint products_sku_format check (
    sku is null or sku ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$'
  );

create or replace function app.normalize_product_sku()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.sku := nullif(upper(btrim(coalesce(new.sku, ''))), '');
  return new;
end;
$$;

create trigger products_normalize_sku
  before insert or update of sku on public.products
  for each row execute function app.normalize_product_sku();

create unique index products_org_sku_unique
  on public.products (organization_id, sku)
  where sku is not null;

revoke all on function app.normalize_product_sku() from public, anon, authenticated;
grant execute on function app.normalize_product_sku() to authenticated, service_role;
