begin;

-- Revierte M041: quita el carril directo por completo. Deshace el bypass de
-- los cuatro triggers híbridos con el mismo parche textual (en sentido
-- inverso), quita la clave direct_lane del informe de salud, y elimina RPCs,
-- helpers, tablas y columnas. Fail closed: si un ancla no aparece, revienta.

do $unpatch$
declare fn text; def text; patched text;
begin
  foreach fn in array array['enforce_hybrid_outbound_release','enforce_scaled_outbound_release',
    'enforce_operations_send_health','enforce_control_cadence_send_health'] loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname=fn and p.pronargs=0;
    if def is null then raise exception 'M041_DOWN_TRIGGER_FUNCTION_NOT_FOUND: %', fn; end if;
    if position('M041 direct lane bypass' in def)=0 then continue; end if;
    patched := replace(def,
      E'\nbegin\n  if new.lane = ''DIRECT'' then return new; end if; -- M041 direct lane bypass\n',
      E'\nbegin\n');
    if patched=def then raise exception 'M041_DOWN_TRIGGER_PATTERN_NOT_FOUND: %', fn; end if;
    execute patched;
  end loop;
end
$unpatch$;

do $health$
declare def text; patched text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='read_dispatch_health';
  if def is null then raise exception 'M041_DOWN_HEALTH_FUNCTION_NOT_FOUND'; end if;
  if position('direct_lane' in def)=0 then return; end if;
  patched := replace(def,
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp()),''direct_lane'',app.direct_lane_health_as_system(target_organization_id)',
    '''send_window_open'',app.hybrid_dispatch_window_is_open(clock_timestamp())');
  if patched=def then raise exception 'M041_DOWN_HEALTH_PATTERN_NOT_FOUND'; end if;
  execute patched;
end
$health$;

drop trigger if exists messages_aaa_m041_direct_lane on public.messages;

drop function if exists public.annotate_direct_lane_inbound(uuid,uuid,text,text,text,uuid,timestamptz,text);
drop function if exists public.settle_direct_lane_dispatch(uuid,uuid,text,text,text,text,text,text,uuid,timestamptz,text);
drop function if exists public.claim_direct_lane_dispatch(uuid,uuid,boolean,text,uuid,timestamptz,text);
drop function if exists public.read_direct_lane_health(uuid,text,uuid,timestamptz,text);
drop function if exists public.read_direct_lane_credential(uuid,uuid,text,uuid,timestamptz,text);
drop function if exists public.complete_direct_lane_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,uuid,timestamptz,text);
drop function if exists public.arm_direct_lane_authorization(uuid,text,text,text,uuid,timestamptz,text);
drop function if exists public.read_direct_lane_invitation(uuid,text,text,uuid,timestamptz,text);
drop function if exists public.read_direct_lane_overview(uuid);
drop function if exists public.enqueue_direct_lane_reply(uuid,uuid,text,text);
drop function if exists public.enroll_direct_lane_contacts(uuid,uuid,uuid,uuid[],integer,text);
drop function if exists public.set_direct_lane_campaign_state(uuid,uuid,text,text,text);
drop function if exists public.approve_direct_lane_campaign(uuid,uuid,text);
drop function if exists public.create_direct_lane_campaign(uuid,text,text,jsonb,text);
drop function if exists public.configure_direct_lane_mailbox(uuid,uuid,jsonb,text,text);
drop function if exists public.revoke_direct_lane_credential(uuid,uuid,text,text);
drop function if exists public.create_direct_lane_invitation(uuid,uuid,text,timestamptz,text);

drop function if exists app.enforce_direct_lane_release();
drop function if exists app.direct_lane_health_as_system(uuid);
drop function if exists app.direct_lane_mailbox_json(public.mailboxes);
drop function if exists app.direct_lane_render(text,text,text);
drop function if exists app.direct_lane_variant_for_role(text);
drop function if exists app.direct_lane_sent_today(uuid,uuid);
drop function if exists app.direct_lane_effective_cap(public.mailboxes);
drop function if exists app.direct_lane_noop(uuid,uuid,text,jsonb);
drop function if exists app.direct_lane_tick(uuid,uuid,uuid,text,text,jsonb);
drop function if exists app.direct_lane_command_record(uuid,text,text,text,jsonb,uuid);
drop function if exists app.direct_lane_command_replay(uuid,text,text);
drop function if exists app.direct_lane_assert_operator(uuid);

drop table if exists public.direct_lane_ticks;
drop table if exists public.direct_lane_commands;
drop table if exists public.direct_lane_authorizations;
drop table if exists public.direct_lane_credentials;

alter table public.mailboxes
  drop constraint if exists mailboxes_direct_lane_ramp_check,
  drop constraint if exists mailboxes_direct_lane_status_check,
  drop column if exists direct_lane_display_name,
  drop column if exists direct_lane_first_send_at,
  drop column if exists direct_lane_cap_max,
  drop column if exists direct_lane_fixed_cap,
  drop column if exists direct_lane_ramp_mode,
  drop column if exists direct_lane_status;

alter table public.campaigns
  drop constraint if exists campaigns_direct_lane_state_check,
  drop constraint if exists campaigns_lane_check,
  drop column if exists direct_lane_state,
  drop column if exists lane;

drop index if exists public.messages_direct_lane_outbound_idx;
alter table public.messages
  drop constraint if exists messages_cc_emails_lower_check,
  drop constraint if exists messages_lane_check,
  drop column if exists reply_to_provider_event_id,
  drop column if exists cc_emails,
  drop column if exists rfc_message_id,
  drop column if exists provider_thread_id,
  drop column if exists lane;
drop function if exists app.direct_lane_cc_emails_valid(text[]);

commit;
