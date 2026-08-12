\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'ennco', 'ENNCO'),
  ('12121212-1212-4212-8212-121212121212', 'other-org', 'Other Org');

do $$
begin
  if exists (
    select 1
    from public.audit_log al
    cross join lateral (values (coalesce(al.old_data::text, '')), (coalesce(al.new_data::text, ''))) snapshots(value)
    where snapshots.value like '%M2_SENTINEL_%'
  ) then raise exception 'AUDIT_REDACTION_OF_EXISTING_DATA_FAILED'; end if;
end;
$$;

insert into public.organization_users (organization_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', '91919191-9191-4191-8191-919191919191', 'teckel_operator'),
  ('11111111-1111-4111-8111-111111111111', '92929292-9292-4292-8292-929292929292', 'ennco_operator'),
  ('11111111-1111-4111-8111-111111111111', '93939393-9393-4393-8393-939393939393', 'auditor_readonly'),
  ('11111111-1111-4111-8111-111111111111', '94949494-9494-4494-8494-949494949494', 'ennco_admin');

insert into public.prequote_models (
  id, organization_id, version, status, assumptions, source_manifest
) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'synthetic-a', 'DRAFT_REVIEW_REQUIRED', '{}', '{}'),
  ('22121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212', 'synthetic-b', 'DRAFT_REVIEW_REQUIRED', '{}', '{}');

insert into public.prequotes (
  id, organization_id, model_id, folio, need_type, account_name, contact_name, contact_role,
  normalized_email, monthly_spend_mxn, tariff, installed_capacity_kwp, coverage_target_pct,
  city, state, zone, result_json, consented_at, evidence_class, correlation_id
) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'SYN-A', 'solar', 'Synthetic A', 'Ana', 'CEO', 'ana@example.test', 50000, 'GDMTH', 0, 80, 'Leon', 'Guanajuato', 'urban', '{}', now(), 'synthetic_demo', '41111111-1111-4111-8111-111111111111'),
  ('32121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212', '22121212-1212-4212-8212-121212121212', 'SYN-B', 'solar', 'Synthetic B', 'Beto', 'CEO', 'beto@example.test', 50000, 'GDMTH', 0, 80, 'Queretaro', 'Queretaro', 'urban', '{}', now(), 'synthetic_demo', '42121212-1212-4212-8212-121212121212');

insert into public.messages (
  organization_id, direction, status, normalized_to, normalized_from, subject, body_text,
  idempotency_key, correlation_id
) values (
  '11111111-1111-4111-8111-111111111111',
  'OUTBOUND',
  'DRY_RUN',
  'm2_sentinel_recipient@invalid.test',
  'm2_sentinel_sender@invalid.test',
  'M2_SENTINEL_SUBJECT_VALUE',
  'M2_SENTINEL_BODY_VALUE',
  'm2-audit-redaction-message',
  '43111111-1111-4111-8111-111111111111'
);

insert into public.suppression_entries (
  organization_id, kind, normalized_email, reason
) values (
  '11111111-1111-4111-8111-111111111111',
  'DNC',
  'm2_sentinel_suppressed@invalid.test',
  'M2_SENTINEL_SUPPRESSION_REASON'
);

update public.messages
set body_text = 'M2_SENTINEL_UPDATED_BODY_VALUE',
    normalized_to = 'm2_sentinel_updated_recipient@invalid.test'
where idempotency_key = 'm2-audit-redaction-message';

update public.suppression_entries
set reason = 'M2_SENTINEL_UPDATED_SUPPRESSION_REASON'
where normalized_email = 'm2_sentinel_suppressed@invalid.test';

do $$
begin
  if exists (
    select 1
    from public.audit_log al
    cross join lateral (values (coalesce(al.old_data::text, '')), (coalesce(al.new_data::text, ''))) snapshots(value)
    where snapshots.value like '%M2_SENTINEL_%'
       or snapshots.value like '%m2_sentinel_%'
  ) then raise exception 'AUDIT_PII_ALLOWLIST_FAILED'; end if;

  if not exists (
    select 1 from public.audit_log
    where record_type = 'messages'
      and new_data ->> 'status' = 'DRY_RUN'
      and new_data ? 'correlation_id'
  ) then raise exception 'AUDIT_SAFE_MESSAGE_FIELDS_MISSING'; end if;

  if not exists (
    select 1 from public.audit_log
    where record_type = 'suppression_entries'
      and new_data ->> 'kind' = 'DNC'
      and not (new_data ? 'normalized_email')
      and not (new_data ? 'reason')
  ) then raise exception 'AUDIT_SAFE_SUPPRESSION_FIELDS_INVALID'; end if;
end;
$$;

do $$
declare
  bucket_record storage.buckets%rowtype;
begin
  select * into bucket_record from storage.buckets where id = 'ennco-sensitive-documents';
  if not found then raise exception 'PRIVATE_BUCKET_MISSING'; end if;
  if bucket_record.public then raise exception 'PRIVATE_BUCKET_PUBLIC'; end if;
  if bucket_record.file_size_limit <> 10485760 then raise exception 'PRIVATE_BUCKET_SIZE_LIMIT_INVALID'; end if;
  if bucket_record.allowed_mime_types is null
    or not (bucket_record.allowed_mime_types @> array['application/pdf', 'image/jpeg', 'image/png']::text[])
    or not (bucket_record.allowed_mime_types <@ array['application/pdf', 'image/jpeg', 'image/png']::text[])
  then raise exception 'PRIVATE_BUCKET_MIME_ALLOWLIST_INVALID'; end if;

  begin
    update storage.buckets set public = true where id = 'ennco-sensitive-documents';
    raise exception 'EXPECTED_BUCKET_DOWNGRADE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'SENSITIVE_BUCKET_SECURITY_DOWNGRADE_BLOCKED' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.prequote_documents (
      organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '32121212-1212-4212-8212-121212121212',
      '11111111-1111-4111-8111-111111111111/prequotes/32121212-1212-4212-8212-121212121212/51111111-1111-4111-8111-111111111111.pdf',
      'application/pdf', repeat('a', 64), 100, now() + interval '90 days'
    );
    raise exception 'EXPECTED_CROSS_TENANT_FK_REJECTION';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.prequote_documents (
      organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '31111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212/prequotes/31111111-1111-4111-8111-111111111111/52111111-1111-4111-8111-111111111111.pdf',
      'application/pdf', repeat('b', 64), 100, now() + interval '90 days'
    );
    raise exception 'EXPECTED_ORG_PATH_REJECTION';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.prequote_documents (
      organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '31111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/53111111-1111-4111-8111-111111111111.png',
      'application/pdf', repeat('c', 64), 100, now() + interval '90 days'
    );
    raise exception 'EXPECTED_MEDIA_EXTENSION_REJECTION';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.prequote_documents (
      organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '31111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/54111111-1111-4111-8111-111111111111.pdf',
      'application/pdf', repeat('d', 64), 100, now() - interval '1 day'
    );
    raise exception 'EXPECTED_RETENTION_REJECTION';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.prequote_documents (
      organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until,
      quarantine_status
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '31111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/55111111-1111-4111-8111-111111111111.pdf',
      'application/pdf', repeat('e', 64), 100, now() + interval '90 days', 'CLEAN'
    );
    raise exception 'EXPECTED_UNSCANNED_CLEAN_REJECTION';
  exception
    when check_violation then null;
  end;
end;
$$;

insert into public.prequote_documents (
  id, organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until
) values
  ('61111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/71111111-1111-4111-8111-111111111111.pdf', 'application/pdf', repeat('1', 64), 100, now() + interval '90 days'),
  ('62111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/72111111-1111-4111-8111-111111111111.png', 'image/png', repeat('2', 64), 100, now() + interval '90 days'),
  ('63121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212', '32121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212/prequotes/32121212-1212-4212-8212-121212121212/73121212-1212-4212-8212-121212121212.pdf', 'application/pdf', repeat('3', 64), 100, now() + interval '90 days');

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, metadata) values (
      'ennco-sensitive-documents',
      '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/79999999-9999-4999-8999-999999999999.pdf',
      '{}'
    );
    raise exception 'EXPECTED_METADATA_REQUIRED_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DOCUMENT_METADATA_REQUIRED' then raise; end if;
  end;
end;
$$;

insert into storage.objects (bucket_id, name, metadata) values (
  'ennco-sensitive-documents',
  '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/71111111-1111-4111-8111-111111111111.pdf',
  '{"synthetic":true}'
);

do $$
begin
  begin
    update public.prequote_documents
    set sha256 = repeat('f', 64)
    where id = '61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_DOCUMENT_IDENTITY_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DOCUMENT_IDENTITY_IMMUTABLE' then raise; end if;
  end;

  begin
    update storage.objects
    set name = '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/79999999-9999-4999-8999-999999999999.pdf'
    where bucket_id = 'ennco-sensitive-documents';
    raise exception 'EXPECTED_STORAGE_IDENTITY_REJECTION';
  exception
    when others then
      if sqlerrm <> 'SENSITIVE_OBJECT_IDENTITY_IMMUTABLE' then raise; end if;
  end;
end;
$$;

set request.jwt.claim.sub = '92929292-9292-4292-8292-929292929292';
set role authenticated;

do $$
begin
  if exists (select 1 from public.prequote_documents) then
    raise exception 'PENDING_METADATA_WAS_READABLE_TO_CLIENT';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'ennco-sensitive-documents') then
    raise exception 'PENDING_OBJECT_WAS_READABLE';
  end if;

  insert into storage.objects (bucket_id, name, metadata) values (
    'ennco-sensitive-documents',
    '11111111-1111-4111-8111-111111111111/prequotes/31111111-1111-4111-8111-111111111111/72111111-1111-4111-8111-111111111111.png',
    '{"synthetic":true}'
  );

  begin
    insert into storage.objects (bucket_id, name, metadata) values (
      'ennco-sensitive-documents',
      '12121212-1212-4212-8212-121212121212/prequotes/32121212-1212-4212-8212-121212121212/73121212-1212-4212-8212-121212121212.pdf',
      '{"synthetic":true}'
    );
    raise exception 'EXPECTED_CROSS_TENANT_STORAGE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '94949494-9494-4494-8494-949494949494';
set role authenticated;

do $$
declare
  affected_count integer;
begin
  update public.prequote_documents
  set quarantine_status = 'CLEAN',
      scanned_at = now(),
      scan_engine = 'manual-forbidden',
      scan_result_json = '{}',
      released_at = now()
  where id = '61111111-1111-4111-8111-111111111111';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then raise exception 'MANUAL_QUARANTINE_TRANSITION_NOT_BLOCKED'; end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

do $$
begin
  begin
    update public.prequote_documents
    set quarantine_status = 'CLEAN',
        scanned_at = now(),
        scan_engine = 'invalid-synthetic-scanner',
        scan_result_json = '{"malware":false}',
        released_at = now()
    where id = '61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_INCOMPLETE_SCAN_REJECTION';
  exception
    when check_violation then null;
  end;
end;
$$;

set role service_role;

update public.prequote_documents
set quarantine_status = 'CLEAN',
    scanned_at = now(),
    scan_engine = 'synthetic-scanner',
    scan_result_json = '{"malware":false,"checksum_verified":true}',
    released_at = now()
where organization_id = '11111111-1111-4111-8111-111111111111';

reset role;

set request.jwt.claim.sub = '92929292-9292-4292-8292-929292929292';
set role authenticated;

do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'ennco-sensitive-documents') <> 2 then
    raise exception 'CLEAN_OBJECT_NOT_READABLE_TO_ALLOWED_ROLE';
  end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '93939393-9393-4393-8393-939393939393';
set role authenticated;

do $$
begin
  if exists (select 1 from public.prequote_documents) then raise exception 'AUDITOR_METADATA_ACCESS_NOT_BLOCKED'; end if;
  if exists (select 1 from storage.objects) then raise exception 'AUDITOR_OBJECT_ACCESS_NOT_BLOCKED'; end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '95959595-9595-4595-8595-959595959595';
set role authenticated;

do $$
begin
  if exists (select 1 from public.prequote_documents) then raise exception 'NON_MEMBER_METADATA_ACCESS_NOT_BLOCKED'; end if;
  if exists (select 1 from storage.objects) then raise exception 'NON_MEMBER_OBJECT_ACCESS_NOT_BLOCKED'; end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set role anon;

do $$
begin
  begin
    if exists (select 1 from storage.objects) then raise exception 'ANON_OBJECT_ACCESS_NOT_BLOCKED'; end if;
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.audit_log
    where record_type = 'prequote_documents' and action = 'UPDATE'
  ) then raise exception 'DOCUMENT_AUDIT_EVENT_MISSING'; end if;
end;
$$;

delete from storage.objects where bucket_id = 'ennco-sensitive-documents';
delete from public.prequote_documents;

\echo 'SECURE_STORAGE_GATE_PASS'
