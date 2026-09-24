begin;
create table public.email_delivery_diagnostics (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),mailbox_id uuid not null references public.mailboxes(id),
 provider_message_id text not null,outbound_id uuid not null references public.messages(id),category text not null check(category in ('TEMPORARY','INVALID_ADDRESS','SENDER_OR_POLICY','SERVER_REJECTION','UNKNOWN')),
 smtp_status text,body_text text not null,created_at timestamptz not null default now(),unique(organization_id,mailbox_id,provider_message_id)
);
create table public.email_recovery_review (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),mailbox_id uuid not null references public.mailboxes(id),
 provider_message_id text not null,provider_thread_id text not null,normalized_from text not null,subject text,body_text text,
 next_action text not null default 'Revisar correo de contacto comercial fuera del hilo registrado',created_at timestamptz not null default now(),unique(organization_id,mailbox_id,provider_message_id)
);
alter table public.email_delivery_diagnostics enable row level security;
alter table public.email_delivery_diagnostics force row level security;
alter table public.email_recovery_review enable row level security;
alter table public.email_recovery_review force row level security;
revoke all on public.email_delivery_diagnostics,public.email_recovery_review from public,anon,authenticated,service_role;
grant select on public.email_delivery_diagnostics,public.email_recovery_review to authenticated;
create policy email_delivery_diagnostics_read on public.email_delivery_diagnostics for select to authenticated using(app.is_member(organization_id));
create policy email_recovery_review_read on public.email_recovery_review for select to authenticated using(app.is_member(organization_id));
create index email_delivery_diagnostics_outbound on public.email_delivery_diagnostics(organization_id,outbound_id);
create or replace function public.record_email_recovery(
  target_organization_id uuid,target_mailbox_id uuid,target_payload text,
  proof_command_id text,proof_nonce uuid,proof_expires_at timestamptz,proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; p jsonb; e public.provider_events%rowtype; m public.messages%rowtype; thread_id text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','record_email_recovery',target_organization_id::text,target_mailbox_id::text,
    encode(digest(convert_to(target_payload,'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if octet_length(target_payload)>1000000 then raise exception 'RECOVERY_PAYLOAD_LIMIT'; end if;
  if not exists(select 1 from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id) then raise exception 'RECOVERY_MAILBOX_MISMATCH'; end if;
  p := target_payload::jsonb;
  if p->>'kind'='DELIVERY' then
    if not exists(select 1 from public.messages o where o.organization_id=target_organization_id and o.id=(p->>'outbound_id')::uuid
      and o.mailbox_id=target_mailbox_id and o.direction='OUTBOUND' and o.provider_thread_id=p->>'provider_thread_id') then raise exception 'RECOVERY_OUTBOUND_MISMATCH'; end if;
    insert into public.email_delivery_diagnostics(organization_id,mailbox_id,provider_message_id,outbound_id,category,smtp_status,body_text)
    values(target_organization_id,target_mailbox_id,p->>'provider_message_id',(p->>'outbound_id')::uuid,p->>'category',p->>'smtp_status',p->>'body_text')
    on conflict(organization_id,mailbox_id,provider_message_id) do nothing;
    return jsonb_build_object('status','DIAGNOSTIC_RECORDED');
  elsif p->>'kind'='UNMATCHED' then
    if exists(select 1 from public.contacts ct join public.campaign_enrollments ce on ce.organization_id=ct.organization_id and ce.contact_id=ct.id
      join public.campaigns ca on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
      where ct.organization_id=target_organization_id and ct.normalized_email=lower(p->>'from_email') and ca.lane='DIRECT' and ca.name !~* '^PRUEBA') then
      insert into public.email_recovery_review(organization_id,mailbox_id,provider_message_id,provider_thread_id,normalized_from,subject,body_text)
      values(target_organization_id,target_mailbox_id,p->>'provider_message_id',p->>'provider_thread_id',lower(p->>'from_email'),p->>'subject',p->>'body_text')
      on conflict(organization_id,mailbox_id,provider_message_id) do nothing;
      return jsonb_build_object('status','UNMATCHED_REVIEW_REQUIRED');
    end if;
    return jsonb_build_object('status','UNRELATED');
  elsif p->>'kind'='MESSAGE' then
    select * into e from public.provider_events where organization_id=target_organization_id and id=(p->>'event_id')::uuid;
    select * into m from public.messages where organization_id=target_organization_id and id=e.message_id and mailbox_id=target_mailbox_id and direction='INBOUND';
    if m.id is null or m.provider_message_id is distinct from p->>'provider_message_id' then raise exception 'RECOVERY_EVENT_MISMATCH'; end if;
    thread_id := p->>'provider_thread_id';
    if thread_id is null or not exists(select 1 from public.messages o where o.organization_id=target_organization_id
      and o.id=(e.payload_json->>'related_outbound_message_id')::uuid and o.mailbox_id=target_mailbox_id
      and o.direction='OUTBOUND' and o.provider_thread_id=thread_id) then raise exception 'RECOVERY_THREAD_MISMATCH'; end if;
    if jsonb_typeof(p->'thread'->'messages')<>'array' or p->'thread'->>'id' is distinct from thread_id
      or not exists(select 1 from jsonb_array_elements(p->'thread'->'messages') j where j->>'id'=m.provider_message_id)
      then raise exception 'RECOVERY_THREAD_INCOMPLETE'; end if;
    if nullif(btrim(p->>'body_text'),'') is null then raise exception 'RECOVERY_BODY_MISSING'; end if;
    if m.body_text is not null and m.body_text<>p->>'body_text' then raise exception 'RECOVERY_BODY_CONFLICT'; end if;
    update public.messages set body_text=p->>'body_text',provider_thread_id=thread_id,
      rfc_message_id=coalesce(p->>'rfc_message_id',rfc_message_id),updated_at=clock_timestamp() where id=m.id;
    insert into public.email_conversations(organization_id,mailbox_id,provider_thread_id,thread_json,thread_sha256)
    values(target_organization_id,target_mailbox_id,thread_id,p->'thread',encode(digest(convert_to((p->'thread')::text,'utf8'),'sha256'),'hex'))
    on conflict(organization_id,mailbox_id,provider_thread_id) do update set
      thread_json=excluded.thread_json,thread_sha256=excluded.thread_sha256,captured_at=clock_timestamp();
    insert into public.audit_log(organization_id,action,record_type,record_id,new_data)
      values(target_organization_id,'EMAIL_RECOVERY_MESSAGE','messages',m.id,jsonb_build_object('body_recovered',m.body_text is null,'service','email-recovery-v1'));
    return jsonb_build_object('status','RECORDED','message_id',m.id);
  elsif p->>'kind'='COMPLETE' then
    if p->>'history_fence' !~ '^[0-9]+$' or p->>'replayed_history_id' !~ '^[0-9]+$'
      or (p->>'replayed_history_id')::numeric<(p->>'history_fence')::numeric then raise exception 'RECOVERY_REPLAY_INVALID'; end if;
    insert into public.email_reconciliations(organization_id,mailbox_id,from_at,until_at,history_fence,replayed_history_id,counts)
    values(target_organization_id,target_mailbox_id,(p->>'from_at')::timestamptz,(p->>'until_at')::timestamptz,p->>'history_fence',p->>'replayed_history_id',p->'counts')
    on conflict(organization_id,mailbox_id,history_fence) do nothing;
    return jsonb_build_object('status','RECONCILED');
  end if;
  raise exception 'RECOVERY_COMMAND_INVALID';
end $$;

commit;
