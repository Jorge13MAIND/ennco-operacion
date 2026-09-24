begin;

-- A verified email address is not evidence that its owner buys for the plant.
-- The research workflow remains the source of account and role verification.
create table public.email_contact_clearances (
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null,
  plant_state text,
  plant_source_url text,
  responsibility_source_url text,
  responsibility_note text,
  decision text not null check (decision in ('READY','HELD')),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  idempotency_key text not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (organization_id,contact_id),
  unique (organization_id,idempotency_key),
  foreign key (organization_id,contact_id) references public.contacts(organization_id,id),
  foreign key (organization_id,reviewed_by) references public.organization_users(organization_id,user_id),
  check (plant_state is null or plant_state in ('GUANAJUATO','QUERETARO','JALISCO','MICHOACAN')),
  check (decision='HELD' or (plant_state is not null and plant_source_url ~ '^https?://'
    and responsibility_source_url ~ '^https?://' and length(btrim(responsibility_note))>=20
    and expires_at>reviewed_at and expires_at<=reviewed_at+interval '90 days'))
);
create index email_contact_clearances_ready_idx on public.email_contact_clearances(organization_id,expires_at)
  where decision='READY';
alter table public.email_contact_clearances enable row level security;
alter table public.email_contact_clearances force row level security;
revoke all on public.email_contact_clearances from public,anon,authenticated,service_role;
grant select on public.email_contact_clearances to authenticated;
create policy email_contact_clearances_read on public.email_contact_clearances for select to authenticated
  using (app.is_member(organization_id));
create table app.email_contact_clearance_commands (
  organization_id uuid not null references public.organizations(id),
  idempotency_key text not null,
  contact_id uuid not null,
  request_sha256 text not null,
  response_json jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,idempotency_key)
);
revoke all on app.email_contact_clearance_commands from public,anon,authenticated,service_role;

create function app.email_contact_is_ready(target_org uuid,target_contact uuid)
returns boolean language sql stable security definer set search_path=public,app,pg_temp as $$
  select exists (
    select 1 from public.contacts c
    join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
    join public.research_contact_candidates rc on rc.organization_id=c.organization_id
      and rc.account_id=a.id and rc.promoted_contact_id=c.id and rc.research_status='PROMOTED'
    join public.email_contact_clearances cl on cl.organization_id=c.organization_id and cl.contact_id=c.id
    where c.organization_id=target_org and c.id=target_contact and c.verified and not c.is_deleted
      and a.research_status='VERIFIED' and a.research_verified_at is not null and not a.is_deleted
      and cl.decision='READY' and cl.expires_at>clock_timestamp()
      and cl.plant_state in ('GUANAJUATO','QUERETARO','JALISCO','MICHOACAN')
      and not app.is_suppressed(target_org,a.id,c.normalized_email,a.primary_domain)
  )
$$;
revoke all on function app.email_contact_is_ready(uuid,uuid) from public,anon,authenticated,service_role;

create function public.review_email_contact_clearance(
  target_org uuid,target_contact uuid,target_decision text,target_plant_state text,
  target_plant_source_url text,target_responsibility_source_url text,target_responsibility_note text,
  target_expires_at timestamptz,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare actor uuid; existing app.email_contact_clearance_commands%rowtype; request_sha text; response jsonb;
begin
  actor:=app.direct_lane_assert_operator(target_org);
  if target_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'EMAIL_CLEARANCE_IDEMPOTENCY_INVALID'; end if;
  if target_decision not in ('READY','HELD') then raise exception 'EMAIL_CLEARANCE_DECISION_INVALID'; end if;
  request_sha:=encode(digest(jsonb_build_object('contact',target_contact,'decision',target_decision,
    'plant_state',target_plant_state,'plant_source',target_plant_source_url,
    'responsibility_source',target_responsibility_source_url,'responsibility_note',target_responsibility_note,
    'expires_at',target_expires_at)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('email-clearance:'||target_org::text||':'||target_contact::text,0));
  select * into existing from app.email_contact_clearance_commands
    where organization_id=target_org and idempotency_key=target_idempotency_key;
  if found then
    if existing.contact_id<>target_contact or existing.request_sha256<>request_sha then
      raise exception 'EMAIL_CLEARANCE_IDEMPOTENCY_REUSE';
    end if;
    return existing.response_json||jsonb_build_object('replayed',true);
  end if;
  if target_decision='READY' then
    if not exists(select 1 from public.contacts c join public.accounts a
      on a.organization_id=c.organization_id and a.id=c.account_id
      join public.research_contact_candidates rc on rc.organization_id=c.organization_id
        and rc.account_id=a.id and rc.promoted_contact_id=c.id and rc.research_status='PROMOTED'
      where c.organization_id=target_org and c.id=target_contact and c.verified and not c.is_deleted
        and a.research_status='VERIFIED' and a.research_verified_at is not null and not a.is_deleted) then
      raise exception 'EMAIL_CLEARANCE_RESEARCH_INCOMPLETE';
    end if;
  end if;
  insert into public.email_contact_clearances(organization_id,contact_id,decision,plant_state,
    plant_source_url,responsibility_source_url,responsibility_note,expires_at,reviewed_by,idempotency_key,request_sha256)
  values(target_org,target_contact,target_decision,target_plant_state,target_plant_source_url,
    target_responsibility_source_url,target_responsibility_note,target_expires_at,actor,target_idempotency_key,request_sha)
  on conflict(organization_id,contact_id) do update set decision=excluded.decision,
    plant_state=excluded.plant_state,plant_source_url=excluded.plant_source_url,
    responsibility_source_url=excluded.responsibility_source_url,responsibility_note=excluded.responsibility_note,
    expires_at=excluded.expires_at,reviewed_by=excluded.reviewed_by,reviewed_at=clock_timestamp(),
    idempotency_key=excluded.idempotency_key,request_sha256=excluded.request_sha256;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
    values(target_org,actor,'EMAIL_CONTACT_CLEARANCE','contacts',target_contact,
      jsonb_build_object('decision',target_decision,'plant_state',target_plant_state,'request_sha256',request_sha));
  response:=jsonb_build_object('status',target_decision,'contact_id',target_contact,'replayed',false);
  insert into app.email_contact_clearance_commands(organization_id,idempotency_key,contact_id,request_sha256,response_json)
    values(target_org,target_idempotency_key,target_contact,request_sha,response);
  return response;
end $$;
revoke all on function public.review_email_contact_clearance(uuid,uuid,text,text,text,text,text,timestamptz,text)
  from public,anon,authenticated,service_role;
grant execute on function public.review_email_contact_clearance(uuid,uuid,text,text,text,text,text,timestamptz,text)
  to authenticated;

-- A second gate protects manual enrollment and a claimed first touch even if
-- a caller bypasses the normal auto-enrollment selection.
create function app.email_contact_enrollment_guard() returns trigger language plpgsql
  security definer set search_path=public,app,pg_temp as $$
begin
  if new.status in ('PENDING','ACTIVE') and exists(select 1 from public.campaigns c
    where c.organization_id=new.organization_id and c.id=new.campaign_id and c.lane='DIRECT')
    and not app.email_contact_is_ready(new.organization_id,new.contact_id) then
    raise exception 'EMAIL_CONTACT_NOT_READY';
  end if;
  return new;
end $$;
create trigger campaign_enrollments_email_contact_guard before insert on public.campaign_enrollments
  for each row execute function app.email_contact_enrollment_guard();
revoke all on function app.email_contact_enrollment_guard() from public,anon,authenticated,service_role;

create function app.email_contact_first_touch_guard() returns trigger language plpgsql
  security definer set search_path=public,app,pg_temp as $$
begin
  if new.lane='DIRECT' and new.direction='OUTBOUND' and new.touch_number=1
    and new.status<>'DRY_RUN' then
    if tg_op='INSERT' then
      if not app.email_contact_is_ready(new.organization_id,new.contact_id) then
        raise exception 'EMAIL_CONTACT_NOT_READY';
      end if;
    elsif old.status in ('QUEUED','DRY_RUN') and not app.email_contact_is_ready(new.organization_id,new.contact_id) then
      raise exception 'EMAIL_CONTACT_NOT_READY';
    end if;
  end if;
  return new;
end $$;
create trigger messages_email_contact_first_touch_guard before insert or update of status on public.messages
  for each row execute function app.email_contact_first_touch_guard();
revoke all on function app.email_contact_first_touch_guard() from public,anon,authenticated,service_role;

commit;
