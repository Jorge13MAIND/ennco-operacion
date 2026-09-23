begin;
create table public.email_conversations (
  organization_id uuid not null references public.organizations(id),
  mailbox_id uuid not null references public.mailboxes(id),
  provider_thread_id text not null,
  thread_json jsonb not null,
  thread_sha256 text not null check(thread_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,mailbox_id,provider_thread_id)
);
create table public.email_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mailbox_id uuid not null references public.mailboxes(id),
  from_at timestamptz not null,
  until_at timestamptz not null,
  history_fence text not null,
  replayed_history_id text not null,
  counts jsonb not null,
  completed_at timestamptz not null default clock_timestamp(),
  unique(organization_id,mailbox_id,history_fence),
  check(until_at>from_at)
);
alter table public.email_conversations enable row level security;
alter table public.email_conversations force row level security;
alter table public.email_reconciliations enable row level security;
alter table public.email_reconciliations force row level security;
create policy email_conversations_read on public.email_conversations for select to authenticated using(app.is_member(organization_id));
create policy email_reconciliations_read on public.email_reconciliations for select to authenticated using(app.is_member(organization_id));
revoke all on public.email_conversations,public.email_reconciliations from public,anon,authenticated,service_role;
grant select on public.email_conversations,public.email_reconciliations to authenticated;
create index email_reconciliations_mailbox on public.email_reconciliations(organization_id,mailbox_id,completed_at desc);

-- Only the existing authenticated dispatch service can persist provider evidence.
-- Raw JSON text is signed byte-for-byte before parsing, independent of JSON key order.
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
  if p->>'kind'='MESSAGE' then
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
revoke all on function public.record_email_recovery(uuid,uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.record_email_recovery(uuid,uuid,text,text,uuid,timestamptz,text) to anon,authenticated;
commit;
