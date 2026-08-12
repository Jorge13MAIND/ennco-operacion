begin;

revoke all on function app.ingest_research_batch(uuid,text,text,text,jsonb,text) from public,authenticated;
revoke all on function app.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) from public,authenticated;
revoke all on function app.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text) from public,authenticated;
revoke all on function app.submit_research_review(uuid,text,uuid,text,uuid[],text,text) from public,authenticated;
revoke all on function app.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) from public,authenticated;
revoke all on function app.verify_contact_candidate(uuid,uuid,uuid,uuid,text) from public,authenticated;
revoke all on function app.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) from public,authenticated;
revoke all on function app.assess_research_inventory(uuid) from public,authenticated;
revoke all on function app.freeze_research_inventory_snapshot(uuid,text,text) from public,authenticated;

drop function if exists public.ingest_research_batch(uuid,text,text,text,jsonb,text);
drop function if exists public.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text);
drop function if exists public.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text);
drop function if exists public.submit_research_review(uuid,text,uuid,text,uuid[],text,text);
drop function if exists public.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text);
drop function if exists public.verify_contact_candidate(uuid,uuid,uuid,uuid,text);
drop function if exists public.resolve_research_dedupe(uuid,uuid,text,uuid,text,text);
drop function if exists public.assess_research_inventory(uuid);
drop function if exists public.freeze_research_inventory_snapshot(uuid,text,text);

create or replace function app.block_research_without_m019()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op='INSERT' and new.research_created_by is not null then
    raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE';
  end if;
  if tg_op='UPDATE' and (
    new.research_status is distinct from old.research_status
    or new.priority_market is distinct from old.priority_market
    or new.research_verified_at is distinct from old.research_verified_at
    or new.research_verified_by is distinct from old.research_verified_by
    or new.research_created_by is distinct from old.research_created_by
    or new.research_legal_name_key is distinct from old.research_legal_name_key
    or new.research_state is distinct from old.research_state
    or new.research_coverage_exception_approved is distinct from old.research_coverage_exception_approved
  ) then raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end if;
  return new;
end;
$$;
drop trigger if exists accounts_m019_rollback_fail_closed on public.accounts;
create trigger accounts_m019_rollback_fail_closed
before insert or update on public.accounts for each row execute function app.block_research_without_m019();

drop function app.ingest_research_batch(uuid,text,text,text,jsonb,text);
create function app.ingest_research_batch(target_organization_id uuid,target_source_name text,target_source_sha256 text,target_manifest_sha256 text,target_rows_jsonb jsonb,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text);
create function app.upsert_research_account(target_organization_id uuid,target_source_record_id uuid,target_legal_name text,target_primary_domain text,target_city text,target_state text,target_industrial_park text,target_sector text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text);
create function app.record_research_evidence(target_organization_id uuid,target_subject_type text,target_subject_id uuid,target_field_name text,target_source_url text,target_source_name text,target_observed_at timestamptz,target_confidence public.source_confidence,target_value_json jsonb,target_checksum text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.submit_research_review(uuid,text,uuid,text,uuid[],text,text);
create function app.submit_research_review(target_organization_id uuid,target_subject_type text,target_subject_id uuid,target_decision text,target_evidence_ids uuid[],target_review_notes text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text);
create function app.upsert_contact_candidate(target_organization_id uuid,target_account_id uuid,target_full_name text,target_role_title text,target_role_category text,target_normalized_email text,target_evidence_ids uuid[],target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.verify_contact_candidate(uuid,uuid,uuid,uuid,text);
create function app.verify_contact_candidate(target_organization_id uuid,target_candidate_id uuid,target_role_evidence_id uuid,target_email_evidence_id uuid,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.resolve_research_dedupe(uuid,uuid,text,uuid,text,text);
create function app.resolve_research_dedupe(target_organization_id uuid,target_case_id uuid,target_decision text,target_canonical_account_id uuid,target_rationale text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;
drop function app.freeze_research_inventory_snapshot(uuid,text,text);
create function app.freeze_research_inventory_snapshot(target_organization_id uuid,target_assessment_checksum text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'; end $$;

drop function app.assess_research_inventory(uuid);
create or replace function app.assess_research_inventory(target_organization_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=app,public,pg_temp as $$
declare canonical jsonb; checksum text;
begin
  if not app.is_member(target_organization_id) then raise exception 'RESEARCH_MEMBER_AAL2_REQUIRED'; end if;
  canonical:=jsonb_build_object('decision','KILL','verified_accounts',0,'verified_contacts',0,
    'target_accounts',75,'target_contacts',150,'outreach_state','RESEARCH_ONLY_HOLD',
    'outreach_eligible_records',0,'blockers',jsonb_build_array('M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'));
  checksum:=encode(public.digest(canonical::text,'sha256'),'hex');
  return jsonb_build_object('status','ASSESSED','decision','KILL','verified_accounts',0,'verified_contacts',0,
    'target_accounts',75,'target_contacts',150,'outreach_state','RESEARCH_ONLY_HOLD',
    'outreach_eligible_records',0,'blockers',jsonb_build_array('M019_ROLLED_BACK_RESEARCH_UNAVAILABLE'),
    'assessment_checksum',checksum);
end;
$$;

create or replace function public.assess_research_inventory(target_organization_id uuid)
returns jsonb language sql security definer set search_path=app,public,pg_temp as $$
  select app.assess_research_inventory(target_organization_id)
$$;

revoke all on function app.ingest_research_batch(uuid,text,text,text,jsonb,text) from public,authenticated;
revoke all on function app.upsert_research_account(uuid,uuid,text,text,text,text,text,text,text) from public,authenticated;
revoke all on function app.record_research_evidence(uuid,text,uuid,text,text,text,timestamptz,public.source_confidence,jsonb,text,text) from public,authenticated;
revoke all on function app.submit_research_review(uuid,text,uuid,text,uuid[],text,text) from public,authenticated;
revoke all on function app.upsert_contact_candidate(uuid,uuid,text,text,text,text,uuid[],text) from public,authenticated;
revoke all on function app.verify_contact_candidate(uuid,uuid,uuid,uuid,text) from public,authenticated;
revoke all on function app.resolve_research_dedupe(uuid,uuid,text,uuid,text,text) from public,authenticated;
revoke all on function app.freeze_research_inventory_snapshot(uuid,text,text) from public,authenticated;
revoke all on function app.assess_research_inventory(uuid) from public;
grant execute on function app.assess_research_inventory(uuid) to authenticated;
revoke all on function public.assess_research_inventory(uuid) from public;
grant execute on function public.assess_research_inventory(uuid) to authenticated;

revoke insert,update,delete,truncate on public.import_batches,public.accounts,public.account_aliases,public.contacts from authenticated;
revoke insert,update,delete,truncate on public.research_import_records,public.research_contact_candidates,
  public.research_evidence_records,public.research_reviews,public.research_dedupe_cases,
  public.research_dedupe_decisions,public.research_inventory_snapshots,public.research_rpc_commands from authenticated;

commit;
