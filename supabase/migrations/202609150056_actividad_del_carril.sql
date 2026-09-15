begin;

-- Actividad del carril directo con filtros (pantalla /operacion/correos/actividad).
-- La pantalla Correos solo muestra los ultimos 60 registros del health; esta lectura
-- devuelve un periodo completo con filtros por buzon, tipo de mensaje, estado, campana
-- y texto, mas los conteos para dividir la tabla. Solo lectura, misma guarda de
-- membresia que read_direct_lane_stats.

create or replace function app.direct_lane_activity_json(
  target_organization_id uuid, since_at timestamptz, until_at timestamptz,
  target_mailbox_id uuid default null, target_kind text default null, target_status text default null,
  target_campaign_id uuid default null, search_text text default null, page_limit integer default 300)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  with base as (
    select m.id, m.direction, m.status, m.touch_number,
      case when m.direction='INBOUND' then 'INBOUND' when m.touch_number is null then 'REPLY' else 'TOUCH' end as kind,
      mb.normalized_email as mailbox_email,
      case when m.direction='INBOUND' then m.normalized_from else m.normalized_to end as counterparty,
      a.legal_name as account, a.state as account_state, ct.full_name as contact, ct.role_title,
      m.subject, m.created_at, m.sent_at, m.cc_emails as cc, m.opened_at, m.open_count, m.open_tracked,
      ca.name as campaign,
      (select t.outcome from public.direct_lane_ticks t
        where t.organization_id=m.organization_id and t.message_id=m.id and t.tick_kind='SETTLE'
        order by t.created_at desc limit 1) as last_error
    from public.messages m
    left join public.mailboxes mb on mb.organization_id=m.organization_id and mb.id=m.mailbox_id
    left join public.contacts ct on ct.organization_id=m.organization_id and ct.id=m.contact_id
    left join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id
    left join public.campaign_enrollments e on e.organization_id=m.organization_id and e.id=m.enrollment_id
    left join public.campaigns ca on ca.organization_id=e.organization_id and ca.id=e.campaign_id
    where m.organization_id=target_organization_id and (m.lane='DIRECT' or m.direction='INBOUND')
      and m.created_at>=since_at and m.created_at<until_at
      and (target_mailbox_id is null or m.mailbox_id=target_mailbox_id)
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
      and (target_status is null or m.status::text=target_status)
  ),
  filtered as (
    select * from base b
    where (target_kind is null
        or (target_kind in ('INBOUND','REPLY','TOUCH') and b.kind=target_kind)
        or (target_kind ~ '^TOUCH_[0-9]+$' and b.kind='TOUCH' and b.touch_number=substring(target_kind from 7)::integer))
      and (search_text is null or search_text=''
        or b.account ilike '%'||search_text||'%' or b.contact ilike '%'||search_text||'%'
        or b.counterparty ilike '%'||search_text||'%' or b.subject ilike '%'||search_text||'%')
  )
  select jsonb_build_object(
    'since', since_at, 'until', until_at,
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'message_id', f.id, 'direction', f.direction, 'status', f.status, 'touch_number', f.touch_number, 'kind', f.kind,
        'mailbox_email', f.mailbox_email, 'counterparty', f.counterparty, 'account', f.account, 'account_state', f.account_state,
        'contact', f.contact, 'role_title', f.role_title, 'subject', f.subject, 'created_at', f.created_at, 'sent_at', f.sent_at,
        'cc', f.cc, 'opened_at', f.opened_at, 'open_count', f.open_count, 'open_tracked', f.open_tracked,
        'campaign', f.campaign, 'last_error', f.last_error
      ) order by f.created_at desc)
      from (select * from filtered order by created_at desc limit greatest(1, least(coalesce(page_limit,300), 1000))) f), '[]'::jsonb),
    'by', jsonb_build_object(
      'kind', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.k)
        from (select case when kind='TOUCH' then 'TOUCH_'||touch_number else kind end as k, count(*) as n from filtered group by 1) x), '[]'::jsonb),
      'status', coalesce((select jsonb_agg(jsonb_build_object('key', x.status, 'count', x.n) order by x.status)
        from (select status, count(*) as n from filtered group by 1) x), '[]'::jsonb),
      'mailbox', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.k)
        from (select coalesce(mailbox_email,'?') as k, count(*) as n from filtered group by 1) x), '[]'::jsonb),
      'day', coalesce((select jsonb_agg(jsonb_build_object('key', x.d, 'count', x.n) order by x.d)
        from (select (created_at at time zone 'America/Mexico_City')::date::text as d, count(*) as n from filtered group by 1) x), '[]'::jsonb)
    ),
    'options', jsonb_build_object(
      'mailboxes', coalesce((select jsonb_agg(jsonb_build_object('id', mb.id, 'email', mb.normalized_email) order by mb.normalized_email)
        from public.mailboxes mb where mb.organization_id=target_organization_id), '[]'::jsonb),
      'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'state', c.direct_lane_state::text) order by c.created_at desc)
        from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT'), '[]'::jsonb)
    )
  )
$$;
revoke all on function app.direct_lane_activity_json(uuid,timestamptz,timestamptz,uuid,text,text,uuid,text,integer) from public,anon,authenticated,service_role;

create or replace function public.read_direct_lane_activity(
  target_organization_id uuid, since_at timestamptz, until_at timestamptz,
  target_mailbox_id uuid default null, target_kind text default null, target_status text default null,
  target_campaign_id uuid default null, search_text text default null, page_limit integer default 300)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return app.direct_lane_activity_json(target_organization_id, since_at, until_at, target_mailbox_id, target_kind, target_status,
    target_campaign_id, left(coalesce(search_text,''),80), page_limit);
end $$;
revoke all on function public.read_direct_lane_activity(uuid,timestamptz,timestamptz,uuid,text,text,uuid,text,integer) from public,anon,service_role;
grant execute on function public.read_direct_lane_activity(uuid,timestamptz,timestamptz,uuid,text,text,uuid,text,integer) to authenticated;

commit;
