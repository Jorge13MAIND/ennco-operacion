begin;

revoke all on function public.create_retention_policy(uuid,integer,text,timestamptz,text,jsonb,text) from public,authenticated;
revoke all on function public.activate_retention_policy(uuid,uuid,text,text) from public,authenticated;
revoke all on function public.create_retention_legal_hold(uuid,uuid,public.legal_hold_reason_code,text,timestamptz,text) from public,authenticated;
revoke all on function public.release_retention_legal_hold(uuid,uuid,text,text) from public,authenticated;
revoke all on function public.approve_retention_batch(uuid,uuid,text,text) from public,authenticated;
revoke all on function public.evaluate_retention_health(uuid) from public,authenticated;

revoke all on function app.record_retention_subject_clock(uuid,uuid,text,timestamptz,text,text) from service_role;
revoke all on function app.run_retention_reconciler(uuid,text) from service_role;
revoke all on function app.execute_retention_batch(uuid,uuid,text) from service_role;
revoke all on function app.finalize_retention_batch(uuid,uuid,text) from service_role;
revoke all on function app.record_retention_provider_propagation(uuid,uuid,text,text,text,text) from service_role;
revoke all on function app.reapply_retention_tombstones(uuid,text,jsonb,text) from service_role;
revoke all on function app.create_contact_deletion_item(uuid,uuid,timestamptz) from service_role;
revoke all on function app.assess_contact_deletion(uuid) from service_role;
revoke all on function app.execute_contact_deletion(uuid) from service_role;

create or replace function app.m021_retention_rollback_fail_closed()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'M021_RETENTION_CONTROL_UNAVAILABLE'; end $$;

drop trigger if exists retention_m021_rollback_fail_closed on public.deletion_batches;
create trigger retention_m021_rollback_fail_closed before insert or update or delete on public.deletion_batches
for each row execute function app.m021_retention_rollback_fail_closed();
drop trigger if exists legal_holds_m021_rollback_fail_closed on public.legal_holds;
create trigger legal_holds_m021_rollback_fail_closed before insert or update or delete on public.legal_holds
for each row execute function app.m021_retention_rollback_fail_closed();
drop trigger if exists deletion_items_m021_rollback_fail_closed on public.deletion_items;
create trigger deletion_items_m021_rollback_fail_closed before insert or update or delete on public.deletion_items
for each row execute function app.m021_retention_rollback_fail_closed();
drop trigger if exists deletion_tombstones_m021_rollback_fail_closed on public.deletion_tombstones;
create trigger deletion_tombstones_m021_rollback_fail_closed before insert or update or delete on public.deletion_tombstones
for each row execute function app.m021_retention_rollback_fail_closed();

alter table public.qualification_evidence_links drop constraint if exists qualification_evidence_source_tenant_fkey;
alter table public.qualification_evidence_links add constraint qualification_evidence_source_tenant_fkey
foreign key (organization_id,source_evidence_id) references public.source_evidence(organization_id,id);

create or replace function app.enforce_source_evidence_append_only()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if tg_op='UPDATE' then raise exception 'SOURCE_EVIDENCE_APPEND_ONLY'; end if;
  if tg_op='DELETE' and not (
    lower(old.subject_type)='contact'
    and exists(select 1 from public.deletion_items di join public.deletion_batches db
      on db.organization_id=di.organization_id and db.id=di.batch_id
      where di.organization_id=old.organization_id and di.subject_id=old.subject_id
        and di.subject_type='CONTACT' and di.status='ELIGIBLE' and db.status in ('APPROVED','IN_PROGRESS'))
  ) then raise exception 'SOURCE_EVIDENCE_APPEND_ONLY'; end if;
  return old;
end $$;

create or replace function app.enforce_research_rpc_write()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if current_setting('app.research_rpc_write',true) is distinct from 'true' then
    raise exception 'RESEARCH_RPC_WRITE_REQUIRED';
  end if;
  if tg_argv[0]='APPEND_ONLY' and tg_op<>'INSERT' then
    raise exception 'RESEARCH_APPEND_ONLY_RECORD';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function app.prevent_audit_mutation()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'AUDIT_LOG_APPEND_ONLY'; end $$;

create or replace function app.enforce_approval_append_only()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare actor_id uuid;
begin
  if tg_op<>'INSERT' then raise exception 'APPROVAL_APPEND_ONLY'; end if;
  actor_id:=auth.uid();
  if actor_id is not null and new.decided_by<>actor_id then raise exception 'APPROVAL_ACTOR_MISMATCH'; end if;
  if new.subject_type in ('campaign_first_send_release','rollout_wave_release','contractual_monthly_report_issue','recovery_experiment_release') and (
    actor_id is null or not app.has_role(new.organization_id,array['teckel_admin'::public.user_role]))
  then raise exception 'CONTROLLED_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  if new.subject_type='final_handoff_acceptance' and (actor_id is null or not app.has_role(new.organization_id,array['ennco_admin'::public.user_role]))
  then raise exception 'HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED'; end if;
  if new.subject_type='opportunity_closed_won' and (actor_id is null or not app.has_role(new.organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
    or not exists(select 1 from public.opportunities where organization_id=new.organization_id and id=new.subject_id))
  then raise exception 'CLOSED_WON_APPROVAL_ADMIN_REQUIRED'; end if;
  return new;
end $$;

create or replace function app.enforce_opportunity_transition()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare stage_order integer; old_stage_order integer; lead_record public.leads%rowtype;
begin
  if tg_op='INSERT' then
    if new.stage not in ('PROSPECTING','CONVERSATION') then raise exception 'OPPORTUNITY_CREATION_STAGE_INVALID'; end if;
  else
    if old.stage in ('CLOSED_WON','CLOSED_LOST') and new is distinct from old then raise exception 'CLOSED_OPPORTUNITY_IMMUTABLE'; end if;
    stage_order:=array_position(array['PROSPECTING','CONVERSATION','MEETING_CONFIRMED','DISCOVERY_HELD','QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION','CLOSED_WON','CLOSED_LOST']::text[],new.stage::text);
    old_stage_order:=array_position(array['PROSPECTING','CONVERSATION','MEETING_CONFIRMED','DISCOVERY_HELD','QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION','CLOSED_WON','CLOSED_LOST']::text[],old.stage::text);
    if old.stage in ('QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION') and new.stage<>'CLOSED_LOST' and stage_order<old_stage_order then raise exception 'OPPORTUNITY_STAGE_REGRESSION_REJECTED'; end if;
    if new.stage not in ('CLOSED_WON','CLOSED_LOST') and stage_order>old_stage_order+1 then raise exception 'OPPORTUNITY_STAGE_SKIP_REJECTED'; end if;
  end if;
  if new.lead_id is not null then
    select * into lead_record from public.leads where organization_id=new.organization_id and id=new.lead_id;
    if not found or lead_record.account_id is distinct from new.account_id then raise exception 'OPPORTUNITY_LEAD_ACCOUNT_MISMATCH'; end if;
  end if;
  if new.stage in ('QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION','CLOSED_WON') then
    if new.lead_id is null or not lead_record.contractual_qualified then raise exception 'QUALIFIED_PIPELINE_REQUIRES_STRICT_LEAD'; end if;
    if not (new.economic_buyer and new.active_pain and new.business_impact and new.timing_under_90_days and coalesce(new.value_mxn,0)>0
      and nullif(btrim(new.next_action),'') is not null and new.next_action_at is not null)
    then raise exception 'QUALIFIED_PIPELINE_EVIDENCE_INCOMPLETE'; end if;
  end if;
  if new.stage='PROPOSAL' and not exists(select 1 from public.proposals p where p.organization_id=new.organization_id and p.opportunity_id=new.id and p.delivered_at is not null)
  then raise exception 'PROPOSAL_STAGE_REQUIRES_DELIVERY_EVIDENCE'; end if;
  if new.stage='CLOSED_WON' and not exists(select 1 from public.approvals a where a.organization_id=new.organization_id and a.subject_type='opportunity_closed_won' and a.subject_id=new.id and a.decision='APPROVED')
  then raise exception 'CLOSED_WON_REQUIRES_APPROVAL_EVIDENCE'; end if;
  return new;
end $$;

create or replace function app.enforce_first_send_enrollment_integrity()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' then raise exception 'FIRST_SEND_RECIPIENT_SET_IMMUTABLE'; end if;
  if not exists(select 1 from public.first_send_batches b join public.campaign_enrollments ce on ce.id=new.enrollment_id and ce.organization_id=new.organization_id
    join public.contacts c on c.id=ce.contact_id and c.organization_id=ce.organization_id join public.sequence_versions sv on sv.id=ce.sequence_version_id and sv.organization_id=ce.organization_id and sv.campaign_id=ce.campaign_id
    where b.id=new.batch_id and b.organization_id=new.organization_id and b.status='DRAFT' and b.campaign_id=ce.campaign_id and ce.account_id=new.account_id
      and ce.contact_id=new.contact_id and ce.mailbox_id=new.mailbox_id and ce.sequence_version_id=new.sequence_version_id
      and encode(digest(c.normalized_email,'sha256'),'hex')=new.contact_email_sha256 and sv.content_sha256=new.sequence_content_sha256)
  then raise exception 'FIRST_SEND_TENANT_OR_REFERENCE_MISMATCH'; end if;
  return new;
end $$;

create or replace function app.enforce_rollout_enrollment_integrity()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' then raise exception 'ROLLOUT_RECIPIENT_SET_IMMUTABLE'; end if;
  if exists(select 1 from public.first_send_batch_enrollments be where be.organization_id=new.organization_id and be.enrollment_id=new.enrollment_id)
  then raise exception 'ENROLLMENT_RELEASE_SOURCE_OVERLAP'; end if;
  if not exists(select 1 from public.rollout_waves w join public.campaign_enrollments ce on ce.id=new.enrollment_id and ce.organization_id=new.organization_id
    join public.contacts c on c.id=ce.contact_id and c.organization_id=ce.organization_id join public.sequence_versions sv on sv.id=ce.sequence_version_id and sv.organization_id=ce.organization_id and sv.campaign_id=ce.campaign_id
    where w.id=new.wave_id and w.organization_id=new.organization_id and w.status='DRAFT' and w.campaign_id=ce.campaign_id and ce.account_id=new.account_id
      and ce.contact_id=new.contact_id and ce.mailbox_id=new.mailbox_id and ce.sequence_version_id=new.sequence_version_id
      and encode(digest(c.normalized_email,'sha256'),'hex')=new.contact_email_sha256 and sv.content_sha256=new.sequence_content_sha256)
  then raise exception 'ROLLOUT_TENANT_OR_REFERENCE_MISMATCH'; end if;
  return new;
end $$;

create or replace function app.enforce_capacity_schedule_write_path()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare linked_stage public.commercial_stage; linked_config_version integer; linked_effective_month date;
begin
  if tg_op='DELETE' then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_DELETE_FORBIDDEN'; end if;
  if current_setting('app.capacity_schedule_rpc',true) is distinct from 'true' then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_RPC_REQUIRED'; end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.opportunity_id is distinct from old.opportunity_id or new.created_at is distinct from old.created_at)
  then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_IDENTITY_IMMUTABLE'; end if;
  select o.stage into linked_stage from public.opportunities o where o.organization_id=new.organization_id and o.id=new.opportunity_id;
  if not found or linked_stage<>'CLOSED_WON' then raise exception 'CAPACITY_REQUIRES_CLOSED_WON_OPPORTUNITY'; end if;
  select c.version,c.effective_from_month into linked_config_version,linked_effective_month from public.operational_capacity_configs c
    where c.organization_id=new.organization_id and c.id=new.config_id;
  if not found or linked_config_version<>new.config_version or linked_effective_month>new.capacity_month then raise exception 'CAPACITY_CONFIG_REFERENCE_INVALID'; end if;
  return new;
end $$;

create or replace function app.enforce_capacity_command_append_only()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op<>'INSERT' then raise exception 'OPERATIONAL_CAPACITY_COMMAND_APPEND_ONLY'; end if;
  if current_setting('app.capacity_schedule_rpc',true) is distinct from 'true' then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_RPC_REQUIRED'; end if;
  return new;
end $$;

drop trigger if exists qualification_evidence_links_append_only on public.qualification_evidence_links;
create trigger qualification_evidence_links_append_only before update or delete on public.qualification_evidence_links
for each row execute function app.prevent_commercial_integrity_mutation();

create or replace function app.run_retention_reconciler(target_organization_id uuid,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M021_RETENTION_CONTROL_UNAVAILABLE'; end $$;
create or replace function app.execute_retention_batch(target_organization_id uuid,target_batch_id uuid,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M021_RETENTION_CONTROL_UNAVAILABLE'; end $$;
create or replace function app.finalize_retention_batch(target_organization_id uuid,target_batch_id uuid,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M021_RETENTION_CONTROL_UNAVAILABLE'; end $$;
create or replace function app.reapply_retention_tombstones(target_organization_id uuid,target_source_manifest_sha256 text,target_tombstones jsonb,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M021_RETENTION_CONTROL_UNAVAILABLE'; end $$;
revoke all on function app.run_retention_reconciler(uuid,text) from public,authenticated,service_role;
revoke all on function app.execute_retention_batch(uuid,uuid,text) from public,authenticated,service_role;
revoke all on function app.finalize_retention_batch(uuid,uuid,text) from public,authenticated,service_role;
revoke all on function app.reapply_retention_tombstones(uuid,text,jsonb,text) from public,authenticated,service_role;

create or replace function app.evaluate_retention_health(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'RETENTION_MEMBER_AAL2_REQUIRED'; end if;
  return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','reason_code','M021_RETENTION_CONTROL_UNAVAILABLE',
    'active_policy_count',0,'provider_unknown_count',0,'production_retention_state','BLOCKED_EXTERNAL','scheduler_state','UNKNOWN','live_provider_calls',0,
    'coverage',jsonb_build_object('SYNTHETIC_CONTACT','HOLD','CONTACT_OUTREACH','HOLD','PREQUOTE_DOCUMENT','HOLD','MESSAGE_CONTENT','HOLD'));
end $$;
create or replace function public.evaluate_retention_health(target_organization_id uuid)
returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.evaluate_retention_health($1)$$;
revoke all on function public.evaluate_retention_health(uuid) from public;
grant execute on function public.evaluate_retention_health(uuid) to authenticated;
revoke all on function app.evaluate_retention_health(uuid) from public,authenticated;

revoke insert,update,delete,truncate on public.legal_holds,public.deletion_batches,public.deletion_items,public.deletion_tombstones from authenticated;
revoke insert,update,delete,truncate on public.retention_policy_versions,public.retention_policy_rules,public.retention_subject_clocks,
  public.retention_reconciliation_runs,public.retention_command_ledger,public.retention_provider_propagations,
  public.retention_restore_reconciliation_runs,public.retention_restore_tombstone_entries from authenticated,service_role;

commit;
