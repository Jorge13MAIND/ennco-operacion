CREATE OR REPLACE FUNCTION public.solar_quote_save(target_organization_id uuid, target_quote_id uuid, target_project_id uuid, target_segment text, target_name text, target_input jsonb, target_result jsonb, target_catalog_versions jsonb, expected_version integer DEFAULT NULL::integer, target_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_project_id is not null and not exists (select 1 from public.ennco_projects p where p.organization_id=target_organization_id and p.id=target_project_id) then
    raise exception 'SOLAR_QUOTE_PROJECT_NOT_FOUND';
  end if;
  if target_quote_id is null then
    insert into public.ennco_solar_quotes(organization_id, project_id, segment, name, status, input, result, catalog_versions, created_by, updated_by)
    values (target_organization_id, target_project_id, target_segment, left(trim(target_name), 200), coalesce(target_status, 'DRAFT'), target_input,
      coalesce(target_result, '{}'::jsonb), coalesce(target_catalog_versions, '{}'::jsonb), auth.uid(), auth.uid())
    returning * into q;
  else
    select * into q from public.ennco_solar_quotes where organization_id=target_organization_id and id=target_quote_id for update;
    if not found then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
    if expected_version is not null and q.version<>expected_version then raise exception 'SOLAR_QUOTE_VERSION_CONFLICT'; end if;
    update public.ennco_solar_quotes set
      project_id=coalesce(target_project_id, project_id), segment=coalesce(target_segment, segment), name=left(trim(coalesce(target_name, name)), 200),
      status=coalesce(target_status, status), input=target_input, result=coalesce(target_result, '{}'::jsonb),
      catalog_versions=coalesce(target_catalog_versions, '{}'::jsonb), version=version+1, updated_by=auth.uid(), updated_at=now()
    where id=q.id returning * into q;
  end if;
  insert into public.ennco_solar_quote_versions(organization_id, quote_id, version, name, status, input, result, catalog_versions, created_by)
  values (q.organization_id, q.id, q.version, q.name, q.status, q.input, q.result, q.catalog_versions, auth.uid());
  return app.solar_quote_json(q, true);
end $function$
