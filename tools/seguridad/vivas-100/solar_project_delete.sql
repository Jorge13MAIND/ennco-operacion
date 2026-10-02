CREATE OR REPLACE FUNCTION public.solar_project_delete(target_organization_id uuid, target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  delete from public.ennco_solar_projects where organization_id=target_organization_id and id=target_id;
  if not found then raise exception 'SOLAR_PROJECT_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', true);
end $function$
