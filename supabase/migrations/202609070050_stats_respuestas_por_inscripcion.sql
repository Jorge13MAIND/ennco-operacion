begin;

-- M050: la tasa de respuesta cuenta inscripciones REPLIED (la ingesta de
-- respuestas comparte tablas con el carril hibrido y el lane del mensaje
-- entrante no es fiable). Las 6 respuestas de la prueba interna marcaban 0.

create or replace function app.direct_lane_stats_json(target_organization_id uuid, since_at timestamptz, until_at timestamptz)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  with env as (
    select m.id, m.mailbox_id, m.contact_id, m.enrollment_id, m.touch_number, m.status, m.created_at, m.opened_at, m.open_tracked,
      mb.normalized_email as mailbox, coalesce(nullif(a.state,''),'?') as state,
      app.direct_lane_variant_for_role(c.role_title) as variant,
      date_trunc('week', m.created_at at time zone 'America/Mexico_City')::date as week_start
    from public.messages m
    join public.mailboxes mb on mb.id=m.mailbox_id
    left join public.contacts c on c.id=m.contact_id
    left join public.accounts a on a.id=c.account_id
    where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='OUTBOUND'
      and m.created_at>=since_at and m.created_at<until_at
      and m.status in ('SENT','DELIVERED','FAILED','BOUNCED')
  ),
  enr as (
    select e.id, e.status, e.updated_at, e.created_at, e.mailbox_id, e.contact_id
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT'
  ),
  replies as (
    -- Una respuesta cuenta por inscripcion: la maquina canonica marca REPLIED
    -- al ingresarla. No se filtra por lane del mensaje entrante: la ingesta
    -- comparte tablas con el carril hibrido y ese campo no es fiable ahi.
    select e.id as enrollment_id, e.mailbox_id, e.contact_id, e.updated_at as created_at
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT' and e.status='REPLIED'
      and e.updated_at>=since_at and e.updated_at<until_at
  ),
  positives as (
    select count(*) as n from public.provider_events pe
    join public.messages m on m.id=pe.message_id
    join public.campaign_enrollments e on e.id=m.enrollment_id
    join public.campaigns ca on ca.id=e.campaign_id
    where pe.organization_id=target_organization_id and pe.reply_classification='POSITIVE'
      and ca.lane='DIRECT' and pe.observed_at>=since_at and pe.observed_at<until_at
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
    'since', since_at, 'until', until_at,
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
      'leads', (select count(*) from public.leads l where l.organization_id=target_organization_id and l.created_at>=since_at and l.created_at<until_at)
    ),
    'by', (select coalesce(jsonb_object_agg(dim, rows),'{}'::jsonb) from (
      select dim, jsonb_agg(jsonb_build_object('key',key,'sends',sends,'reached',reached,'failed',failed,'tracked',tracked,'opened',opened,'replied',replied) order by key) as rows
      from grp group by dim) d)
  )
$$;
revoke all on function app.direct_lane_stats_json(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

commit;
