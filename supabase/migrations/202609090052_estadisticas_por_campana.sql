-- M052: estadisticas del carril directo por campana.
--
-- Grant, 9-sep: la pantalla de estadisticas mezclaba la prueba interna con la
-- campana real (el "20% de respuesta" eran las semillas de Jorge y George). La
-- funcion gana un filtro opcional por campana; sin el se comporta igual que
-- antes, asi que el reporte semanal del cron no cambia.
--
-- Con filtro, cada cifra se acota a las inscripciones de esa campana: envios,
-- alcanzados, respuestas, positivas, bajas y rebotes. Los leads se acotan a los
-- contactos inscritos en ella (leads no guarda campana). Sin filtro, los leads
-- siguen siendo los de toda la organizacion en el periodo, como hasta hoy.

begin;

drop function if exists app.direct_lane_stats_json(uuid, timestamptz, timestamptz);
drop function if exists public.read_direct_lane_stats(uuid, timestamptz, timestamptz);

create or replace function app.direct_lane_stats_json(
  target_organization_id uuid, since_at timestamptz, until_at timestamptz, target_campaign_id uuid default null)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  with env as (
    select m.id, m.mailbox_id, m.contact_id, m.enrollment_id, m.touch_number, m.status, m.created_at, m.opened_at, m.open_tracked,
      mb.normalized_email as mailbox, coalesce(nullif(a.state,''),'?') as state,
      app.direct_lane_variant_for_role(c.role_title) as variant,
      date_trunc('week', m.created_at at time zone 'America/Mexico_City')::date as week_start
    from public.messages m
    join public.mailboxes mb on mb.id=m.mailbox_id
    left join public.campaign_enrollments e on e.id=m.enrollment_id
    left join public.contacts c on c.id=m.contact_id
    left join public.accounts a on a.id=c.account_id
    where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='OUTBOUND'
      and m.created_at>=since_at and m.created_at<until_at
      and m.status in ('SENT','DELIVERED','FAILED','BOUNCED')
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  enr as (
    select e.id, e.status, e.updated_at, e.created_at, e.mailbox_id, e.contact_id
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT'
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  replies as (
    -- Una respuesta cuenta por inscripcion: la maquina canonica marca REPLIED
    -- al ingresarla. No se filtra por lane del mensaje entrante: la ingesta
    -- comparte tablas con el carril hibrido y ese campo no es fiable ahi.
    select e.id as enrollment_id, e.mailbox_id, e.contact_id, e.updated_at as created_at
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT' and e.status='REPLIED'
      and e.updated_at>=since_at and e.updated_at<until_at
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  positives as (
    select count(*) as n from public.provider_events pe
    join public.messages m on m.id=pe.message_id
    join public.campaign_enrollments e on e.id=m.enrollment_id
    join public.campaigns ca on ca.id=e.campaign_id
    where pe.organization_id=target_organization_id and pe.reply_classification='POSITIVE'
      and ca.lane='DIRECT' and pe.observed_at>=since_at and pe.observed_at<until_at
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  grp as (
    select dim, key,
      count(*) filter (where status in ('SENT','DELIVERED')) as sends,
      count(distinct enrollment_id) filter (where touch_number=1 and status in ('SENT','DELIVERED')) as reached,
      count(*) filter (where status in ('FAILED','BOUNCED')) as failed,
      count(*) filter (where open_tracked and status in ('SENT','DELIVERED')) as tracked,
      count(*) filter (where open_tracked and opened_at is not null) as opened,
      count(distinct enrollment_id) filter (where enrollment_id in (select enrollment_id from replies)) as replied
    from (
      select 'mailbox' as dim, mailbox as key, * from env
      union all select 'variant', variant, * from env
      union all select 'state', state, * from env
      union all select 'week', week_start::text, * from env
    ) x group by dim, key
  )
  select jsonb_build_object(
    'since', since_at, 'until', until_at, 'campaign_id', target_campaign_id,
    'funnel', jsonb_build_object(
      'enrolled', (select count(*) from enr where created_at>=since_at and created_at<until_at),
      'reached', (select count(distinct enrollment_id) from env where touch_number=1 and status in ('SENT','DELIVERED')),
      'sends', (select count(*) from env where status in ('SENT','DELIVERED')),
      'failed', (select count(*) from env where status in ('FAILED','BOUNCED')),
      'bounced_enrollments', (select count(*) from enr where status='BOUNCED' and updated_at>=since_at and updated_at<until_at),
      'replied', (select count(*) from replies),
      'positive', (select n from positives),
      'unsubscribed', (select count(*) from enr where status='UNSUBSCRIBED' and updated_at>=since_at and updated_at<until_at),
      'tracked', (select count(*) from env where open_tracked and status in ('SENT','DELIVERED')),
      'opened', (select count(*) from env where open_tracked and opened_at is not null),
      'leads', (select count(*) from public.leads l
        where l.organization_id=target_organization_id and l.created_at>=since_at and l.created_at<until_at
          and (target_campaign_id is null or l.contact_id in (select contact_id from enr)))
    ),
    'by', (select coalesce(jsonb_object_agg(dim, rows),'{}'::jsonb) from (
      select dim, jsonb_agg(jsonb_build_object('key',key,'sends',sends,'reached',reached,'failed',failed,'tracked',tracked,'opened',opened,'replied',replied) order by key) as rows
      from grp group by dim) d)
  )
$$;
revoke all on function app.direct_lane_stats_json(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;

create or replace function public.read_direct_lane_stats(
  target_organization_id uuid, since_at timestamptz, until_at timestamptz, target_campaign_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_campaign_id is not null and not exists (
    select 1 from public.campaigns c where c.id=target_campaign_id and c.organization_id=target_organization_id and c.lane='DIRECT') then
    raise exception 'DIRECT_LANE_CAMPAIGN_NOT_FOUND';
  end if;
  return app.direct_lane_stats_json(target_organization_id, since_at, until_at, target_campaign_id);
end $$;
revoke all on function public.read_direct_lane_stats(uuid,timestamptz,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.read_direct_lane_stats(uuid,timestamptz,timestamptz,uuid) to authenticated;

commit;
