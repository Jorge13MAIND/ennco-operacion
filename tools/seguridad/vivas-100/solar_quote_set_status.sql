CREATE OR REPLACE FUNCTION public.solar_quote_set_status(target_organization_id uuid, target_quote_id uuid, target_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_status not in ('DRAFT','SENT','ACCEPTED','ARCHIVED') then raise exception 'SOLAR_QUOTE_STATUS_INVALID'; end if;
  update public.ennco_solar_quotes set status=target_status, updated_by=auth.uid(), updated_at=now()
  where organization_id=target_organization_id and id=target_quote_id returning * into q;
  if not found then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
  return app.solar_quote_json(q, false);
end $function$
