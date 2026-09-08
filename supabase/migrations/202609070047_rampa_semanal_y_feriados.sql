begin;

-- M047: rampa semanal programada por buzon y feriados en la ventana de envio.
--
-- Grant fijo el 7-sep la politica de volumen: por dominio, 5 correos al dia
-- la primera semana, 10 la segunda, 15 la tercera, 20 la cuarta y 25 en
-- adelante (limite saludable) hasta que los resultados permitan estirar.
-- La rampa AUTO existente (5/10/20/40 por dias desde el primer envio) no
-- sigue esa curva ni se alinea a semanas calendario, y la FIXED obliga a
-- cambiar el tope a mano cada lunes. Se agrega el modo SCHEDULE: un arreglo
-- de topes por semana, anclado a una fecha (lunes), con el ultimo valor
-- sostenido. Sigue acotado por cap_max, asi que la regla de 20 para el buzon
-- principal del cliente se conserva.
--
-- Ademas, la ventana de envio no conocia feriados: el 16 de septiembre
-- habria salido correo. Se agrega app.dispatch_holidays y la ventana la
-- consulta. Aplica a los dos carriles, que es lo correcto.

alter table public.mailboxes
  add column if not exists direct_lane_ramp_schedule integer[],
  add column if not exists direct_lane_ramp_anchor_at timestamptz;

alter table public.mailboxes drop constraint if exists mailboxes_direct_lane_ramp_check;
alter table public.mailboxes add constraint mailboxes_direct_lane_ramp_check check (
  direct_lane_ramp_mode in ('AUTO','FIXED','SCHEDULE')
  and direct_lane_fixed_cap between 0 and 100
  and direct_lane_cap_max between 0 and 100
  and (direct_lane_ramp_schedule is null
       or (array_length(direct_lane_ramp_schedule,1) between 1 and 12
           and 0 <= all(direct_lane_ramp_schedule) and 100 >= all(direct_lane_ramp_schedule)))
  and (direct_lane_ramp_mode <> 'SCHEDULE' or direct_lane_ramp_schedule is not null));

-- Semana de rampa (0 = primera), en dias naturales desde el ancla, hora de
-- Mexico. El ancla es la fecha configurada o, si no hay, el primer envio.
create or replace function app.direct_lane_ramp_week(target_mailbox public.mailboxes)
returns integer language sql stable set search_path=pg_catalog as $$
  select case
    when target_mailbox.direct_lane_ramp_mode <> 'SCHEDULE' then null
    else greatest(0, floor((
      (clock_timestamp() at time zone 'America/Mexico_City')::date
      - (coalesce(target_mailbox.direct_lane_ramp_anchor_at, target_mailbox.direct_lane_first_send_at, clock_timestamp()) at time zone 'America/Mexico_City')::date
    ) / 7.0))::integer end
$$;
revoke all on function app.direct_lane_ramp_week(public.mailboxes) from public,anon,authenticated,service_role;

create or replace function app.direct_lane_effective_cap(target_mailbox public.mailboxes)
returns integer language plpgsql immutable set search_path=pg_catalog as $$
declare days_since integer; ramp integer; wk integer; n integer;
begin
  if target_mailbox.direct_lane_ramp_mode='FIXED' then
    return least(target_mailbox.direct_lane_fixed_cap,target_mailbox.direct_lane_cap_max);
  end if;
  if target_mailbox.direct_lane_ramp_mode='SCHEDULE' then
    if target_mailbox.direct_lane_ramp_schedule is null then
      return least(target_mailbox.direct_lane_fixed_cap,target_mailbox.direct_lane_cap_max);
    end if;
    n := array_length(target_mailbox.direct_lane_ramp_schedule,1);
    wk := coalesce(app.direct_lane_ramp_week(target_mailbox),0);
    return least(target_mailbox.direct_lane_ramp_schedule[least(wk+1,n)],target_mailbox.direct_lane_cap_max);
  end if;
  if target_mailbox.direct_lane_first_send_at is null then
    return least(5,target_mailbox.direct_lane_cap_max);
  end if;
  days_since := floor(extract(epoch from (clock_timestamp()-target_mailbox.direct_lane_first_send_at))/86400)::integer;
  ramp := case when days_since<7 then 5 when days_since<14 then 10 when days_since<21 then 20 else 40 end;
  return least(ramp,target_mailbox.direct_lane_cap_max);
end $$;
revoke all on function app.direct_lane_effective_cap(public.mailboxes) from public,anon,authenticated,service_role;

create or replace function app.direct_lane_mailbox_json(target_mailbox public.mailboxes)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  select jsonb_build_object(
    'mailbox_id',target_mailbox.id,
    'normalized_email',target_mailbox.normalized_email,
    'domain',target_mailbox.domain,
    'sender_name',coalesce(target_mailbox.direct_lane_display_name,target_mailbox.sender_name),
    'status',target_mailbox.direct_lane_status,
    'credential_active',exists(select 1 from public.direct_lane_credentials c
      where c.organization_id=target_mailbox.organization_id and c.mailbox_id=target_mailbox.id and c.status='ACTIVE'),
    'credential_connected_at',(select max(c.created_at) from public.direct_lane_credentials c
      where c.organization_id=target_mailbox.organization_id and c.mailbox_id=target_mailbox.id and c.status='ACTIVE'),
    'ramp_mode',target_mailbox.direct_lane_ramp_mode,
    'fixed_cap',target_mailbox.direct_lane_fixed_cap,
    'cap_max',target_mailbox.direct_lane_cap_max,
    'effective_cap',app.direct_lane_effective_cap(target_mailbox),
    'ramp_schedule',to_jsonb(target_mailbox.direct_lane_ramp_schedule),
    'ramp_anchor_at',target_mailbox.direct_lane_ramp_anchor_at,
    'ramp_week',app.direct_lane_ramp_week(target_mailbox),
    'sent_today',app.direct_lane_sent_today(target_mailbox.organization_id,target_mailbox.id),
    'queued',(select count(*) from public.messages m where m.organization_id=target_mailbox.organization_id
      and m.mailbox_id=target_mailbox.id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.status in ('QUEUED','SENDING')),
    'sent_total',(select count(*) from public.messages m where m.organization_id=target_mailbox.organization_id
      and m.mailbox_id=target_mailbox.id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.status in ('SENT','DELIVERED')),
    'first_send_at',target_mailbox.direct_lane_first_send_at,
    'is_client_primary',target_mailbox.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP',
    'sync',(select jsonb_build_object('status',s.status,'last_history_id',s.last_history_id,'last_synced_at',s.last_synced_at,'last_error_code',s.last_error_code)
      from public.mailbox_sync_cursors s where s.organization_id=target_mailbox.organization_id and s.mailbox_id=target_mailbox.id),
    'pending_invitation',(select jsonb_build_object('expires_at',a.expires_at,'status',a.status,'created_at',a.created_at)
      from public.direct_lane_authorizations a where a.organization_id=target_mailbox.organization_id and a.mailbox_id=target_mailbox.id
        and a.status in ('PENDING','ARMED') and a.expires_at>clock_timestamp() order by a.created_at desc limit 1),
    'last_error',(select t.outcome from public.direct_lane_ticks t where t.organization_id=target_mailbox.organization_id
      and t.mailbox_id=target_mailbox.id and t.tick_kind in ('SETTLE','SYNC') and t.outcome like '%FAIL%' order by t.created_at desc limit 1)
  )
$$;

create or replace function public.configure_direct_lane_mailbox(
  target_organization_id uuid, target_mailbox_id uuid, target_patch jsonb, target_reason text, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; request_sha text; replay jsonb; mailbox_record public.mailboxes%rowtype; new_status text; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','configure_direct_lane_mailbox',target_organization_id::text,
    target_mailbox_id::text,coalesce(target_patch::text,''),coalesce(target_reason,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'DIRECT_LANE_REASON_REQUIRED'; end if;
  if target_patch is null or jsonb_typeof(target_patch)<>'object' then raise exception 'DIRECT_LANE_PATCH_INVALID'; end if;
  if exists (select 1 from jsonb_object_keys(target_patch) k where k not in ('status','ramp_mode','fixed_cap','cap_max','display_name','ramp_schedule','ramp_anchor_at')) then
    raise exception 'DIRECT_LANE_PATCH_KEY_UNKNOWN';
  end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id for update;
  if not found then raise exception 'DIRECT_LANE_MAILBOX_NOT_FOUND'; end if;
  new_status := coalesce(target_patch->>'status',mailbox_record.direct_lane_status);
  if new_status='CONNECTED' and not exists (select 1 from public.direct_lane_credentials c
    where c.organization_id=target_organization_id and c.mailbox_id=target_mailbox_id and c.status='ACTIVE') then
    raise exception 'DIRECT_LANE_CREDENTIAL_MISSING';
  end if;
  if mailbox_record.direct_lane_status='KILLED' and new_status<>'KILLED'
    and not app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]) then
    raise exception 'DIRECT_LANE_UNKILL_REQUIRES_ADMIN';
  end if;
  if coalesce(target_patch->>'ramp_mode',mailbox_record.direct_lane_ramp_mode)='SCHEDULE'
    and not (target_patch ? 'ramp_schedule') and mailbox_record.direct_lane_ramp_schedule is null then
    raise exception 'DIRECT_LANE_RAMP_SCHEDULE_REQUIRED';
  end if;
  if mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
    and coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>20 then
    raise exception 'DIRECT_LANE_CLIENT_MAILBOX_CAP_LIMIT';
  end if;
  update public.mailboxes set
    direct_lane_status=new_status,
    direct_lane_ramp_mode=coalesce(target_patch->>'ramp_mode',direct_lane_ramp_mode),
    direct_lane_fixed_cap=coalesce((target_patch->>'fixed_cap')::integer,direct_lane_fixed_cap),
    direct_lane_cap_max=coalesce((target_patch->>'cap_max')::integer,direct_lane_cap_max),
    direct_lane_display_name=coalesce(nullif(btrim(target_patch->>'display_name'),''),direct_lane_display_name),
    direct_lane_ramp_schedule=case when target_patch ? 'ramp_schedule'
      then (select array_agg((t.x)::integer order by t.ord) from jsonb_array_elements_text(target_patch->'ramp_schedule') with ordinality as t(x,ord))
      else direct_lane_ramp_schedule end,
    direct_lane_ramp_anchor_at=case when target_patch ? 'ramp_anchor_at' then (target_patch->>'ramp_anchor_at')::timestamptz else direct_lane_ramp_anchor_at end,
    updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_mailbox_id
  returning * into mailbox_record;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_MAILBOX_CONFIGURED','mailboxes',target_mailbox_id,
    jsonb_build_object('patch',target_patch,'reason',btrim(target_reason)));
  response := jsonb_build_object('status','CONFIGURED','mailbox',app.direct_lane_mailbox_json(mailbox_record));
  return app.direct_lane_command_record(target_organization_id,'CONFIGURE_MAILBOX',target_idempotency_key,request_sha,response,actor);
end $$;

-- Feriados: la ventana de envio los respeta. Fechas oficiales de Mexico en
-- el horizonte del programa; agregar filas conforme haga falta.
create table if not exists app.dispatch_holidays (
  holiday_date date primary key,
  label text not null
);
insert into app.dispatch_holidays(holiday_date,label) values
  ('2026-09-16','Independencia'),
  ('2026-11-16','Revolucion (tercer lunes de noviembre)'),
  ('2026-12-25','Navidad'),
  ('2027-01-01','Ano nuevo'),
  ('2027-02-01','Constitucion (primer lunes de febrero)'),
  ('2027-03-15','Natalicio de Benito Juarez (tercer lunes de marzo)')
on conflict (holiday_date) do nothing;

create or replace function app.hybrid_dispatch_window_is_open(target_at timestamp with time zone)
returns boolean language sql stable set search_path to 'pg_catalog' as $function$
  select extract(isodow from (target_at at time zone 'America/Mexico_City')) between 1 and 5
    and (target_at at time zone 'America/Mexico_City')::time >= time '09:30'
    and (target_at at time zone 'America/Mexico_City')::time < time '13:30'
    and not exists (select 1 from app.dispatch_holidays h
                    where h.holiday_date = (target_at at time zone 'America/Mexico_City')::date)
$function$;

commit;
