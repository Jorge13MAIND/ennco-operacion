begin;
alter table public.email_recovery_review
  add column decision text not null default 'PENDING' check(decision in ('PENDING','REVIEWED','UNRELATED','NEEDS_CONTEXT')),
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add constraint email_recovery_review_actor_fkey foreign key(organization_id,reviewed_by)
    references public.organization_users(organization_id,user_id);
create index email_recovery_review_pending on public.email_recovery_review(organization_id,created_at)
  where decision in ('PENDING','NEEDS_CONTEXT');
create table app.email_unmatched_review_commands (
  organization_id uuid not null references public.organizations(id),
  idempotency_key text not null,
  review_id uuid not null references public.email_recovery_review(id),
  request_sha256 text not null,
  response_json jsonb not null,
  primary key(organization_id,idempotency_key)
);
revoke all on app.email_unmatched_review_commands from public,anon,authenticated,service_role;

create function public.review_unmatched_email(target_org uuid,target_review_id uuid,target_decision text,
  target_note text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; row_value public.email_recovery_review%rowtype;
  command app.email_unmatched_review_commands%rowtype; request_sha text; response jsonb;
begin
  actor:=app.direct_lane_assert_operator(target_org);
  if target_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'EMAIL_UNMATCHED_IDEMPOTENCY_INVALID'; end if;
  if target_decision not in ('REVIEWED','UNRELATED','NEEDS_CONTEXT') or length(btrim(target_note))<5
    or length(target_note)>1000 then raise exception 'EMAIL_UNMATCHED_REVIEW_INVALID'; end if;
  request_sha:=encode(digest(jsonb_build_object('review_id',target_review_id,'decision',target_decision,
    'note',target_note)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('email-unmatched:'||target_org::text||':'||target_review_id::text,0));
  select * into command from app.email_unmatched_review_commands
    where organization_id=target_org and idempotency_key=target_idempotency_key;
  if found then
    if command.review_id<>target_review_id or command.request_sha256<>request_sha then
      raise exception 'EMAIL_UNMATCHED_IDEMPOTENCY_REUSE'; end if;
    return command.response_json||jsonb_build_object('replayed',true);
  end if;
  select * into row_value from public.email_recovery_review
    where organization_id=target_org and id=target_review_id for update;
  if not found then raise exception 'EMAIL_UNMATCHED_NOT_FOUND'; end if;
  if row_value.decision not in ('PENDING','NEEDS_CONTEXT') then raise exception 'EMAIL_UNMATCHED_ALREADY_REVIEWED'; end if;
  update public.email_recovery_review set decision=target_decision,next_action=btrim(target_note),
    reviewed_by=actor,reviewed_at=clock_timestamp() where id=target_review_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
    values(target_org,actor,'EMAIL_UNMATCHED_REVIEW','email_recovery_review',target_review_id,
      jsonb_build_object('decision',target_decision));
  response:=jsonb_build_object('status',target_decision,'review_id',target_review_id,'replayed',false);
  insert into app.email_unmatched_review_commands(organization_id,idempotency_key,review_id,request_sha256,response_json)
    values(target_org,target_idempotency_key,target_review_id,request_sha,response);
  return response;
end $$;
revoke all on function public.review_unmatched_email(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_unmatched_email(uuid,uuid,text,text,text) to authenticated;

create or replace function public.read_email_recovery_overview(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'SDR_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'commercial_event_ids',coalesce((select jsonb_agg(pe.id) from public.provider_events pe
      join public.messages m on m.id=pe.message_id and m.organization_id=pe.organization_id
      join public.campaign_enrollments ce on ce.id=m.enrollment_id and ce.organization_id=m.organization_id
      join public.campaigns ca on ca.id=ce.campaign_id and ca.organization_id=ce.organization_id
      where pe.organization_id=target_organization_id and pe.event_kind in ('REPLY','AUTO_REPLY') and ca.lane='DIRECT' and ca.name !~* '^PRUEBA'),'[]'::jsonb),
    'unmatched',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,normalized_from,subject,body_text,next_action,decision
      from public.email_recovery_review where organization_id=target_organization_id
      and decision in ('PENDING','NEEDS_CONTEXT') order by created_at desc limit 100) r),'[]'::jsonb));
end $$;
commit;
