-- Cotizaciones solares: archivar sin perder nada y poder volver a verlas.
-- Archivar es solo un cambio de estado: no toca el input, ni el result, ni el
-- historial de versiones, y no sube la version (archivar no es una edicion).
begin;

create or replace function public.solar_quotes_list(target_organization_id uuid, include_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return coalesce((select jsonb_agg(app.solar_quote_json(q, false) order by q.updated_at desc)
    from public.ennco_solar_quotes q
    where q.organization_id=target_organization_id
      and (include_archived or q.status<>'ARCHIVED')), '[]'::jsonb);
end $$;

create or replace function public.solar_quote_set_status(
  target_organization_id uuid, target_quote_id uuid, target_status text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare q public.ennco_solar_quotes;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_status not in ('DRAFT','SENT','ACCEPTED','ARCHIVED') then raise exception 'SOLAR_QUOTE_STATUS_INVALID'; end if;
  update public.ennco_solar_quotes set status=target_status, updated_by=auth.uid(), updated_at=now()
  where organization_id=target_organization_id and id=target_quote_id returning * into q;
  if not found then raise exception 'SOLAR_QUOTE_NOT_FOUND'; end if;
  return app.solar_quote_json(q, false);
end $$;

revoke all on function public.solar_quotes_list(uuid, boolean) from public, anon, service_role;
revoke all on function public.solar_quote_set_status(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.solar_quotes_list(uuid, boolean) to authenticated;
grant execute on function public.solar_quote_set_status(uuid, uuid, text) to authenticated;

commit;
