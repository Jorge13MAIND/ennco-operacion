CREATE OR REPLACE FUNCTION public.product_set_file(target_organization_id uuid, target_id uuid, target_kind text, target_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p public.ennco_products;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_kind not in ('photo','datasheet') then raise exception 'PRODUCT_FILE_KIND_INVALID'; end if;
  if target_path is not null and app.product_object_org_id(target_path) is distinct from target_organization_id then raise exception 'PRODUCT_FILE_PATH_INVALID'; end if;
  if target_kind = 'photo' then
    update public.ennco_products set photo_path = target_path, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  else
    update public.ennco_products set datasheet_path = target_path, updated_at = now() where organization_id = target_organization_id and id = target_id returning * into p;
  end if;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  return app.product_json(p);
end $function$
