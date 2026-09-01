begin;

-- Revierte M040: quita la clave reply_operations de read_dispatch_health
-- deshaciendo el mismo parche textual que la migración aplicó.

do $rollback$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'read_dispatch_health';

  if definition is null then raise exception 'M040_DOWN_HEALTH_FUNCTION_NOT_FOUND'; end if;
  if position('reply_operations' in definition) = 0 then return; end if;

  patched := replace(
    definition,
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp()),'
    || '''reply_operations'',jsonb_build_object('
    || '''unreviewed_replies'',(select count(*) from public.provider_events e'
    || ' where e.organization_id=target_organization_id and e.event_kind=''REPLY'''
    || ' and e.reply_classification=''UNREVIEWED''),'
    || '''oldest_unreviewed_minutes'',(select floor(extract(epoch from (clock_timestamp()-min(e.observed_at)))/60)'
    || ' from public.provider_events e where e.organization_id=target_organization_id'
    || ' and e.event_kind=''REPLY'' and e.reply_classification=''UNREVIEWED''),'
    || '''open_reply_cases'',(select count(*) from public.operational_sla_cases s'
    || ' where s.organization_id=target_organization_id and s.case_type=''POSITIVE_REPLY'''
    || ' and s.status=''OPEN''),'
    || '''assignment_active'',exists(select 1 from public.operational_assignments oa'
    || ' where oa.organization_id=target_organization_id and oa.status=''ACTIVE'''
    || ' and app.operations_assignment_is_active(oa.organization_id)))',
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp())'
  );

  if patched = definition then raise exception 'M040_DOWN_PATTERN_NOT_FOUND'; end if;
  execute patched;
end
$rollback$;

commit;
