-- Synthetic fixtures only. Real PostgreSQL transactions, role privileges and RLS.
create schema test_projects;
create function test_projects.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION_FAILED:%',label; end if; end $$;
create function test_projects.expect_error(query text,expected text) returns void language plpgsql as $$
begin
  begin execute query; exception when others then
    if position(expected in sqlerrm)>0 then return; end if;
    raise exception 'WRONG_ERROR:% EXPECTED:%',sqlerrm,expected;
  end;
  raise exception 'EXPECTED_FAILURE:%',expected;
end $$;
create function test_projects.append(org uuid,project uuid,kind text,data jsonb,key text) returns jsonb language plpgsql as $$
declare v integer; proof text;
begin
  v:=(public.ennco_projects_get(org,project)->'project'->>'version')::integer;
  if kind in ('calculation','proposal','supplier_quote','document','drive_setup') then
    proof:=test_projects.proof(org,auth.uid(),project,v,kind,data,key);
  end if;
  return public.ennco_projects_append(org,project,v,kind,data,key,proof);
end $$;
-- Test-only bridge, owned by the same restricted role used by the server signer.
-- It does not exist in migrations or deployed schemas; no secret leaves the DB.
create function test_projects.proof(org uuid,actor uuid,project uuid,v integer,kind text,data jsonb,key text)
returns text language sql security definer set search_path=pg_catalog,public,app,pg_temp as $$
  select public.ennco_projects_attest(org,actor,project,v,kind,data,key);
$$;
alter function test_projects.proof(uuid,uuid,uuid,integer,text,jsonb,text) owner to service_role;
grant usage on schema test_projects to authenticated;
grant usage on schema test_projects to service_role;
grant execute on all functions in schema test_projects to authenticated;
insert into public.organizations(id,slug,legal_name) values
 ('11111111-1111-4111-8111-111111111111','project-gate-a','Synthetic Projects A'),
 ('22222222-2222-4222-8222-222222222222','project-gate-b','Synthetic Projects B');
insert into public.organization_users(organization_id,user_id,role,active) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ennco_admin',true),
 ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ennco_operator',true),
 ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','ennco_operator',true),
 ('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','teckel_admin',true),
 ('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','auditor_readonly',true),
 ('11111111-1111-4111-8111-111111111111','abababab-abab-4bab-8bab-abababababab','ennco_operator',true),
 ('22222222-2222-4222-8222-222222222222','ffffffff-ffff-4fff-8fff-ffffffffffff','ennco_admin',true);
insert into public.accounts(id,organization_id,legal_name,normalized_name) values
 ('01010101-0101-4101-8101-010101010101','11111111-1111-4111-8111-111111111111','Synthetic account A','synthetic-a'),
 ('02020202-0202-4202-8202-020202020202','11111111-1111-4111-8111-111111111111','Synthetic account A2','synthetic-a2'),
 ('03030303-0303-4303-8303-030303030303','22222222-2222-4222-8222-222222222222','Synthetic account B','synthetic-b');
insert into public.opportunities(id,organization_id,account_id) values
 ('04040404-0404-4404-8404-040404040404','11111111-1111-4111-8111-111111111111','01010101-0101-4101-8101-010101010101'),
 ('05050505-0505-4505-8505-050505050505','22222222-2222-4222-8222-222222222222','03030303-0303-4303-8303-030303030303');
insert into auth.users(id,email,raw_user_meta_data) select user_id,'synthetic-'||left(user_id::text,8)||'@example.invalid','{"display_name":"Synthetic fixture"}' from public.organization_users;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare org uuid:='11111111-1111-4111-8111-111111111111'; p uuid; p2 uuid; created jsonb; r jsonb; bundle jsonb;
  calc_id text; proposal_id text; acceptance_id text; contract_id text; invoice_id text; payment_id text;
  order_id text; expense_id text; closure_id text; initial_version integer; before_retry integer;
  body jsonb; input jsonb:='{"name":"Fixture residencial","segment":"RESIDENTIAL","customerName":"Cliente sintético","data":{"ownerName":"Fixture","costMxn":99999,"accountId":"01010101-0101-4101-8101-010101010101","opportunityId":"04040404-0404-4404-8404-040404040404"}}';
begin
  perform test_projects.assert(jsonb_array_length(public.ennco_projects_member_list(org))=6,'directory lists active same organization only');
  perform test_projects.expect_error('select * from auth.users','permission denied');
  created:=public.ennco_projects_create(org,input,'create-fixture-1'); p:=(created->>'projectId')::uuid;
  perform test_projects.assert(created=public.ennco_projects_create(org,input,'create-fixture-1'),'idempotent creation');
  perform test_projects.assert(public.ennco_projects_get(org,p)->'project'->'data'->>'costMxn' is null,'unknown project data is not stored');
  perform test_projects.expect_error(format('select public.ennco_projects_create(%L,%L::jsonb,%L)',org,input||'{"name":"changed"}','create-fixture-1'),'PROJECT_IDEMPOTENCY_CONFLICT');
  perform test_projects.expect_error(format('select public.ennco_projects_get(%L,%L)','22222222-2222-4222-8222-222222222222',p),'PROJECT_FORBIDDEN');
  perform test_projects.expect_error('select * from public.ennco_project_records','permission denied');
  perform test_projects.expect_error('select * from public.ennco_projects','permission denied');
  perform test_projects.expect_error('select * from app.ennco_project_commands','permission denied');
  perform test_projects.expect_error(format('select public.ennco_projects_create(%L,%L::jsonb,%L)',org,
    input||'{"data":{"accountId":"03030303-0303-4303-8303-030303030303"}}','foreign-account-create'),'PROJECT_ACCOUNT_REFERENCE_INVALID');
  perform test_projects.expect_error(format('select public.ennco_projects_create(%L,%L::jsonb,%L)',org,
    input||'{"data":{"opportunityId":"05050505-0505-4505-8505-050505050505"}}','foreign-opportunity-create'),'PROJECT_OPPORTUNITY_REFERENCE_INVALID');
  perform test_projects.expect_error(format('select public.ennco_projects_create(%L,%L::jsonb,%L)',org,
    input||'{"data":{"accountId":"02020202-0202-4202-8202-020202020202","opportunityId":"04040404-0404-4404-8404-040404040404"}}','mismatched-account-create'),'PROJECT_ACCOUNT_OPPORTUNITY_MISMATCH');
  perform test_projects.expect_error(format('select public.ennco_projects_update(%L,%L,1,%L::jsonb,%L)',org,p,
    '{"data":{"accountId":"02020202-0202-4202-8202-020202020202"}}','partial-link-update'),'PROJECT_ACCOUNT_OPPORTUNITY_MISMATCH');
  perform test_projects.expect_error(format('select public.ennco_projects_update(%L,%L,1,%L::jsonb,%L)',org,p,
    '{"data":{"opportunityId":"05050505-0505-4505-8505-050505050505"}}','foreign-link-update'),'PROJECT_OPPORTUNITY_REFERENCE_INVALID');
  r:=test_projects.append(org,p,'note','{"text":"Evidence fixture"}','note-fixture-1');
  initial_version:=(r->>'version')::integer;
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L)',org,p,'note','{"text":"stale"}','stale-version-1'),'PROJECT_VERSION_CONFLICT');
  perform test_projects.assert(r=public.ennco_projects_append(org,p,1,'note','{"text":"Evidence fixture"}','note-fixture-1'),'append retry precedes version check');
  r:=test_projects.append(org,p,'calculation','{"input":{},"result":{"status":"APPROVED"},"reviewStatus":"APPROVED"}','calculate-fixture'); calc_id:=r->>'recordId';
  body:=jsonb_build_object('name','Synthetic proposal','calculationId',calc_id,'pricingMethod','COST_PLUS_MARGIN','subtotalMxn',1000,'vatMxn',160,'totalMxn',1160,'costMxn',400,'profitMxn',600,'marginPct',60,'costLines',jsonb_build_array(jsonb_build_object('unitCostMxn',400)));
  r:=test_projects.append(org,p,'proposal',body,'proposal-fixture'); proposal_id:=r->>'recordId';
  body:=jsonb_build_object('proposalId',proposal_id,'acceptedAt','2026-09-10','customerEvidence','Synthetic approval');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'proposal_acceptance',body,'accept-without-review'),'PROJECT_TECHNICAL_REVIEW_REQUIRED');
  r:=test_projects.append(org,p,'technical_review',jsonb_build_object('calculationId',calc_id,'decision','APPROVED','evidence','Synthetic independent result'),'technical-review');
  r:=test_projects.append(org,p,'proposal_acceptance',body,'accept-fixture'); acceptance_id:=r->>'recordId';
  body:=jsonb_build_object('proposalId',proposal_id,'acceptanceId',acceptance_id,'evidence','Synthetic signed contract','scope','Fixture',
    'subtotalMxn',1000,'vatMxn',160,'totalMxn',1160,'advanceAmountMxn',580,'schedule',
    jsonb_build_array(jsonb_build_object('id','advance','label','Anticipo','amountMxn',580,'dueDate','2026-09-10'),jsonb_build_object('id','final','label','Saldo','amountMxn',580,'dueDate','2026-09-30')));
  r:=test_projects.append(org,p,'contract',body,'contract-fixture'); contract_id:=r->>'recordId';
  body:=jsonb_build_object('supplier','Proveedor sintético','reference','PO-A','major',true,'deliveryDate','2026-09-20','evidence','Synthetic PO',
    'lines',jsonb_build_array(jsonb_build_object('id','line-1','category','Paneles solares','description','Fixture module','quantity',4,'unit','pza','unitCostMxn',100)),
    'subtotalMxn',400,'vatMxn',64,'totalMxn',464);
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'purchase_order',body,'order-before-advance'),'PROJECT_ADVANCE_REQUIRED');
  r:=test_projects.append(org,p,'customer_payment',jsonb_build_object('contractId',contract_id,'amountMxn',580,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','PENDING-1','evidence','Pending fixture','confirmed',false),'pending-advance');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'purchase_order',body,'order-pending-advance'),'PROJECT_ADVANCE_REQUIRED');
  r:=test_projects.append(org,p,'customer_invoice',jsonb_build_object('contractId',contract_id,'number','SYNTH-001','date','2026-09-10','evidence','Synthetic invoice',
    'subtotalMxn',1000,'vatMxn',160,'totalMxn',1160),'invoice-fixture'); invoice_id:=r->>'recordId';
  r:=test_projects.append(org,p,'customer_payment',jsonb_build_object('contractId',contract_id,'invoiceId',invoice_id,'scheduleId','advance','amountMxn',580,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','CLIENT-ADVANCE','evidence','Confirmed synthetic receipt','confirmed',true),'confirmed-advance'); payment_id:=r->>'recordId';
  r:=test_projects.append(org,p,'purchase_order',body,'order-fixture'); order_id:=r->>'recordId';
  r:=test_projects.append(org,p,'material_receipt',jsonb_build_object('purchaseOrderId',order_id,'evidence','Synthetic reception','lines',jsonb_build_array(jsonb_build_object('lineId','line-1','quantity',2))),'receipt-first-half');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'material_receipt',
    jsonb_build_object('purchaseOrderId',order_id,'evidence','Synthetic reception','lines',jsonb_build_array(jsonb_build_object('lineId','line-1','quantity',3))),'receipt-over-order'),'PROJECT_RECEIPT_EXCEEDS_ORDER');
  body:=jsonb_build_object('purchaseOrderId',order_id,'supplier','Proveedor sintético','invoiceNumber','EXP-1','category','Paneles solares','description','Modules fixture','evidence','Synthetic expense','subtotalMxn',400,'vatMxn',64,'totalMxn',464,'costBasisMxn',400);
  r:=test_projects.append(org,p,'expense',body,'expense-fixture'); expense_id:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'expense',body,'duplicate-expense'),'PROJECT_EXPENSE_DUPLICATE');
  r:=test_projects.append(org,p,'supplier_payment',jsonb_build_object('expenseId',expense_id,'amountMxn',232,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','SUPPLIER-PARTIAL','evidence','Synthetic bank payment'),'supplier-partial');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'supplier_payment',jsonb_build_object('expenseId',expense_id,'amountMxn',233,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','SUPPLIER-OVER','evidence','Synthetic overpayment'),'supplier-overpayment'),'PROJECT_PAYMENT_EXCEEDS_EXPENSE');
  r:=test_projects.append(org,p,'technical_closure','{"checks":{"installation":true,"tests":true,"handover":true},"evidence":"Synthetic technical delivery"}','technical-close');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'financial_closure','{"evidence":"Synthetic closure"}','close-outstanding'),'PROJECT_EVIDENCE_REQUIRED:exceptionReason');
  r:=test_projects.append(org,p,'customer_payment',jsonb_build_object('contractId',contract_id,'invoiceId',invoice_id,'scheduleId','final','amountMxn',580,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','CLIENT-FINAL','evidence','Confirmed synthetic final','confirmed',true),'final-payment');
  r:=test_projects.append(org,p,'supplier_payment',jsonb_build_object('expenseId',expense_id,'amountMxn',232,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','SUPPLIER-FINAL','evidence','Synthetic final supplier payment'),'supplier-final');
  r:=test_projects.append(org,p,'financial_closure','{"evidence":"Synthetic reconciliation"}','financial-close'); closure_id:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'expense',body,'expense-after-close'),'PROJECT_FINANCIALLY_CLOSED');
  r:=public.ennco_projects_update(org,p,(r->>'version')::integer,'{"stage":"CLOSED"}','stage-closed');
  perform test_projects.assert(public.ennco_projects_get(org,p)->'project'->>'stage'='CLOSED','separate closures permit closed label');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'calculation','{"input":{},"result":{}}','calculation-after-closure'),'PROJECT_TECHNICALLY_CLOSED');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'progress','{"percent":100,"evidence":"Fixture"}','progress-after-closure'),'PROJECT_TECHNICALLY_CLOSED');
  r:=test_projects.append(org,p,'note','{"text":"Notes remain possible after both closures"}','note-after-closures');
  -- Ledger mutations require an explicit reversal of the closure, never automatic force.
  perform public.ennco_projects_member_set(org,'abababab-abab-4bab-8bab-abababababab',array['administration'],'administration-membership');
  perform set_config('request.jwt.claim.sub','abababab-abab-4bab-8bab-abababababab',true);
  r:=test_projects.append(org,p,'reversal',jsonb_build_object('recordId',closure_id,'reason','Synthetic reopened reconciliation','evidence','Synthetic correction support'),'reopen-financial-admin');
  perform test_projects.assert(public.ennco_projects_get(org,p)->'project'->>'stage'='COLLECTION','reopened financial close clears closed label');
  r:=test_projects.append(org,p,'expense','{"supplier":"Synthetic late supplier","invoiceNumber":"LATE-1","subtotalMxn":50,"vatMxn":8,"totalMxn":58,"costBasisMxn":50,"evidence":"Synthetic late expense"}','expense-after-reopen');
  body:=jsonb_build_object('expenseId',r->>'recordId','amountMxn',58,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','SUPPLIER-LATE','evidence','Synthetic late payment');
  r:=test_projects.append(org,p,'supplier_payment',body,'late-supplier-payment');
  r:=test_projects.append(org,p,'financial_closure','{"evidence":"Synthetic second reconciliation"}','financial-reclosed');
  perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  select item->>'id' into closure_id from jsonb_array_elements(public.ennco_projects_get(org,p)->'records') item where item->>'kind'='technical_closure';
  perform set_config('request.jwt.claim.sub','abababab-abab-4bab-8bab-abababababab',true);
  r:=test_projects.append(org,p,'reversal',jsonb_build_object('recordId',closure_id,'reason','Synthetic study correction','evidence','Synthetic correction support'),'reopen-technical-admin');
  perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  r:=test_projects.append(org,p,'calculation','{"input":{},"result":{}}','calculation-after-reopen');
  r:=test_projects.append(org,p,'progress','{"percent":100,"evidence":"Synthetic progress verification"}','progress-after-reopen');
  r:=test_projects.append(org,p,'technical_closure','{"checks":{"installation":true,"tests":true,"handover":true},"evidence":"Synthetic updated technical close"}','technical-reclosed');
  -- Storage reception remains available after signed closures without changing finances.
  r:=test_projects.append(org,p,'material_receipt',jsonb_build_object('purchaseOrderId',order_id,'evidence','Synthetic reception after closures','lines',jsonb_build_array(jsonb_build_object('lineId','line-1','quantity',2))),'receipt-second-half');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'reversal',jsonb_build_object('recordId',payment_id,'reason','Synthetic correction','evidence','Fixture'),'reverse-payment-with-closed-finances'),'PROJECT_FINANCIALLY_CLOSED');

  perform public.ennco_projects_member_set(org,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',array['engineering'],'engineering-membership');
  perform public.ennco_projects_member_set(org,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',array['purchases'],'purchases-membership');
  perform public.ennco_projects_member_set(org,'abababab-abab-4bab-8bab-abababababab',array['administration'],'administration-membership');
  perform public.ennco_projects_catalog_save(org,'{"category":"modules","name":"Synthetic module","version":1,"data":{"powerWp":500,"unitCostMxn":100,"marginPct":10},"sourceDate":"2026-09-10","sourceUrl":"https://example.invalid/test","status":"APPROVED"}','catalog-fixture');
  -- Private object permissions are enforced before a Drive/document registry exists.
  insert into storage.objects(bucket_id,name) values('ennco-project-documents',org::text||'/'||p::text||'/ADMIN/invoice-fixture.pdf');
  insert into storage.objects(bucket_id,name) values('ennco-project-documents',org::text||'/'||p::text||'/TEAM/survey-fixture.pdf');
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  bundle:=public.ennco_projects_get(org,p);
  perform test_projects.assert(bundle::text not like '%unitCostMxn%' and bundle::text not like '%profitMxn%' and bundle::text not like '%marginPct%','engineering financial projection including acceptance snapshot');
  perform test_projects.assert(not exists(select 1 from jsonb_array_elements(bundle->'records') record_item where record_item->>'kind'='expense'),'engineering cannot read expense');
  perform test_projects.assert((select count(*) from storage.objects where bucket_id='ennco-project-documents')=1,'engineering sees team only in private storage');
  perform test_projects.expect_error(format('insert into storage.objects(bucket_id,name) values(%L,%L)','ennco-project-documents',org::text||'/'||p::text||'/ADMIN/forbidden.pdf'),'row-level security');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'purchase_exception','{"reason":"Synthetic exception","evidence":"Fixture"}','engineer-exception'),'PROJECT_FORBIDDEN_KIND');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'technical_review',jsonb_build_object('calculationId',calc_id,'decision','APPROVED','evidence','Self approval'),'engineer-self-approval'),'PROJECT_FORBIDDEN_KIND');
  perform test_projects.assert(public.ennco_projects_catalog_list(org)::text not like '%unitCostMxn%','catalog hides acquisition costs');
  perform set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
  bundle:=public.ennco_projects_get(org,p);
  perform test_projects.assert(bundle::text like '%unitCostMxn%' and bundle::text not like '%profitMxn%' and bundle::text not like '%marginPct%','purchases cost scope excludes margin');
  perform set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
  bundle:=public.ennco_projects_get(org,p);
  perform test_projects.assert(bundle::text like '%profitMxn%' and bundle->'permissions'->'canApprove'='false'::jsonb,'technical admin full read but no business powers');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'purchase_exception','{"reason":"No business grant","evidence":"Fixture"}','technical-exception'),'PROJECT_FORBIDDEN');
  perform set_config('request.jwt.claim.sub','abababab-abab-4bab-8bab-abababababab',true);
  perform test_projects.expect_error(format('select public.ennco_projects_member_list(%L)',org),'PROJECT_FORBIDDEN');
  bundle:=public.ennco_projects_get(org,p);
  perform test_projects.assert(bundle->'permissions'->'canConfirmPayments'='true'::jsonb and bundle->'permissions'->'canApprove'='false'::jsonb,'functional administration cash authority but no direction');
  perform test_projects.assert(bundle->'permissions'->'canReadMargins'='false'::jsonb and bundle::text not like '%profitMxn%' and bundle::text like '%costBasisMxn%','functional administration sees costs but no explicit global margins');
  perform set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
  perform test_projects.assert(public.ennco_projects_permissions(org)->'readOnly'='true'::jsonb,'auditor readonly');
  perform test_projects.expect_error(format('select public.ennco_projects_create(%L,%L::jsonb,%L)',org,input,'auditor-create'),'PROJECT_FORBIDDEN');
  perform set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
  perform test_projects.expect_error(format('select public.ennco_projects_get(%L,%L)',org,p),'PROJECT_FORBIDDEN');
  perform set_config('request.jwt.claim.sub','',true);
  perform test_projects.expect_error(format('select public.ennco_projects_list(%L)',org),'PROJECT_FORBIDDEN');
  perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  -- Cover both remaining segments and reversal dependency protection.
  r:=public.ennco_projects_create(org,'{"name":"Fixture comercial","segment":"COMMERCIAL","customerName":"Synthetic"}','commercial-fixture');
  p2:=(r->>'projectId')::uuid;
  perform test_projects.assert(public.ennco_projects_get(org,p2)->'project'->>'folio'<>public.ennco_projects_get(org,p)->'project'->>'folio','unique org folio');
  perform public.ennco_projects_create(org,'{"name":"Fixture industrial","segment":"INDUSTRIAL","customerName":"Synthetic"}','industrial-fixture');
  perform test_projects.assert(jsonb_array_length(public.ennco_projects_list(org))=3,'three supported segment project records');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'reversal',jsonb_build_object('recordId',expense_id,'reason','Correction','evidence','Fixture'),'reverse-paid-expense'),'PROJECT_REVERSAL_HAS_DEPENDENCIES');
  perform test_projects.expect_error(format('select public.ennco_projects_update(%L,%L,1,%L::jsonb,%L)',org,p2,'{"stage":"CLOSED"}','premature-closed'),'PROJECT_CLOSURES_REQUIRED');
  r:=test_projects.append(org,p2,'purchase_exception','{"reason":"Synthetic urgent replacement before contract","evidence":"Director synthetic instruction"}','director-exception');
  r:=test_projects.append(org,p2,'purchase_order','{"supplier":"Synthetic supplier","reference":"PO-EX","major":false,"deliveryDate":"2026-09-30","lines":[{"id":"ex1","quantity":1,"unitCostMxn":100}],"subtotalMxn":100,"vatMxn":16,"totalMxn":116,"evidence":"Synthetic exception purchase"}','exception-unlocks-order');
  perform test_projects.assert(r->>'recordId' is not null,'documented direction exception permits purchase without advance');
  body:=jsonb_build_object('ownerEmail','contacto@ennco.com.mx','rootId','synthetic-root','folderId','synthetic-project-folder','sections',jsonb_build_object('Información del cliente','synthetic-section'));
  r:=test_projects.append(org,p2,'drive_setup',body,'reserve-drive-folders');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p2,'drive_setup',body,'duplicate-drive-reservation'),'PROJECT_DRIVE_ALREADY_RESERVED');
  r:=test_projects.append(org,p2,'calculation','{"input":{},"result":{"missingData":["Synthetic required input"],"warnings":[]},"reviewStatus":"APPROVED"}','incomplete-calculation');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p2,'technical_review',jsonb_build_object('calculationId',r->>'recordId','decision','APPROVED','evidence','Synthetic independent review'),'approve-incomplete-calculation'),'PROJECT_ENGINEERING_DATA_INCOMPLETE');
end;
$$;
reset role;
-- Direct immutable row mutation is denied even to migration owner by trigger.
select test_projects.expect_error('update public.ennco_project_records set data=''{}''::jsonb','PROJECT_APPEND_ONLY');
select test_projects.assert(app.ennco_project_business_date('2026-09-11'::date,5)='2026-09-21'::date,'five business days exclude weekend and Sep16 holiday');
select test_projects.assert((select count(*) from public.ennco_projects)=3,'no duplicated creates');
select test_projects.assert((select count(*) from app.ennco_project_audit)>20,'every command is audited');
select test_projects.assert((select count(*) from public.opportunities)=2,'operational projects do not add to the two CRM fixtures');
select test_projects.assert((select count(*) from public.leads)=0,'operational projects never count as leads');
select test_projects.assert((select count(*) from public.payments)=0,'operational payments do not create commission events');
select test_projects.assert((select count(*) from public.commissions)=0,'operational payments do not create commissions');
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare org uuid:='11111111-1111-4111-8111-111111111111'; p uuid; r jsonb; body jsonb; data_value jsonb;
  proposal_id text; contract_id text; payment_a text; payment_b text; pending_id text; allocation_a text; allocation_b text;
  expense_id text; supplier_id text; schedule_id text; change_id text; closure_id text; v integer;
begin
  r:=public.ennco_projects_create(org,'{"name":"Synthetic allocation ledger","segment":"COMMERCIAL","customerName":"Synthetic","data":{"accountId":"01010101-0101-4101-8101-010101010101","opportunityId":"04040404-0404-4404-8404-040404040404","ownerName":"Initial owner","dueDate":"2026-09-30","latitude":20,"longitude":-100}}','allocation-project'); p:=(r->>'projectId')::uuid;
  r:=public.ennco_projects_update(org,p,1,'{"data":{"ownerName":"Updated owner"}}','metadata-keep-absent');
  data_value:=public.ennco_projects_get(org,p)->'project'->'data';
  perform test_projects.assert(data_value->>'accountId' is not null and data_value->>'dueDate'='2026-09-30','absent metadata fields retain current values');
  r:=public.ennco_projects_update(org,p,2,'{"data":{"accountId":null,"opportunityId":null,"dueDate":null,"latitude":null,"longitude":null}}','metadata-clear-null');
  data_value:=public.ennco_projects_get(org,p)->'project'->'data';
  perform test_projects.assert(data_value='{"ownerName":"Updated owner"}'::jsonb,'explicit null removes five optional metadata fields');
  perform test_projects.assert(r=public.ennco_projects_update(org,p,2,'{"data":{"accountId":null,"opportunityId":null,"dueDate":null,"latitude":null,"longitude":null}}','metadata-clear-null'),'clear metadata retries remain idempotent');
  r:=public.ennco_projects_update(org,p,3,'{"data":{"accountId":"02020202-0202-4202-8202-020202020202"}}','metadata-new-account');
  perform test_projects.expect_error(format('select public.ennco_projects_update(%L,%L,4,%L::jsonb,%L)',org,p,'{"data":{"opportunityId":"04040404-0404-4404-8404-040404040404"}}','metadata-invalid-merge'),'PROJECT_ACCOUNT_OPPORTUNITY_MISMATCH');
  r:=public.ennco_projects_update(org,p,4,'{"data":{"accountId":null,"opportunityId":"04040404-0404-4404-8404-040404040404"}}','metadata-clear-and-link');
  perform test_projects.assert(public.ennco_projects_get(org,p)->'project'->'data'->>'accountId' is null,'coherence check follows null removals');

  r:=test_projects.append(org,p,'proposal','{"name":"Synthetic ledger proposal","pricingMethod":"COST_PLUS_MARGIN","subtotalMxn":1000,"vatMxn":0,"totalMxn":1000}','allocation-proposal'); proposal_id:=r->>'recordId';
  r:=test_projects.append(org,p,'proposal_acceptance',jsonb_build_object('proposalId',proposal_id,'customerEvidence','Synthetic acceptance'),'allocation-acceptance');
  r:=test_projects.append(org,p,'contract',jsonb_build_object('proposalId',proposal_id,'subtotalMxn',1000,'vatMxn',0,'totalMxn',1000,'advanceAmountMxn',400,'evidence','Synthetic contract','schedule','[{"id":"advance","amountMxn":400,"dueDate":"2026-09-10"},{"id":"final","amountMxn":600,"dueDate":"2026-09-30"}]'::jsonb),'allocation-contract'); contract_id:=r->>'recordId';
  r:=test_projects.append(org,p,'customer_invoice',jsonb_build_object('contractId',contract_id,'number','ALLOC-INVOICE','subtotalMxn',1000,'vatMxn',0,'totalMxn',1000,'evidence','Synthetic invoice'),'allocation-invoice');
  body:=jsonb_build_object('contractId',contract_id,'amountMxn',500,'confirmed',true,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','BANK-A','evidence','Synthetic payment A');
  v:=(public.ennco_projects_get(org,p)->'project'->>'version')::integer;
  r:=test_projects.append(org,p,'customer_payment',body,'allocation-payment-a'); payment_a:=r->>'recordId';
  perform test_projects.assert(r=public.ennco_projects_append(org,p,v,'customer_payment',body,'allocation-payment-a'),'exact payment replay bypasses duplicate check');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment',body||'{"reference":" bank-a ","method":" transfer ","paidAt":"2026-09-10T06:00:00-06:00","amountMxn":1}','allocation-duplicate-customer'),'PROJECT_PAYMENT_DUPLICATE');
  body:=jsonb_build_object('paymentId',payment_a,'allocations','[{"scheduleId":"advance","amountMxn":300},{"scheduleId":"final","amountMxn":200}]'::jsonb,'reason','Synthetic split','evidence','Synthetic allocation evidence');
  r:=test_projects.append(org,p,'customer_payment_allocation',body,'allocation-first-split'); allocation_a:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',body||'{"allocations":[{"scheduleId":"advance","amountMxn":300}]}','allocation-wrong-total'),'PROJECT_ALLOCATION_TOTAL_MISMATCH');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',body||'{"allocations":[{"scheduleId":"advance","amountMxn":250},{"scheduleId":"advance","amountMxn":250}]}','allocation-duplicate-schedule'),'PROJECT_ALLOCATION_SCHEDULE_DUPLICATE');
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',body,'allocation-engineer-denied'),'PROJECT_FORBIDDEN_KIND');
  perform set_config('request.jwt.claim.sub','abababab-abab-4bab-8bab-abababababab',true);
  r:=test_projects.append(org,p,'customer_payment_allocation',body||'{"allocations":[{"scheduleId":"advance","amountMxn":400},{"scheduleId":"final","amountMxn":100}]}','allocation-admin-reassign'); allocation_b:=r->>'recordId';
  perform test_projects.assert(exists(select 1 from jsonb_array_elements(public.ennco_projects_get(org,p)->'records') item where item->>'id'=allocation_a and item->'data'->'allocations'->0->>'amountMxn'='300'),'reassignment preserves original immutable allocation');
  body:=jsonb_build_object('contractId',contract_id,'scheduleId','advance','amountMxn',50,'confirmed',true,'paidAt','2026-09-10T13:00:00Z','method','TRANSFER','reference','BANK-DIRECT','evidence','Synthetic direct payment');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment',body,'allocation-direct-conflict'),'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT');
  body:=body-'scheduleId'||'{"amountMxn":500,"reference":"BANK-B"}';
  r:=test_projects.append(org,p,'customer_payment',body,'allocation-payment-b'); payment_b:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'financial_closure','{"evidence":"Cash complete but unallocated","exceptionReason":"Not direction"}','allocation-admin-close-unassigned'),'PROJECT_FORBIDDEN');
  perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'financial_closure','{"evidence":"Cash complete but unallocated"}','allocation-director-close-unassigned'),'PROJECT_EVIDENCE_REQUIRED:exceptionReason');
  body:=jsonb_build_object('paymentId',payment_b,'allocations','[{"scheduleId":"advance","amountMxn":1},{"scheduleId":"final","amountMxn":499}]'::jsonb,'reason','Synthetic conflicting split','evidence','Synthetic allocation');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',body,'allocation-conflicting-split'),'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT');
  r:=test_projects.append(org,p,'customer_payment_allocation',body||'{"allocations":[{"scheduleId":"final","amountMxn":500}]}','allocation-payment-b-final');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'reversal',jsonb_build_object('recordId',allocation_b,'reason','Synthetic revert','evidence','Synthetic proof'),'allocation-reverse-conflict'),'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT');
  r:=test_projects.append(org,p,'customer_payment',jsonb_build_object('contractId',contract_id,'amountMxn',10,'confirmed',false,'paidAt','2026-09-10T14:00:00Z','method','TRANSFER','reference','BANK-PENDING','evidence','Synthetic pending payment'),'allocation-pending-payment'); pending_id:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',jsonb_build_object('paymentId',pending_id,'allocations','[{"scheduleId":"final","amountMxn":10}]'::jsonb,'reason','Synthetic invalid pending assignment','evidence','Synthetic proof'),'allocation-pending-denied'),'PROJECT_CONFIRMED_PAYMENT_REQUIRED');
  r:=test_projects.append(org,p,'reversal',jsonb_build_object('recordId',pending_id,'reason','Synthetic bank correction','evidence','Synthetic proof'),'allocation-reverse-pending');
  r:=test_projects.append(org,p,'customer_payment',jsonb_build_object('contractId',contract_id,'amountMxn',10,'confirmed',false,'paidAt','2026-09-10T14:00:00Z','method','TRANSFER','reference','BANK-PENDING','evidence','Synthetic corrected pending payment'),'allocation-pending-corrected');

  body:=jsonb_build_object('contractId',contract_id,'schedule','[{"id":"advance","amountMxn":400,"dueDate":"2026-09-10"},{"id":"final","amountMxn":600,"dueDate":"2026-10-10"}]'::jsonb,'reason','Synthetic schedule extension','evidence','Synthetic amendment');
  r:=test_projects.append(org,p,'payment_schedule',body,'allocation-schedule-revision');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'payment_schedule',body||'{"schedule":[{"id":"advance","amountMxn":1000,"dueDate":"2026-10-10"}]}','allocation-remove-paid-id'),'PROJECT_PAID_INSTALLMENT_REMOVAL');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'payment_schedule',body||'{"schedule":[{"id":"advance","amountMxn":300,"dueDate":"2026-10-10"},{"id":"final","amountMxn":700,"dueDate":"2026-10-10"}]}','allocation-reduce-paid-quota'),'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT');
  r:=test_projects.append(org,p,'change_order','{"saleDeltaMxn":100,"saleVatDeltaMxn":0,"costDeltaMxn":0,"evidence":"Synthetic additional","reason":"Synthetic additional scope"}','allocation-additional'); change_id:=r->>'recordId';
  r:=test_projects.append(org,p,'change_approval',jsonb_build_object('changeOrderId',change_id,'decision','APPROVED','evidence','Synthetic approved additional'),'allocation-additional-approved');
  body:=body||'{"schedule":[{"id":"advance","amountMxn":400,"dueDate":"2026-09-10"},{"id":"final","amountMxn":600,"dueDate":"2026-10-10"},{"id":"additional","amountMxn":100,"dueDate":"2026-10-20"}]}';
  r:=test_projects.append(org,p,'payment_schedule',body,'allocation-additional-schedule'); schedule_id:=r->>'recordId';
  r:=test_projects.append(org,p,'customer_invoice',jsonb_build_object('contractId',contract_id,'number','ALLOC-ADDITIONAL','subtotalMxn',100,'vatMxn',0,'totalMxn',100,'evidence','Synthetic additional invoice'),'allocation-additional-invoice');
  r:=test_projects.append(org,p,'customer_payment',jsonb_build_object('contractId',contract_id,'scheduleId','additional','amountMxn',100,'confirmed',true,'paidAt','2026-09-11T12:00:00Z','method','TRANSFER','reference','BANK-ADDITIONAL','evidence','Synthetic additional payment'),'allocation-additional-payment');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'reversal',jsonb_build_object('recordId',schedule_id,'reason','Synthetic revert schedule','evidence','Synthetic proof'),'allocation-reverse-paid-schedule'),'PROJECT_PAID_INSTALLMENT_REMOVAL');
  r:=test_projects.append(org,p,'expense','{"supplier":"Synthetic supplier allocation","invoiceNumber":"ALLOC-EXP","subtotalMxn":100,"vatMxn":0,"totalMxn":100,"costBasisMxn":100,"evidence":"Synthetic expense"}','allocation-expense'); expense_id:=r->>'recordId';
  body:=jsonb_build_object('expenseId',expense_id,'amountMxn',50,'paidAt','2026-09-10T12:00:00Z','method','TRANSFER','reference','SUPPLIER-REF','evidence','Synthetic supplier payment');
  r:=test_projects.append(org,p,'supplier_payment',body,'allocation-supplier-payment'); supplier_id:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'supplier_payment',body||'{"reference":" supplier-ref ","method":" transfer ","paidAt":"2026-09-10T06:00:00-06:00"}','allocation-duplicate-supplier'),'PROJECT_PAYMENT_DUPLICATE');
  r:=test_projects.append(org,p,'reversal',jsonb_build_object('recordId',supplier_id,'reason','Synthetic supplier correction','evidence','Synthetic proof'),'allocation-reverse-supplier');
  r:=test_projects.append(org,p,'supplier_payment',body||'{"amountMxn":100}','allocation-corrected-supplier');
  r:=test_projects.append(org,p,'financial_closure','{"evidence":"Synthetic reconciled allocations and revised schedule"}','allocation-reconciled-close'); closure_id:=r->>'recordId';
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',jsonb_build_object('paymentId',payment_b,'allocations','[{"scheduleId":"final","amountMxn":500}]'::jsonb,'reason','Synthetic closed reassignment','evidence','Synthetic proof'),'allocation-after-close'),'PROJECT_FINANCIALLY_CLOSED');
  r:=test_projects.append(org,p,'reversal',jsonb_build_object('recordId',closure_id,'reason','Synthetic reopen to correct distribution','evidence','Synthetic proof'),'allocation-reopen-close');
  r:=test_projects.append(org,p,'reversal',jsonb_build_object('recordId',payment_b,'reason','Synthetic payment correction','evidence','Synthetic proof'),'allocation-reverse-payment-with-history');
  body:=jsonb_build_object('contractId',contract_id,'schedule','[{"id":"advance","amountMxn":400,"dueDate":"2026-09-10"},{"id":"final","amountMxn":100,"dueDate":"2026-10-10"},{"id":"replacement","amountMxn":500,"dueDate":"2026-10-10"},{"id":"additional","amountMxn":100,"dueDate":"2026-10-20"}]'::jsonb,'reason','Synthetic alternative schedule','evidence','Synthetic proof');
  r:=test_projects.append(org,p,'payment_schedule',body,'allocation-replacement-schedule');
  r:=test_projects.append(org,p,'customer_payment_allocation',jsonb_build_object('paymentId',payment_a,'allocations','[{"scheduleId":"replacement","amountMxn":500}]'::jsonb,'reason','Synthetic move to replacement','evidence','Synthetic proof'),'allocation-move-before-removal'); allocation_b:=r->>'recordId';
  body:=body||'{"schedule":[{"id":"replacement","amountMxn":1000,"dueDate":"2026-10-10"},{"id":"additional","amountMxn":100,"dueDate":"2026-10-20"}]}';
  r:=test_projects.append(org,p,'payment_schedule',body,'allocation-remove-unpaid-ids');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'reversal',jsonb_build_object('recordId',allocation_b,'reason','Synthetic invalid restored schedule IDs','evidence','Synthetic proof'),'allocation-reverse-removed-schedule'),'PROJECT_SCHEDULE_REFERENCE_INVALID');
  perform test_projects.expect_error(format('select test_projects.append(%L,%L,%L,%L::jsonb,%L)',org,p,'customer_payment_allocation',jsonb_build_object('paymentId',payment_b,'allocations','[{"scheduleId":"replacement","amountMxn":500}]'::jsonb,'reason','Synthetic reversed payment','evidence','Synthetic proof'),'allocation-reversed-payment-denied'),'PROJECT_REFERENCE_INVALID:customer_payment');
end;
$$;
reset role;
-- RLS still denies raw reads even if a future global migration grants SELECT.
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare org uuid:='11111111-1111-4111-8111-111111111111'; p uuid; other_project uuid; r jsonb; result jsonb;
  proof text; payload jsonb:='{"input":{},"result":{"status":"SYNTHETIC"}}'; kind text; v integer;
begin
  r:=public.ennco_projects_create(org,'{"name":"Synthetic signed server output","segment":"INDUSTRIAL","customerName":"Synthetic"}','attestation-project'); p:=(r->>'projectId')::uuid;
  select (item->>'id')::uuid into other_project from jsonb_array_elements(public.ennco_projects_list(org)) item where item->>'id'<>p::text limit 1;
  perform test_projects.expect_error('select secret from app.ennco_project_signing_secret','permission denied');
  perform test_projects.expect_error(format('select public.ennco_projects_attest(%L,%L,%L,1,%L,%L::jsonb,%L)',org,auth.uid(),p,'calculation',payload,'attestation-genuine'),'permission denied');
  perform test_projects.expect_error(format('select app.ennco_project_attestation(%L,%L,%L,1,%L,%L::jsonb,%L)',org,auth.uid(),p,'calculation',payload,'attestation-genuine'),'permission denied');
  foreach kind in array array['calculation','proposal','supplier_quote','document','drive_setup'] loop
    perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L)',org,p,kind,payload,'attestation-unsigned-'||kind),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  end loop;
  proof:=test_projects.proof(org,auth.uid(),p,1,'calculation',payload,'attestation-genuine');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L,%L)',org,p,'calculation',payload||'{"result":{"status":"FORGED"}}','attestation-genuine',proof),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L,%L)',org,other_project,'calculation',payload,'attestation-genuine',proof),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L,%L)',org,p,'proposal',payload,'attestation-genuine',proof),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,2,%L,%L::jsonb,%L,%L)',org,p,'calculation',payload,'attestation-genuine',proof),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L,%L)',org,p,'calculation',payload,'attestation-other-key',proof),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L,%L)',org,p,'calculation',payload,'attestation-genuine',proof),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  result:=public.ennco_projects_append(org,p,1,'calculation',payload,'attestation-genuine',proof);
  r:=test_projects.append(org,p,'note','{"text":"Advance the version after signed append"}','attestation-later-note');
  perform test_projects.assert(result=public.ennco_projects_append(org,p,1,'calculation',payload,'attestation-genuine',proof),'signed replay returns original after later edits');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,1,%L,%L::jsonb,%L)',org,p,'calculation',payload,'attestation-genuine'),'PROJECT_SERVER_ATTESTATION_REQUIRED');
  perform test_projects.expect_error(format('select test_projects.proof(%L,%L,%L,3,%L,%L::jsonb,%L)',org,auth.uid(),p,'purchase_exception','{"reason":"Synthetic exception","evidence":"Synthetic proof"}','attestation-forbidden-kind'),'PROJECT_ATTESTATION_KIND_INVALID');
  -- A valid server signature grants neither Engineering nor business approval.
  perform set_config('request.jwt.claim.sub','abababab-abab-4bab-8bab-abababababab',true);
  v:=(public.ennco_projects_get(org,p)->'project'->>'version')::integer;
  proof:=test_projects.proof(org,auth.uid(),p,v,'calculation',payload,'attestation-role-denied');
  perform test_projects.expect_error(format('select public.ennco_projects_append(%L,%L,%s,%L,%L::jsonb,%L,%L)',org,p,v,'calculation',payload,'attestation-role-denied',proof),'PROJECT_FORBIDDEN_KIND');
end;
$$;
reset role;
set role service_role;
select test_projects.expect_error('select secret from app.ennco_project_signing_secret','permission denied');
select test_projects.expect_error('select public.ennco_projects_append(null,null,1,''note'',''{}''::jsonb,''service-cannot-write'')','permission denied');
reset role;
grant select on public.ennco_projects,public.ennco_project_records to authenticated;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select test_projects.assert((select count(*) from public.ennco_projects)=0,'RLS protects project raw data despite global grants');
select test_projects.assert((select count(*) from public.ennco_project_records)=0,'RLS protects record raw data despite global grants');
reset role;
revoke select on public.ennco_projects,public.ennco_project_records from authenticated;
-- Storage fixtures retain no real files; remove only gate objects before rollback.
delete from storage.objects where bucket_id='ennco-project-documents';
