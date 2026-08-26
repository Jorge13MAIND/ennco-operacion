\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
  ('25000000-0000-4000-8000-000000000001','m025-ennco','ENNCO Synthetic Annex A'),
  ('25000000-0000-4000-8000-000000000002','m025-other','Other Synthetic Annex A');
insert into public.organization_users(organization_id,user_id,role) values
  ('25000000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001','ennco_admin'),
  ('25000000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000002','ennco_operator'),
  ('25000000-0000-4000-8000-000000000002','25200000-0000-4000-8000-000000000001','ennco_admin');
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret) values
  ('25000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64)),
  ('25000000-0000-4000-8000-000000000002',repeat('c',64),repeat('d',64));

insert into public.accounts(
  id,organization_id,legal_name,normalized_name,primary_domain,evidence_class,source_confidence
) values
  ('25300000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
   'POSCO MPPC, S.A. DE C.V.','posco-mppc','poscomppc.com.mx','live','VERIFIED'),
  ('25300000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000001',
   'Empresa Industrial Limpia SA DE CV','empresa-industrial-limpia','clean.invalid','live','VERIFIED'),
  ('25300000-0000-4000-8000-000000000003','25000000-0000-4000-8000-000000000001',
   'Empresa de alias','empresa-alias',null,'live','VERIFIED'),
  ('25300000-0000-4000-8000-000000000004','25000000-0000-4000-8000-000000000001',
   'Empresa de dominio','empresa-dominio','tejaselaguila.mx','live','VERIFIED');
insert into public.account_aliases(organization_id,account_id,alias,normalized_alias) values
  ('25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000003','MPE PLASTIC','mpe-plastic');

insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email) values
  ('25400000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000001','Synthetic POSCO','Compras','posco@synthetic.invalid'),
  ('25400000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000002','Synthetic Clean','Compras','clean@synthetic.invalid'),
  ('25400000-0000-4000-8000-000000000003','25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000003','Synthetic Alias','Compras','alias@synthetic.invalid'),
  ('25400000-0000-4000-8000-000000000004','25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000004','Synthetic Domain','Compras','domain@synthetic.invalid');

insert into public.campaigns(id,organization_id,name,manifest_json,manifest_sha256) values
  ('25500000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','M025 Synthetic','{}',repeat('1',64));
insert into public.sequence_versions(
  id,organization_id,campaign_id,version,sender_name,sender_title,content_sha256
) values (
  '25600000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
  '25500000-0000-4000-8000-000000000001',1,'Francisco Cuellar','Director',repeat('2',64)
);
insert into public.mailboxes(id,organization_id,normalized_email,domain,sender_name) values
  ('25700000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
   'francisco@synthetic.invalid','synthetic.invalid','Francisco Cuellar');

create or replace function app.m025_test_snapshot()
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object(
    'annex_id','ENNCO-ANNEX-A-2026-08-13',
    'snapshot_sha256','8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1',
    'scope_statement','ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION',
    'status','IDENTITY_AND_DOMAIN_VERIFIED_ACCOUNT_BINDING_PENDING',
    'external_send_authorized',false,
    'confirmed_at','2026-08-14T00:00:00-06:00',
    'entries',jsonb_build_array(
      jsonb_build_object(
        'normalized_name','POSCO MPPC','legal_name','POSCO MPPC, S.A. DE C.V.',
        'source_timestamp','2026-08-13T14:24:04-06:00',
        'aliases',jsonb_build_array('POSCO MPPC','POSCO MPPC SA DE CV','POSCO MPPC S.A. DE C.V.'),
        'domains',jsonb_build_array('poscomppc.com.mx','poscomppc.com')
      ),
      jsonb_build_object(
        'normalized_name','MPE PLASTIC','legal_name','MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO, S.A. DE C.V.',
        'source_timestamp','2026-08-13T14:24:17-06:00',
        'aliases',jsonb_build_array('MPE PLASTIC','MPE PLASTICS','MPE MEXICO',
          'MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO','MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO SA DE CV'),
        'domains',jsonb_build_array('mpeplastics.com')
      ),
      jsonb_build_object(
        'normalized_name','TEJAS EL AGUILA','legal_name','LAPROBA EL AGUILA SA DE CV',
        'source_timestamp','2026-08-13T14:24:24-06:00',
        'aliases',jsonb_build_array('TEJAS EL AGUILA','LAPROBA EL AGUILA','LAPROBA EL AGUILA SA DE CV','LAPROBA EL AGUILA S.A. DE C.V.'),
        'domains',jsonb_build_array('tejaselaguila.com','tejaselaguila.mx','tejaselaguila.net')
      )
    )
  )
$$;
grant execute on function app.m025_test_snapshot() to authenticated;

do $$ begin
  if app.annex_a_manifest_is_ready('25000000-0000-4000-8000-000000000001')
  then raise exception 'M025_MISSING_MANIFEST_FALSE_READY'; end if;
end $$;

insert into public.campaign_enrollments(
  id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status
) values (
  '25800000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
  '25500000-0000-4000-8000-000000000001','25600000-0000-4000-8000-000000000001',
  '25300000-0000-4000-8000-000000000002','25400000-0000-4000-8000-000000000002',
  '25700000-0000-4000-8000-000000000001','PENDING'
);
do $$ begin
  if (select status from public.campaign_enrollments where id='25800000-0000-4000-8000-000000000001')<>'SUPPRESSED'
    or (select stopped_reason from public.campaign_enrollments where id='25800000-0000-4000-8000-000000000001')<>'ANNEX_A_MATCH'
  then raise exception 'M025_UNKNOWN_MANIFEST_NOT_FAIL_CLOSED'; end if;
end $$;

set request.jwt.claim.sub='25100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.apply_annex_a_suppression_snapshot(
      '25000000-0000-4000-8000-000000000001',app.m025_test_snapshot(),repeat('a',64));
    raise exception 'M025_EXPECTED_AAL1_DENIAL';
  exception when others then
    if sqlerrm<>'ANNEX_A_ADMIN_AAL2_REQUIRED' then raise; end if;
  end;
end $$;

set request.jwt.claim.aal='aal2';
do $$
declare created jsonb; replay jsonb; duplicate_key jsonb;
begin
  created:=public.apply_annex_a_suppression_snapshot(
    '25000000-0000-4000-8000-000000000001',app.m025_test_snapshot(),repeat('a',64));
  if created->>'status'<>'APPLIED' or (created->>'entry_count')::integer<>3
    or (created->>'alias_count')::integer<>12 or (created->>'domain_count')::integer<>6
    or (created->>'matched_account_count')::integer<>3
    or created->>'release_state'<>'HOLD' or (created->>'outreach_eligible_records')::integer<>0
  then raise exception 'M025_IMPORT_RESPONSE_INVALID:%',created; end if;
  replay:=public.apply_annex_a_suppression_snapshot(
    '25000000-0000-4000-8000-000000000001',app.m025_test_snapshot(),repeat('a',64));
  if replay->>'status'<>'DUPLICATE' then raise exception 'M025_REPLAY_INVALID'; end if;
  duplicate_key:=public.apply_annex_a_suppression_snapshot(
    '25000000-0000-4000-8000-000000000001',app.m025_test_snapshot(),repeat('b',64));
  if duplicate_key->>'status'<>'DUPLICATE' then raise exception 'M025_SOURCE_IDENTITY_NOT_IDEMPOTENT'; end if;
  begin
    perform public.apply_annex_a_suppression_snapshot(
      '25000000-0000-4000-8000-000000000001',
      jsonb_set(app.m025_test_snapshot(),'{confirmed_at}','"2026-08-15T00:00:00-06:00"'),repeat('a',64));
    raise exception 'M025_EXPECTED_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm<>'ANNEX_A_IDEMPOTENCY_DRIFT' then raise; end if;
  end;
end $$;

reset role;

do $$ begin
  if (select count(*) from public.suppression_manifests where organization_id='25000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.suppression_manifest_identities where organization_id='25000000-0000-4000-8000-000000000001' and identity_type='NAME')<>12
    or (select count(*) from public.suppression_manifest_identities where organization_id='25000000-0000-4000-8000-000000000001' and identity_type='DOMAIN')<>6
    or not app.annex_a_manifest_is_ready('25000000-0000-4000-8000-000000000001')
  then raise exception 'M025_MANIFEST_LEDGER_INVALID'; end if;
  if exists(select 1 from public.suppression_entries where organization_id='25000000-0000-4000-8000-000000000001'
      and (account_id is not null or normalized_email is not null or normalized_domain is not null))
    or (select count(*) from public.suppression_entries where organization_id='25000000-0000-4000-8000-000000000001' and kind='ANNEX_A')<>9
  then raise exception 'M025_PRIVATE_SUPPRESSION_LEDGER_INVALID'; end if;
  if not app.is_annex_a_account_suppressed('25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000001')
    or not app.is_annex_a_account_suppressed('25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000003')
    or not app.is_annex_a_account_suppressed('25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000004')
    or app.is_annex_a_account_suppressed('25000000-0000-4000-8000-000000000001','25300000-0000-4000-8000-000000000002')
  then raise exception 'M025_NAME_ALIAS_DOMAIN_MATCH_INVALID'; end if;
end $$;

insert into public.campaign_enrollments(
  id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status
) values
  ('25800000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000001',
   '25500000-0000-4000-8000-000000000001','25600000-0000-4000-8000-000000000001',
   '25300000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001','25700000-0000-4000-8000-000000000001','PENDING'),
  ('25800000-0000-4000-8000-000000000003','25000000-0000-4000-8000-000000000001',
   '25500000-0000-4000-8000-000000000001','25600000-0000-4000-8000-000000000001',
   '25300000-0000-4000-8000-000000000003','25400000-0000-4000-8000-000000000003','25700000-0000-4000-8000-000000000001','ACTIVE'),
  ('25800000-0000-4000-8000-000000000004','25000000-0000-4000-8000-000000000001',
   '25500000-0000-4000-8000-000000000001','25600000-0000-4000-8000-000000000001',
   '25300000-0000-4000-8000-000000000004','25400000-0000-4000-8000-000000000004','25700000-0000-4000-8000-000000000001','PAUSED'),
  ('25800000-0000-4000-8000-000000000005','25000000-0000-4000-8000-000000000001',
   '25500000-0000-4000-8000-000000000001','25600000-0000-4000-8000-000000000001',
   '25300000-0000-4000-8000-000000000002','25400000-0000-4000-8000-000000000002','25700000-0000-4000-8000-000000000001','PENDING');

do $$ begin
  if (select count(*) from public.campaign_enrollments where id in (
      '25800000-0000-4000-8000-000000000002','25800000-0000-4000-8000-000000000003','25800000-0000-4000-8000-000000000004')
      and status='SUPPRESSED' and stopped_reason='ANNEX_A_MATCH')<>3
    or (select status from public.campaign_enrollments where id='25800000-0000-4000-8000-000000000005')<>'PENDING'
  then raise exception 'M025_ENROLLMENT_TRANSACTION_GATE_INVALID'; end if;
end $$;

insert into public.provider_accounts(
  id,organization_id,provider_code,environment,evidence_sha256
) values
  ('25900000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','APOLLO','PRODUCTION',repeat('3',64)),
  ('25900000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000002','APOLLO','PRODUCTION',repeat('4',64));
do $$ begin
  insert into public.provider_activation_gates(
    organization_id,provider_account_id,gate_code,status,evidence_sha256,evidence_class,recorded_by
  ) values (
    '25000000-0000-4000-8000-000000000001','25900000-0000-4000-8000-000000000001',
    'ANEXO_A_BOUND','PASS',repeat('5',64),'live','25100000-0000-4000-8000-000000000001'
  );
  begin
    insert into public.provider_activation_gates(
      organization_id,provider_account_id,gate_code,status,evidence_sha256,evidence_class,recorded_by
    ) values (
      '25000000-0000-4000-8000-000000000002','25900000-0000-4000-8000-000000000002',
      'ANEXO_A_BOUND','PASS',repeat('6',64),'live','25200000-0000-4000-8000-000000000001'
    );
    raise exception 'M025_EXPECTED_PROVIDER_GATE_DENIAL';
  exception when others then
    if sqlerrm<>'ANNEX_A_PROVIDER_GATE_NOT_VERIFIED' then raise; end if;
  end;
end $$;

set request.jwt.claim.sub='25100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  if (select count(*) from public.suppression_manifests)<>1 then raise exception 'M025_RLS_CROSS_TENANT_READ'; end if;
  if has_table_privilege('authenticated','public.suppression_manifest_identities','SELECT')
    or has_table_privilege('authenticated','public.suppression_manifests','INSERT')
    or has_function_privilege('service_role','public.apply_annex_a_suppression_snapshot(uuid,jsonb,text)','EXECUTE')
  then raise exception 'M025_PRIVILEGE_SURFACE_OPEN'; end if;
end $$;
reset role;

do $$ begin
  if exists(select 1 from public.audit_log where record_type in ('suppression_manifests','suppression_manifest_commands')
      and (old_data::text like '%POSCO%' or new_data::text like '%POSCO%' or old_data::text like '%poscomppc%' or new_data::text like '%poscomppc%'))
  then raise exception 'M025_AUDIT_RAW_IDENTITY_LEAK'; end if;
end $$;

select 'ANNEX_A_TRANSACTIONAL_SUPPRESSION_GATE_PASS' as result;
