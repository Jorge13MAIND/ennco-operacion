\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
('31900000-0000-4000-8000-000000000001','research-gate-a','Synthetic Research Gate A'),
('31900000-0000-4000-8000-000000000002','research-gate-b','Synthetic Research Gate B');
insert into public.organization_users(organization_id,user_id,role) values
('31900000-0000-4000-8000-000000000001','31910000-0000-4000-8000-000000000001','ennco_admin'),
('31900000-0000-4000-8000-000000000001','31910000-0000-4000-8000-000000000002','ennco_operator'),
('31900000-0000-4000-8000-000000000002','31910000-0000-4000-8000-000000000003','ennco_admin'),
('31900000-0000-4000-8000-000000000002','31910000-0000-4000-8000-000000000004','ennco_operator');
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret)
values ('31900000-0000-4000-8000-000000000001',repeat('p',32),repeat('a',64));

do $$ declare batch_id uuid;
begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.import_batches(
    organization_id,source_name,source_sha256,manifest_sha256,research_idempotency_key,
    source_row_count,accepted_row_count,quarantined_row_count,imported_by
  ) values (
    '31900000-0000-4000-8000-000000000002','Synthetic Tenant B',encode(digest('tenant-b-source','sha256'),'hex'),
    encode(digest('tenant-b-manifest','sha256'),'hex'),encode(digest('tenant-b-import','sha256'),'hex'),1,1,0,
    '31910000-0000-4000-8000-000000000003'
  ) returning id into batch_id;
  insert into public.research_import_records(
    organization_id,import_batch_id,external_record_id,source_row,raw_fingerprint,legal_name,legal_name_key,
    primary_domain,city,state,industrial_park,sector,source_url,created_by
  ) values (
    '31900000-0000-4000-8000-000000000002',batch_id,'tenant-b-record',1,
    encode(digest('tenant-b-row','sha256'),'hex'),'Synthetic Tenant B Plant','synthetic-tenant-b-plant',
    'tenant-b.invalid','Synthetic City','GUANAJUATO','Synthetic Park','Synthetic Sector',
    'https://source.invalid/tenant-b','31910000-0000-4000-8000-000000000003'
  );
end $$;

set request.jwt.claim.sub='31910000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.assess_research_inventory('31900000-0000-4000-8000-000000000001');
    raise exception 'EXPECTED_AAL1_READ_REJECTION';
  exception when others then if sqlerrm<>'RESEARCH_MEMBER_AAL2_REQUIRED' then raise; end if; end;
  begin
    perform public.ingest_research_batch('31900000-0000-4000-8000-000000000001','AAL1 Synthetic',
      repeat('a',64),repeat('b',64),jsonb_build_array(jsonb_build_object(
        'externalRecordId','aal1-1','sourceRow',1,'rawFingerprint',repeat('c',64),
        'legalName','AAL1 Synthetic','legalNameKey','aal1-synthetic','primaryDomain','aal1.invalid',
        'city','Synthetic City','state','GUANAJUATO','industrialPark','Synthetic Park',
        'sector','Synthetic Sector','sourceUrl','https://source.invalid/aal1')),repeat('d',64));
    raise exception 'EXPECTED_AAL1_MUTATION_REJECTION';
  exception when others then if sqlerrm<>'RESEARCH_OPERATOR_AAL2_REQUIRED' then raise; end if; end;
end $$;
reset role;
set request.jwt.claim.aal='aal2';
set role authenticated;

do $$ begin
  if exists(select 1 from public.research_import_records where external_record_id='tenant-b-record')
    then raise exception 'RLS_CROSS_TENANT_READ_LEAK'; end if;
end $$;

do $$
declare rows jsonb; response jsonb; commercial_before jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'externalRecordId','seed-'||n,'sourceRow',n,'rawFingerprint',encode(digest('row-'||n,'sha256'),'hex'),
    'legalName','Synthetic Industrial '||n,'legalNameKey','synthetic-industrial-'||n,
    'primaryDomain','synthetic-'||n||'.invalid','city','Synthetic City','state',
    case when n%2=0 then 'GUANAJUATO' else 'QUERETARO' end,
    'industrialPark','Synthetic Park','sector','Synthetic Sector','sourceUrl','https://source.invalid/'||n
  ) order by n) into rows from generate_series(1,27)n;
  commercial_before:=jsonb_build_object('contacts',(select count(*) from public.contacts),
    'leads',(select count(*) from public.leads),'opportunities',(select count(*) from public.opportunities),
    'enrollments',(select count(*) from public.campaign_enrollments),'messages',(select count(*) from public.messages));
  response:=public.ingest_research_batch('31900000-0000-4000-8000-000000000001','Synthetic 27 seed',
    repeat('1',64),repeat('2',64),rows,repeat('3',64));
  if response->>'status'<>'CREATED' or (response->>'created')::int<>27
    or (select count(*) from jsonb_object_keys(response))<>6 then raise exception 'IMPORT_CONTRACT_INVALID'; end if;
  if commercial_before<>jsonb_build_object('contacts',(select count(*) from public.contacts),
    'leads',(select count(*) from public.leads),'opportunities',(select count(*) from public.opportunities),
    'enrollments',(select count(*) from public.campaign_enrollments),'messages',(select count(*) from public.messages))
  then raise exception 'IMPORT_MUTATED_COMMERCIAL_TABLES'; end if;
  response:=public.ingest_research_batch('31900000-0000-4000-8000-000000000001','Synthetic 27 seed',
    repeat('1',64),repeat('2',64),rows,repeat('3',64));
  if response->>'status'<>'DUPLICATE' or (select count(*) from public.research_import_records)<>27
    then raise exception 'IMPORT_IDEMPOTENCY_INVALID'; end if;
end $$;

reset role;
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  if exists(select 1 from public.research_import_records where organization_id='31900000-0000-4000-8000-000000000001')
    then raise exception 'RLS_AAL1_READ_LEAK'; end if;
end $$;
reset role;
set request.jwt.claim.aal='aal2';
set role authenticated;

do $$ declare response jsonb; source_id uuid; account_id uuid;
begin
  select id into source_id from public.research_import_records where external_record_id='seed-1';
  response:=public.upsert_research_account('31900000-0000-4000-8000-000000000001',source_id,
    'Synthetic Industrial 1','synthetic-1.invalid','Synthetic City','QUERETARO','Synthetic Park',
    'Synthetic Sector',repeat('4',64));
  account_id:=(response->>'account_id')::uuid;
  if response->>'status'<>'CREATED' or account_id is null or (select count(*) from jsonb_object_keys(response))<>3
    then raise exception 'ACCOUNT_CONTRACT_INVALID'; end if;
  perform set_config('research.account_id',account_id::text,false);
end $$;

do $$ declare account_id uuid:=current_setting('research.account_id')::uuid; response jsonb; evidence uuid[]:='{}'; item jsonb;
begin
  begin
    perform public.record_research_evidence('31900000-0000-4000-8000-000000000001','ACCOUNT',account_id,
      'state','https://source.invalid/account','Synthetic Public Source',clock_timestamp()-interval '1 day',
      'VERIFIED','"GUANAJUATO"',repeat('a',64),repeat('b',64));
    raise exception 'EXPECTED_EVIDENCE_VALUE_MISMATCH';
  exception when others then if sqlerrm<>'RESEARCH_EVIDENCE_VALUE_SUBJECT_MISMATCH' then raise; end if; end;
  for item in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('field','legal_name','value','Synthetic Industrial 1','key',repeat('5',64),'checksum',repeat('6',64)),
    jsonb_build_object('field','industrial_plant','value',true,'key',repeat('7',64),'checksum',repeat('8',64)),
    jsonb_build_object('field','state','value','QUERETARO','key',repeat('9',64),'checksum',repeat('a',64))))
  loop
    response:=public.record_research_evidence('31900000-0000-4000-8000-000000000001','ACCOUNT',account_id,
      item->>'field','https://source.invalid/account', 'Synthetic Public Source',clock_timestamp()-interval '1 day',
      'VERIFIED',(item->'value'),item->>'checksum',item->>'key');
    evidence:=array_append(evidence,(response->>'evidence_id')::uuid);
  end loop;
  begin
    perform public.submit_research_review('31900000-0000-4000-8000-000000000001','ACCOUNT',account_id,
      'VERIFIED',evidence,'Synthetic creator cannot self review',repeat('b',64));
    raise exception 'EXPECTED_FOUR_EYES_FAILURE';
  exception when others then if sqlerrm<>'RESEARCH_FOUR_EYES_REVIEW_REQUIRED' then raise; end if; end;
  perform set_config('research.account_evidence',array_to_string(evidence,','),false);
end $$;

reset role;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000002';
set role authenticated;
do $$ declare account_id uuid:=current_setting('research.account_id')::uuid;
declare evidence uuid[]:=string_to_array(current_setting('research.account_evidence'),',')::uuid[]; response jsonb;
begin
  response:=public.submit_research_review('31900000-0000-4000-8000-000000000001','ACCOUNT',account_id,
    'VERIFIED',evidence,'Synthetic independent account review',repeat('c',64));
  if response->>'status'<>'VERIFIED' or response->>'research_status'<>'VERIFIED'
    or (select count(*) from jsonb_object_keys(response))<>4 then raise exception 'REVIEW_CONTRACT_INVALID'; end if;
end $$;

reset role;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000001';
set role authenticated;
do $$ declare account_id uuid:=current_setting('research.account_id')::uuid; response jsonb; candidate_id uuid;
begin
  response:=public.upsert_contact_candidate('31900000-0000-4000-8000-000000000001',account_id,
    'Synthetic Contact','Director General','CEO','synthetic.contact@example.invalid','{}',repeat('d',64));
  candidate_id:=(response->>'candidate_id')::uuid;
  if response->>'status'<>'CREATED' or candidate_id is null or (select count(*) from jsonb_object_keys(response))<>4
    then raise exception 'CANDIDATE_CONTRACT_INVALID'; end if;
  perform set_config('research.candidate_id',candidate_id::text,false);
end $$;

do $$ declare candidate_id uuid:=current_setting('research.candidate_id')::uuid; response jsonb;
declare role_id uuid; email_value_id uuid; email_verify_id uuid;
begin
  response:=public.record_research_evidence('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,
    'role_category','https://source.invalid/contact','Synthetic Public Source',clock_timestamp()-interval '1 day',
    'VERIFIED','"CEO"',repeat('e',64),repeat('f',64)); role_id:=(response->>'evidence_id')::uuid;
  response:=public.record_research_evidence('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,
    'normalized_email','https://source.invalid/contact','Synthetic Public Source',clock_timestamp()-interval '1 day',
    'VERIFIED','"synthetic.contact@example.invalid"',repeat('0',64),repeat('1',64)); email_value_id:=(response->>'evidence_id')::uuid;
  response:=public.record_research_evidence('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,
    'email_verification','https://source.invalid/contact','Synthetic Public Source',clock_timestamp()-interval '1 day',
    'VERIFIED','true',repeat('2',64),repeat('3',64)); email_verify_id:=(response->>'evidence_id')::uuid;
  perform set_config('research.role_evidence_id',role_id::text,false);
  perform set_config('research.email_evidence_id',email_verify_id::text,false);
end $$;

do $$ declare response jsonb;
begin
  response:=public.verify_contact_candidate('31900000-0000-4000-8000-000000000001',
    current_setting('research.candidate_id')::uuid,current_setting('research.role_evidence_id')::uuid,
    current_setting('research.email_evidence_id')::uuid,repeat('6',64));
  if response->>'status'<>'HOLD' or not (response->'blockers' ? 'FOUR_EYES_VERIFIER_REQUIRED')
    then raise exception 'CANDIDATE_FOUR_EYES_NEGATIVE_INVALID:%',response; end if;
end $$;

reset role;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000002';
set role authenticated;
do $$ declare response jsonb;
begin
  response:=public.verify_contact_candidate('31900000-0000-4000-8000-000000000001',
    current_setting('research.candidate_id')::uuid,current_setting('research.role_evidence_id')::uuid,
    current_setting('research.email_evidence_id')::uuid,repeat('4',64));
  if response->>'status'<>'PROMOTED' or response->'blockers'<>'[]'::jsonb
    or (select count(*) from jsonb_object_keys(response))<>3 then raise exception 'PROMOTION_CONTRACT_INVALID:%',response; end if;
end $$;

reset role;
do $$ declare account_id uuid:=current_setting('research.account_id')::uuid; candidate_id uuid; contact_id uuid;
declare role_id uuid; email_verify_id uuid;
begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.contacts(
    organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence
  ) values (
    '31900000-0000-4000-8000-000000000001',account_id,'Synthetic Existing Contact','Gerente de Planta',
    'existing.link@example.invalid',true,clock_timestamp(),'VERIFIED'
  ) returning id into contact_id;
  insert into public.research_contact_candidates(
    organization_id,account_id,full_name,role_title,role_category,normalized_email,idempotency_key,created_by
  ) values (
    '31900000-0000-4000-8000-000000000001',account_id,'Synthetic Existing Contact','Gerente de Planta',
    'PLANT_DIRECTOR','existing.link@example.invalid',encode(digest('existing-link-candidate','sha256'),'hex'),
    '31910000-0000-4000-8000-000000000001'
  ) returning id into candidate_id;
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,'role_category','https://source.invalid/existing',
      'Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED','"PLANT_DIRECTOR"',
      encode(digest('existing-role-checksum','sha256'),'hex'),encode(digest('existing-role-key','sha256'),'hex'),
      '31910000-0000-4000-8000-000000000001') returning id into role_id;
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,'normalized_email','https://source.invalid/existing',
      'Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED','"existing.link@example.invalid"',
      encode(digest('existing-email-checksum','sha256'),'hex'),encode(digest('existing-email-key','sha256'),'hex'),
      '31910000-0000-4000-8000-000000000001');
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,'email_verification','https://source.invalid/existing',
      'Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED','true',
      encode(digest('existing-verify-checksum','sha256'),'hex'),encode(digest('existing-verify-key','sha256'),'hex'),
      '31910000-0000-4000-8000-000000000001') returning id into email_verify_id;
  perform set_config('research.existing_candidate_id',candidate_id::text,false);
  perform set_config('research.existing_contact_id',contact_id::text,false);
  perform set_config('research.existing_role_id',role_id::text,false);
  perform set_config('research.existing_email_id',email_verify_id::text,false);
end $$;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare response jsonb;
begin
  response:=public.verify_contact_candidate('31900000-0000-4000-8000-000000000001',
    current_setting('research.existing_candidate_id')::uuid,current_setting('research.existing_role_id')::uuid,
    current_setting('research.existing_email_id')::uuid,encode(digest('existing-link-verify-rpc','sha256'),'hex'));
  if response->>'status'<>'DUPLICATE' or (response->>'contact_id')::uuid<>current_setting('research.existing_contact_id')::uuid
    or response->'blockers'<>'[]'::jsonb
    or not exists(select 1 from public.research_contact_candidates where id=current_setting('research.existing_candidate_id')::uuid
      and research_status='PROMOTED' and promoted_contact_id=current_setting('research.existing_contact_id')::uuid)
  then raise exception 'EXISTING_CONTACT_LINK_INVALID:%',response; end if;
end $$;

reset role;
do $$ declare account_id uuid:=current_setting('research.account_id')::uuid; candidate_id uuid; role_id uuid; email_verify_id uuid;
begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.research_contact_candidates(
    organization_id,account_id,full_name,role_title,role_category,normalized_email,idempotency_key,created_by
  ) values (
    '31900000-0000-4000-8000-000000000001',account_id,'Synthetic Suppressed','Gerente de Mantenimiento',
    'MAINTENANCE','suppressed@example.invalid',encode(digest('suppressed-candidate','sha256'),'hex'),
    '31910000-0000-4000-8000-000000000001'
  ) returning id into candidate_id;
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,
    value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,'role_category',
      'https://source.invalid/suppressed','Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED',
      '"MAINTENANCE"',encode(digest('suppressed-role-checksum','sha256'),'hex'),
      encode(digest('suppressed-role-key','sha256'),'hex'),'31910000-0000-4000-8000-000000000001') returning id into role_id;
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,
    value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,'normalized_email',
      'https://source.invalid/suppressed','Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED',
      '"suppressed@example.invalid"',encode(digest('suppressed-email-checksum','sha256'),'hex'),
      encode(digest('suppressed-email-key','sha256'),'hex'),'31910000-0000-4000-8000-000000000001');
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,
    value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000001','CONTACT_CANDIDATE',candidate_id,'email_verification',
      'https://source.invalid/suppressed','Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED',
      'true',encode(digest('suppressed-verify-checksum','sha256'),'hex'),
      encode(digest('suppressed-verify-key','sha256'),'hex'),'31910000-0000-4000-8000-000000000001') returning id into email_verify_id;
  insert into public.suppression_entries(
    organization_id,kind,account_id,normalized_email,reason,effective_at
  ) values (
    '31900000-0000-4000-8000-000000000001','DNC',account_id,'suppressed@example.invalid',
    'SYNTHETIC_ACTIVE_SUPPRESSION',clock_timestamp()
  );
  perform set_config('research.suppressed_candidate_id',candidate_id::text,false);
  perform set_config('research.suppressed_role_id',role_id::text,false);
  perform set_config('research.suppressed_email_id',email_verify_id::text,false);
end $$;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare response jsonb;
begin
  response:=public.verify_contact_candidate('31900000-0000-4000-8000-000000000001',
    current_setting('research.suppressed_candidate_id')::uuid,current_setting('research.suppressed_role_id')::uuid,
    current_setting('research.suppressed_email_id')::uuid,encode(digest('suppressed-verify-rpc','sha256'),'hex'));
  if response->>'status'<>'HOLD' or not(response->'blockers' ? 'SUPPRESSION_ACTIVE_OR_UNKNOWN')
    then raise exception 'ACTIVE_SUPPRESSION_DID_NOT_HOLD:%',response; end if;
end $$;

reset role;
do $$ declare account_id uuid:='31920000-0000-4000-8000-000000000002'; candidate_id uuid; role_id uuid; email_verify_id uuid;
begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.accounts(
    id,organization_id,legal_name,normalized_name,primary_domain,city,state,evidence_class,source_confidence,
    research_status,priority_market,research_verified_at,research_verified_by,research_created_by,
    research_legal_name_key,research_state
  ) values (
    account_id,'31900000-0000-4000-8000-000000000002','Synthetic Missing Secret Account',
    'synthetic-missing-secret-account','missing-tenant.invalid','Synthetic City','GUANAJUATO','synthetic_demo',
    'VERIFIED','VERIFIED','GTO_QRO_FIRST',clock_timestamp(),'31910000-0000-4000-8000-000000000004',
    '31910000-0000-4000-8000-000000000003','synthetic-missing-secret-account','GUANAJUATO'
  );
  insert into public.research_contact_candidates(
    organization_id,account_id,full_name,role_title,role_category,normalized_email,idempotency_key,created_by
  ) values (
    '31900000-0000-4000-8000-000000000002',account_id,'Synthetic Missing Secret','Gerente de Compras',
    'PROCUREMENT','missing.secret@example.invalid',encode(digest('missing-candidate','sha256'),'hex'),
    '31910000-0000-4000-8000-000000000003'
  ) returning id into candidate_id;
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000002','CONTACT_CANDIDATE',candidate_id,'role_category','https://source.invalid/missing',
      'Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED','"PROCUREMENT"',
      encode(digest('missing-role-checksum','sha256'),'hex'),encode(digest('missing-role-key','sha256'),'hex'),
      '31910000-0000-4000-8000-000000000003') returning id into role_id;
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000002','CONTACT_CANDIDATE',candidate_id,'normalized_email','https://source.invalid/missing',
      'Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED','"missing.secret@example.invalid"',
      encode(digest('missing-email-checksum','sha256'),'hex'),encode(digest('missing-email-key','sha256'),'hex'),
      '31910000-0000-4000-8000-000000000003');
  insert into public.research_evidence_records(
    organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by
  ) values
    ('31900000-0000-4000-8000-000000000002','CONTACT_CANDIDATE',candidate_id,'email_verification','https://source.invalid/missing',
      'Synthetic Public Source',clock_timestamp()-interval '1 day','VERIFIED','true',
      encode(digest('missing-verify-checksum','sha256'),'hex'),encode(digest('missing-verify-key','sha256'),'hex'),
      '31910000-0000-4000-8000-000000000003') returning id into email_verify_id;
  perform set_config('research.missing_candidate_id',candidate_id::text,false);
  perform set_config('research.missing_role_id',role_id::text,false);
  perform set_config('research.missing_email_id',email_verify_id::text,false);
end $$;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000004';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare response jsonb;
begin
  response:=public.verify_contact_candidate('31900000-0000-4000-8000-000000000002',
    current_setting('research.missing_candidate_id')::uuid,current_setting('research.missing_role_id')::uuid,
    current_setting('research.missing_email_id')::uuid,encode(digest('missing-secret-verify-rpc','sha256'),'hex'));
  if response->>'status'<>'HOLD' or not(response->'blockers' ? 'SUPPRESSION_ACTIVE_OR_UNKNOWN')
    then raise exception 'MISSING_SUPPRESSION_SECRET_DID_NOT_HOLD:%',response; end if;
end $$;

reset role;
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  if exists(select 1 from public.research_import_records
    where organization_id='31900000-0000-4000-8000-000000000002')
  then raise exception 'RLS_CROSS_TENANT_READ_LEAK'; end if;
end $$;

do $$ declare response jsonb; snapshot jsonb;
begin
  response:=public.assess_research_inventory('31900000-0000-4000-8000-000000000001');
  if response->>'status'<>'ASSESSED' or response->>'decision'<>'EXTEND'
    or response->>'outreach_state'<>'RESEARCH_ONLY_HOLD' or (response->>'outreach_eligible_records')::int<>0
    or (response->>'target_accounts')::int<>75 or (response->>'target_contacts')::int<>150
    or (select count(*) from jsonb_object_keys(response))<>10 then raise exception 'ASSESSMENT_CONTRACT_INVALID:%',response; end if;
  snapshot:=public.freeze_research_inventory_snapshot('31900000-0000-4000-8000-000000000001',
    response->>'assessment_checksum',repeat('5',64));
  if snapshot->>'status'<>'CREATED' or snapshot->>'outreach_state'<>'RESEARCH_ONLY_HOLD'
    or (snapshot->>'outreach_eligible_records')::int<>0 or (select count(*) from jsonb_object_keys(snapshot))<>6
  then raise exception 'SNAPSHOT_CONTRACT_INVALID'; end if;
  begin
    update public.research_inventory_snapshots set decision='PASS' where id=(snapshot->>'snapshot_id')::uuid;
    raise exception 'EXPECTED_APPEND_ONLY_FAILURE';
  exception when others then if sqlerrm<>'permission denied for table research_inventory_snapshots' then raise; end if; end;
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.audit_log where record_type like 'research_%' and (
    old_data::text||new_data::text ilike '%Synthetic Contact%'
    or old_data::text||new_data::text ilike '%synthetic.contact@example.invalid%'
    or old_data::text||new_data::text ilike '%source.invalid%'))
  then raise exception 'RESEARCH_AUDIT_PII_LEAK'; end if;
  if has_table_privilege('authenticated','public.accounts','INSERT')
    or has_table_privilege('authenticated','public.contacts','UPDATE')
    or has_table_privilege('authenticated','public.research_contact_candidates','INSERT')
  then raise exception 'RESEARCH_DIRECT_DML_NOT_REVOKED'; end if;
  begin
    insert into public.account_aliases(organization_id,account_id,alias,normalized_alias)
    values('31900000-0000-4000-8000-000000000002',current_setting('research.account_id')::uuid,'Cross Tenant','cross-tenant');
    raise exception 'EXPECTED_TENANT_FK_FAILURE';
  exception when foreign_key_violation then null; end;
end $$;

\echo 'RESEARCH_WORKBENCH_FORWARD_GATE_PASS'
