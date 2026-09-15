begin;

-- Leads: una sola pantalla con todos los contactos (Leads + Empresas), etiquetados con la lista
-- de Apollo de la que salieron, filtrables por lista, ola, grupo A/B, estado, sector, tier, campana
-- y etapa (sin enviar, en cola, toque N, respondio, reboto, baja), con la franja de porcentajes
-- sobre el filtro. Solo lectura; misma guarda de membresia que read_direct_lane_stats.

alter table public.contacts
  add column if not exists source_list text,
  add column if not exists source_wave text,
  add column if not exists source_group text,
  add column if not exists source_origin text,
  add column if not exists source_category text;
comment on column public.contacts.source_list is 'Lista de origen (archivo de Apollo): LANZAMIENTO_SEPTIEMBRE, RESERVA_SEPTIEMBRE, NUEVOS_AMPLIACION_1000, ...';
comment on column public.contacts.source_wave is 'Ola dentro de la lista de lanzamiento (1..6).';
comment on column public.contacts.source_group is 'Grupo A/B del copy asignado en la lista (A_MANTENIMIENTO, B_PROYECTOS).';
comment on column public.contacts.source_origin is 'Fuente de adquisicion (apollo_bulk_match, apollo_bulk_match_1000, rescate_original_159).';
comment on column public.contacts.source_category is 'Categoria de cargo segun la lista (MANTENIMIENTO, OPERACIONES, COMPRAS, ...).';
create index if not exists contacts_source_list_idx on public.contacts(organization_id, source_list);

create or replace function app.lead_state_key(value text) returns text language sql immutable as $$
  select nullif(lower(translate(trim(coalesce(value,'')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '')
$$;

create or replace function app.lead_inventory_json(
  target_organization_id uuid,
  target_list text default null, target_wave text default null, target_group text default null,
  target_state text default null, target_tier integer default null, target_sector text default null,
  target_campaign_id uuid default null, target_stage text default null, search_text text default null,
  page_limit integer default 150, page_offset integer default 0, group_by_company boolean default false)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  with ct as (
    select c.id as contact_id, c.full_name, c.role_title, c.normalized_email, c.verified,
      c.source_list, c.source_wave, c.source_group, c.source_origin, c.source_category,
      a.id as account_id, a.legal_name as account, a.state as account_state, app.lead_state_key(a.state) as state_key,
      a.sector, a.tier, a.city, app.direct_lane_variant_for_role(c.role_title) as variant
    from public.contacts c
    join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
    where c.organization_id=target_organization_id and not c.is_deleted and not a.is_deleted
  ),
  enr as (
    select distinct on (e.contact_id) e.contact_id, e.id as enrollment_id, e.status::text as enrollment_status,
      e.next_touch_number, e.next_touch_at, e.updated_at as enrollment_updated_at,
      ca.id as campaign_id, ca.name as campaign, mb.normalized_email as mailbox
    from public.campaign_enrollments e
    join public.campaigns ca on ca.organization_id=e.organization_id and ca.id=e.campaign_id and ca.lane='DIRECT'
    left join public.mailboxes mb on mb.organization_id=e.organization_id and mb.id=e.mailbox_id
    where e.organization_id=target_organization_id
    order by e.contact_id, e.created_at desc
  ),
  msg as (
    select m.contact_id,
      max(m.touch_number) filter (where m.status in ('SENT','DELIVERED')) as last_touch,
      max(coalesce(m.sent_at, m.created_at)) filter (where m.status in ('SENT','DELIVERED')) as last_sent_at,
      min(coalesce(m.sent_at, m.created_at)) filter (where m.touch_number=1 and m.status in ('SENT','DELIVERED')) as first_sent_at,
      count(*) filter (where m.status in ('SENT','DELIVERED')) as sends,
      bool_or(m.opened_at is not null) as opened,
      coalesce(sum(m.open_count) filter (where m.opened_at is not null), 0) as opens,
      bool_or(m.status='BOUNCED') as bounced
    from public.messages m
    where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.contact_id is not null
    group by m.contact_id
  ),
  rep as (
    select m.contact_id, max(pe.observed_at) as replied_at,
      bool_or(pe.reply_classification='POSITIVE') as positive,
      (array_agg(pe.reply_classification::text order by pe.observed_at desc))[1] as reply_classification
    from public.provider_events pe
    join public.messages m on m.organization_id=pe.organization_id and m.id=pe.message_id
    where pe.organization_id=target_organization_id and pe.event_kind='REPLY' and m.contact_id is not null
    group by m.contact_id
  ),
  base as (
    select ct.*, enr.enrollment_id, enr.enrollment_status, enr.next_touch_number, enr.next_touch_at, enr.campaign_id, enr.campaign, enr.mailbox,
      msg.last_touch, msg.last_sent_at, msg.first_sent_at, coalesce(msg.sends,0) as sends, coalesce(msg.opened,false) as opened, coalesce(msg.opens,0) as opens,
      rep.replied_at, coalesce(rep.positive,false) as positive, rep.reply_classification,
      case
        when enr.enrollment_status='REPLIED' or rep.replied_at is not null then 'RESPONDIO'
        when enr.enrollment_status='UNSUBSCRIBED' then 'BAJA'
        when enr.enrollment_status='BOUNCED' or coalesce(msg.bounced,false) then 'REBOTO'
        when msg.last_touch is not null then 'TOQUE_'||msg.last_touch
        when enr.enrollment_id is not null and enr.enrollment_status in ('PENDING','ACTIVE','PAUSED') then 'EN_COLA'
        else 'SIN_ENVIAR'
      end as stage
    from ct
    left join enr on enr.contact_id=ct.contact_id
    left join msg on msg.contact_id=ct.contact_id
    left join rep on rep.contact_id=ct.contact_id
  ),
  scoped as (
    select * from base b
    where (target_list is null or coalesce(b.source_list,'SIN_LISTA')=target_list)
      and (target_wave is null or b.source_wave=target_wave)
      and (target_group is null or b.source_group=target_group)
      and (target_state is null or b.state_key=app.lead_state_key(target_state))
      and (target_tier is null or b.tier=target_tier)
      and (target_sector is null or b.sector=target_sector)
      and (target_campaign_id is null or b.campaign_id=target_campaign_id)
      and (search_text is null or search_text=''
        or b.account ilike '%'||search_text||'%' or b.full_name ilike '%'||search_text||'%'
        or b.normalized_email ilike '%'||search_text||'%' or b.role_title ilike '%'||search_text||'%')
  ),
  filtered as (
    select * from scoped s
    where target_stage is null
      or (target_stage='ENVIADO' and s.last_touch is not null)
      or (target_stage='PENDIENTE' and s.last_touch is null and s.stage not in ('REBOTO','BAJA','RESPONDIO'))
      or s.stage=target_stage
  ),
  lim as (select greatest(1, least(coalesce(page_limit,150), 500)) as n, greatest(0, coalesce(page_offset,0)) as o)
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'offset', (select o from lim),
    'limit', (select n from lim),
    'stats', (select jsonb_build_object(
        'total', count(*),
        'sin_enviar', count(*) filter (where stage='SIN_ENVIAR'),
        'en_cola', count(*) filter (where stage='EN_COLA'),
        'enviado', count(*) filter (where last_touch is not null),
        'toque_1', count(*) filter (where last_touch>=1),
        'toque_2', count(*) filter (where last_touch>=2),
        'toque_3', count(*) filter (where last_touch>=3),
        'toque_4', count(*) filter (where last_touch>=4),
        'toque_5', count(*) filter (where last_touch>=5),
        'toque_6', count(*) filter (where last_touch>=6),
        'toque_7', count(*) filter (where last_touch>=7),
        'toque_8', count(*) filter (where last_touch>=8),
        'abrieron', count(*) filter (where opened),
        'respondio', count(*) filter (where stage='RESPONDIO'),
        'positivas', count(*) filter (where positive),
        'reboto', count(*) filter (where stage='REBOTO'),
        'baja', count(*) filter (where stage='BAJA'),
        'empresas', count(distinct account_id)
      ) from scoped),
    'rows', case when group_by_company then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
        'contact_id', f.contact_id, 'full_name', f.full_name, 'role_title', f.role_title, 'email', f.normalized_email, 'verified', f.verified,
        'account_id', f.account_id, 'account', f.account, 'account_state', f.account_state, 'sector', f.sector, 'tier', f.tier, 'city', f.city,
        'source_list', f.source_list, 'source_wave', f.source_wave, 'source_group', f.source_group, 'source_origin', f.source_origin, 'source_category', f.source_category,
        'variant', f.variant, 'stage', f.stage, 'enrollment_status', f.enrollment_status, 'campaign', f.campaign, 'mailbox', f.mailbox,
        'next_touch_number', f.next_touch_number, 'next_touch_at', f.next_touch_at,
        'last_touch', f.last_touch, 'last_sent_at', f.last_sent_at, 'first_sent_at', f.first_sent_at, 'sends', f.sends,
        'opened', f.opened, 'opens', f.opens, 'replied_at', f.replied_at, 'positive', f.positive, 'reply_classification', f.reply_classification
      ) order by f.last_sent_at desc nulls last, f.account, f.full_name)
      from (select * from filtered order by last_sent_at desc nulls last, account, full_name limit (select n from lim) offset (select o from lim)) f), '[]'::jsonb) end,
    'companies', case when group_by_company then coalesce((select jsonb_agg(jsonb_build_object(
        'account_id', g.account_id, 'account', g.account, 'account_state', g.account_state, 'sector', g.sector, 'tier', g.tier,
        'contacts', g.contacts, 'enviados', g.enviados, 'respondieron', g.respondieron, 'rebotes', g.rebotes, 'abrieron', g.abrieron,
        'last_sent_at', g.last_sent_at, 'max_touch', g.max_touch, 'lists', g.lists
      ) order by g.last_sent_at desc nulls last, g.account)
      from (select account_id, account, account_state, sector, tier, count(*) as contacts,
              count(*) filter (where last_touch is not null) as enviados, count(*) filter (where stage='RESPONDIO') as respondieron,
              count(*) filter (where stage='REBOTO') as rebotes, count(*) filter (where opened) as abrieron,
              max(last_sent_at) as last_sent_at, max(last_touch) as max_touch,
              string_agg(distinct coalesce(source_list,'SIN_LISTA'), ', ') as lists
            from filtered group by account_id, account, account_state, sector, tier
            order by max(last_sent_at) desc nulls last, account limit (select n from lim) offset (select o from lim)) g), '[]'::jsonb) else '[]'::jsonb end,
    'total_companies', (select count(distinct account_id) from filtered),
    'options', jsonb_build_object(
      'lists', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.k) from (select coalesce(source_list,'SIN_LISTA') as k, count(*) as n from base group by 1) x), '[]'::jsonb),
      'waves', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.k) from (select source_wave as k, count(*) as n from base where source_wave is not null group by 1) x), '[]'::jsonb),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.k) from (select source_group as k, count(*) as n from base where source_group is not null group by 1) x), '[]'::jsonb),
      'states', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.n desc) from (select state_key as k, count(*) as n from base where state_key is not null group by 1) x), '[]'::jsonb),
      'tiers', coalesce((select jsonb_agg(jsonb_build_object('key', x.k::text, 'count', x.n) order by x.k) from (select tier as k, count(*) as n from base where tier is not null group by 1) x), '[]'::jsonb),
      'sectors', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'count', x.n) order by x.n desc) from (select sector as k, count(*) as n from base where sector is not null group by 1) x), '[]'::jsonb),
      'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'state', c.direct_lane_state::text) order by c.created_at desc)
        from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT'), '[]'::jsonb)
    )
  )
$$;
revoke all on function app.lead_inventory_json(uuid,text,text,text,text,integer,text,uuid,text,text,integer,integer,boolean) from public,anon,authenticated,service_role;

create or replace function public.read_lead_inventory(
  target_organization_id uuid,
  target_list text default null, target_wave text default null, target_group text default null,
  target_state text default null, target_tier integer default null, target_sector text default null,
  target_campaign_id uuid default null, target_stage text default null, search_text text default null,
  page_limit integer default 150, page_offset integer default 0, group_by_company boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  return app.lead_inventory_json(target_organization_id, target_list, target_wave, target_group, target_state, target_tier, target_sector,
    target_campaign_id, target_stage, left(coalesce(search_text,''),80), page_limit, page_offset, group_by_company);
end $$;
revoke all on function public.read_lead_inventory(uuid,text,text,text,text,integer,text,uuid,text,text,integer,integer,boolean) from public,anon,service_role;
grant execute on function public.read_lead_inventory(uuid,text,text,text,text,integer,text,uuid,text,text,integer,integer,boolean) to authenticated;

commit;
