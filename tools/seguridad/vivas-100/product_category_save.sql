CREATE OR REPLACE FUNCTION public.product_category_save(target_organization_id uuid, target_id uuid, target_slug text, target_name text, target_kind text, target_icon text, target_default_unit_basis text, target_sort integer, target_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare c public.ennco_product_categories;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_id is null then
    insert into public.ennco_product_categories(organization_id, slug, name, kind, icon, default_unit_basis, sort, active)
      values (target_organization_id, target_slug, trim(target_name), coalesce(target_kind, 'other'), coalesce(target_icon, 'box'), target_default_unit_basis,
        coalesce(target_sort, (select coalesce(max(sort), 0) + 10 from public.ennco_product_categories where organization_id = target_organization_id)), coalesce(target_active, true))
      on conflict (organization_id, slug) do update set name = excluded.name, kind = excluded.kind, icon = excluded.icon, default_unit_basis = excluded.default_unit_basis, active = excluded.active, updated_at = now()
      returning * into c;
  else
    update public.ennco_product_categories set slug = coalesce(target_slug, slug), name = coalesce(trim(target_name), name), kind = coalesce(target_kind, kind), icon = coalesce(target_icon, icon),
      default_unit_basis = target_default_unit_basis, sort = coalesce(target_sort, sort), active = coalesce(target_active, active), updated_at = now()
      where organization_id = target_organization_id and id = target_id returning * into c;
    if not found then raise exception 'PRODUCT_CATEGORY_NOT_FOUND'; end if;
  end if;
  return app.product_category_json(c);
end $function$
