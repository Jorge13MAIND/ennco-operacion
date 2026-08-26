\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
('32100000-0000-4000-8000-000000000001','m021-a','M021 Synthetic A'),
('32100000-0000-4000-8000-000000000002','m021-b','M021 Synthetic B');
insert into public.organization_users(organization_id,user_id,role) values
('32100000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000001','teckel_admin'),
('32100000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000002','ennco_admin'),
('32100000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000003','auditor_readonly'),
('32100000-0000-4000-8000-000000000002','32110000-0000-4000-8000-000000000004','teckel_admin');
insert into public.runtime_controls(organization_id) values('32100000-0000-4000-8000-000000000001'),('32100000-0000-4000-8000-000000000002');
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret) values
('32100000-0000-4000-8000-000000000001',repeat('a',32),repeat('b',64)),
('32100000-0000-4000-8000-000000000002',repeat('c',32),repeat('d',64));
select set_config('app.research_rpc_write','true',false);
insert into public.accounts(id,organization_id,legal_name,normalized_name,primary_domain,evidence_class,source_confidence) values
('32120000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','M021 Synthetic','m021 synthetic','m021.invalid','synthetic_demo','VERIFIED'),
('32120000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000002','M021 Foreign','m021 foreign','foreign-m021.invalid','synthetic_demo','VERIFIED');
insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence) values
('32130000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021 Delete One','CEO','delete-one@m021.invalid',true,now(),'VERIFIED'),
('32130000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021 Hold Then Delete','CEO','hold-delete@m021.invalid',true,now(),'VERIFIED'),
('32130000-0000-4000-8000-000000000005','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021 No Tombstone','CEO','no-tombstone@m021.invalid',true,now(),'VERIFIED'),
('32130000-0000-4000-8000-000000000003','32100000-0000-4000-8000-000000000002','32120000-0000-4000-8000-000000000002','M021 Foreign','CEO','foreign@m021.invalid',true,now(),'VERIFIED');

insert into public.campaigns(id,organization_id,name,manifest_json,manifest_sha256) values
('32300000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','M021 First','{}',repeat('1',64)),
('32300000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','M021 Rollout','{}',repeat('2',64));
insert into public.sequence_versions(id,organization_id,campaign_id,version,sender_name,sender_title,content_sha256) values
('32310000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000001',1,'M021','CEO',repeat('3',64)),
('32310000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000002',1,'M021','CEO',repeat('4',64));
insert into public.mailboxes(id,organization_id,normalized_email,domain,sender_name) values
('32320000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','sender@m021.invalid','m021.invalid','M021');
insert into public.campaign_enrollments(id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status) values
('32330000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000001','32310000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','32320000-0000-4000-8000-000000000001','COMPLETED'),
('32330000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000002','32310000-0000-4000-8000-000000000002','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','32320000-0000-4000-8000-000000000001','COMPLETED');
insert into public.first_send_batches(id,organization_id,campaign_id,manifest_sha256) values
('32340000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000001',repeat('5',64));
insert into public.first_send_batch_enrollments(id,organization_id,batch_id,enrollment_id,account_id,contact_id,mailbox_id,sequence_version_id,contact_email_sha256,sequence_content_sha256) values
('32350000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32340000-0000-4000-8000-000000000001','32330000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','32320000-0000-4000-8000-000000000001','32310000-0000-4000-8000-000000000001',encode(digest('delete-one@m021.invalid','sha256'),'hex'),repeat('3',64));
set request.jwt.claim.sub='32110000-0000-4000-8000-000000000001';
insert into public.approvals(id,organization_id,subject_type,subject_id,subject_sha256,decision,decided_by,rationale) values
('32360000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','synthetic_rollout_fixture','32300000-0000-4000-8000-000000000002',repeat('6',64),'APPROVED','32110000-0000-4000-8000-000000000001','synthetic');
reset request.jwt.claim.sub;
set session_replication_role=replica;
insert into public.rollout_health_observations(id,organization_id,campaign_id,source_kind,source_id,observation_number,evidence_class,delivered_count,observation_started_at,observed_at,evidence_sha256) values
('32370000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000002','FIRST_SEND_BATCH','32340000-0000-4000-8000-000000000001',1,'synthetic_demo',0,now()-interval '1 hour',now(),repeat('7',64));
set session_replication_role=origin;
insert into public.rollout_waves(id,organization_id,campaign_id,wave_number,previous_observation_id,manifest_sha256,planned_recipient_count,planned_account_count,scheduled_for,approval_id) values
('32380000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32300000-0000-4000-8000-000000000002',1,'32370000-0000-4000-8000-000000000001',repeat('8',64),1,1,now()+interval '1 day','32360000-0000-4000-8000-000000000001');
insert into public.rollout_wave_enrollments(id,organization_id,wave_id,enrollment_id,account_id,contact_id,mailbox_id,sequence_version_id,contact_email_sha256,sequence_content_sha256) values
('32390000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32380000-0000-4000-8000-000000000001','32330000-0000-4000-8000-000000000002','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','32320000-0000-4000-8000-000000000001','32310000-0000-4000-8000-000000000002',encode(digest('delete-one@m021.invalid','sha256'),'hex'),repeat('4',64));

insert into public.prequote_models(id,organization_id,version,status,assumptions,source_manifest) values
('32140000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','m021-restore','DRAFT_REVIEW_REQUIRED','{}','{}');
insert into public.prequotes(id,organization_id,model_id,folio,need_type,account_name,contact_name,contact_role,normalized_email,monthly_spend_mxn,tariff,installed_capacity_kwp,coverage_target_pct,city,state,zone,result_json,consented_at,evidence_class,correlation_id,idempotency_key,privacy_notice_version) values
('32150000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32140000-0000-4000-8000-000000000001','M021-RESTORE','solar','M021 Synthetic','M021 Delete One','CEO','delete-one@m021.invalid',50000,'GDMTH',0,80,'Leon','Guanajuato','urban','{"sentinel":"M021_GRAPH_SENTINEL"}',now(),'synthetic_demo','32150000-0000-4000-8000-000000000002',repeat('0',64),'M021_SYNTHETIC');
insert into public.leads(id,organization_id,account_id,contact_id,prequote_id,status,contractual_qualified,qualification_reason,evidence_class) values
('32160000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','32150000-0000-4000-8000-000000000001','CAPTURED',false,'M021_GRAPH_SENTINEL','synthetic_demo');
insert into public.opportunities(id,organization_id,account_id,lead_id,next_action,loss_reason,creation_idempotency_key) values
('32170000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL','M021_GRAPH_SENTINEL',repeat('1',64));
insert into public.meetings(id,organization_id,opportunity_id,scheduled_at,held_at,attendance_verified,outcome_notes,idempotency_key) values
('32180000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32170000-0000-4000-8000-000000000001',now()-interval '2 hours',now()-interval '1 hour',true,'M021_GRAPH_SENTINEL',repeat('2',64));
insert into public.messages(id,organization_id,contact_id,direction,status,normalized_to,normalized_from,subject,body_text,idempotency_key,provider_message_id,correlation_id) values
('32190000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','delete-one@m021.invalid','sender@m021.invalid','M021_GRAPH_SENTINEL','M021_GRAPH_SENTINEL',repeat('3',64),'M021_GRAPH_SENTINEL','32190000-0000-4000-8000-000000000002');
insert into public.provider_events(id,organization_id,source,source_record_type,external_event_id,message_id,payload_json,observed_at,event_kind,reply_classification,processing_status) values
('32200000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','synthetic','message','m021-graph','32190000-0000-4000-8000-000000000001','{"sentinel":"M021_GRAPH_SENTINEL"}',now(),'UNKNOWN','UNREVIEWED','PENDING');
insert into public.event_outbox(id,organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json) values
('32210000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','message','32190000-0000-4000-8000-000000000001','synthetic.restore',repeat('4',64),'{"sentinel":"M021_GRAPH_SENTINEL"}');
insert into public.dead_letters(id,organization_id,source_table,source_id,reason,payload_json) values
('32220000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','event_outbox','32210000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL','{"sentinel":"M021_GRAPH_SENTINEL"}');
update public.event_outbox set last_error='M021_GRAPH_SENTINEL' where id='32210000-0000-4000-8000-000000000001';
insert into public.notification_deliveries(id,organization_id,outbox_event_id,channel,destination_hash,status,provider_id,last_error) values
('32221000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32210000-0000-4000-8000-000000000001','EMAIL',repeat('4',64),'FAILED','M021_GRAPH_SENTINEL','M021_GRAPH_SENTINEL');
insert into public.source_evidence(id,organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum) values
('32230000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','contact','32130000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('5',64)),
('32230000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','lead','32160000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('6',64)),
('32230000-0000-4000-8000-000000000003','32100000-0000-4000-8000-000000000001','message','32190000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('7',64)),
('32230000-0000-4000-8000-000000000004','32100000-0000-4000-8000-000000000001','prequote','32150000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('8',64)),
('32230000-0000-4000-8000-000000000005','32100000-0000-4000-8000-000000000001','opportunity','32170000-0000-4000-8000-000000000001','first_payment_mxn','https://example.invalid/m021-payment','synthetic',transaction_timestamp(),'VERIFIED',jsonb_build_object('amount_mxn',1000,'paid_at','2026-08-10T12:00:00Z'),repeat('9',64));
insert into public.qualification_checks(id,organization_id,lead_id,explicit_interest,evidence_record_ids,evaluated_by) values
('32231000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001',true,array['32230000-0000-4000-8000-000000000001'::uuid],'32110000-0000-4000-8000-000000000001');
insert into public.qualification_evidence_links(id,organization_id,qualification_check_id,lead_id,criterion,source_evidence_id,evidence_checksum) values
('32232000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','explicit_interest','32230000-0000-4000-8000-000000000001',repeat('5',64)),
('32232000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','industrial_over_100_kwp','32230000-0000-4000-8000-000000000002',repeat('6',64)),
('32232000-0000-4000-8000-000000000003','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','outside_annex_a','32230000-0000-4000-8000-000000000003',repeat('7',64)),
('32232000-0000-4000-8000-000000000004','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','verified_target_role','32230000-0000-4000-8000-000000000004',repeat('8',64)),
('32232000-0000-4000-8000-000000000005','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','monthly_spend_mxn','32230000-0000-4000-8000-000000000005',repeat('9',64));
select set_config('app.operations_rpc_write','on',false);
insert into public.approval_requests(id,organization_id,subject_type,subject_id,subject_sha256,status,request_reason,requested_by,requested_at,due_at,decided_by,decided_at,rationale,idempotency_key) values
('32233000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','opportunity_closed_won','32170000-0000-4000-8000-000000000001',repeat('a',64),'APPROVED','M021_GRAPH_SENTINEL','32110000-0000-4000-8000-000000000001','2026-08-01','2026-08-10','32110000-0000-4000-8000-000000000002','2026-08-02','M021_GRAPH_SENTINEL',repeat('b',64));
set request.jwt.claim.sub='32110000-0000-4000-8000-000000000002';
insert into public.approvals(id,organization_id,subject_type,subject_id,subject_sha256,decision,decided_by,rationale,request_id) values
('32234000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','opportunity_closed_won','32170000-0000-4000-8000-000000000001',repeat('a',64),'APPROVED','32110000-0000-4000-8000-000000000002','M021_GRAPH_SENTINEL','32233000-0000-4000-8000-000000000001');
reset request.jwt.claim.sub;
set session_replication_role=replica;
update public.opportunities set stage='CLOSED_WON' where id='32170000-0000-4000-8000-000000000001';
insert into public.operational_capacity_configs(id,organization_id,version,monthly_limit,warning_at,effective_from_month,source_reference,idempotency_key,created_by) values
('32400000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001',1,2,1,'2026-08-01','synthetic',repeat('1',64),'32110000-0000-4000-8000-000000000001');
insert into public.opportunity_capacity_schedules(id,organization_id,opportunity_id,execution_date,capacity_month,config_id,config_version,idempotency_key,change_reason,scheduled_by) values
('32410000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32170000-0000-4000-8000-000000000001','2026-08-20','2026-08-01','32400000-0000-4000-8000-000000000001',1,repeat('2',64),'M021_GRAPH_SENTINEL','32110000-0000-4000-8000-000000000001');
insert into public.operational_capacity_commands(id,organization_id,schedule_id,opportunity_id,execution_date,idempotency_key,change_reason,result_status,created_by) values
('32420000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32410000-0000-4000-8000-000000000001','32170000-0000-4000-8000-000000000001','2026-08-20',repeat('3',64),'M021_GRAPH_SENTINEL','SCHEDULED','32110000-0000-4000-8000-000000000001');
set session_replication_role=origin;
insert into public.payments(id,organization_id,opportunity_id,amount_mxn,paid_at,is_first_payment,evidence_record_id,idempotency_key) values
('32235000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32170000-0000-4000-8000-000000000001',1000,'2026-08-10T12:00:00Z',true,'32230000-0000-4000-8000-000000000005',repeat('f',64));
select set_config('app.research_rpc_write','true',false);
insert into public.research_contact_candidates(id,organization_id,account_id,full_name,role_title,role_category,normalized_email,research_status,promoted_contact_id,idempotency_key,created_by,verified_by,verified_at) values
('32270000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL','M021_GRAPH_SENTINEL','CEO','research-sentinel@m021.invalid','PROMOTED','32130000-0000-4000-8000-000000000001',repeat('7',64),'32110000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000002',now()),
('32270000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021 Other Candidate','CEO','CEO','research-other@m021.invalid','PROMOTED','32130000-0000-4000-8000-000000000005',repeat('c',64),'32110000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000002',now()),
('32270000-0000-4000-8000-000000000003','32100000-0000-4000-8000-000000000002','32120000-0000-4000-8000-000000000002','M021 Foreign Candidate','CEO','CEO','research-foreign@m021.invalid','PROMOTED','32130000-0000-4000-8000-000000000003',repeat('d',64),'32110000-0000-4000-8000-000000000004','32110000-0000-4000-8000-000000000004',now());
insert into public.research_evidence_records(id,organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by) values
('32271000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000001','full_name','https://example.invalid/m021','synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('8',64),repeat('9',64),'32110000-0000-4000-8000-000000000001');
insert into public.research_reviews(id,organization_id,subject_type,subject_id,decision,evidence_ids,review_notes,idempotency_key,reviewer_id) values
('32272000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000001','VERIFIED',array['32271000-0000-4000-8000-000000000001'::uuid],'M021_GRAPH_SENTINEL',repeat('a',64),'32110000-0000-4000-8000-000000000002');
insert into public.research_dedupe_cases(id,organization_id,subject_type,candidate_contact_id,matched_candidate_id,match_reason,status,created_by,resolved_at) values
('32273000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000001',null,'NORMALIZED_EMAIL','RESOLVED','32110000-0000-4000-8000-000000000001',now()),
('32273000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000002','32270000-0000-4000-8000-000000000001','MULTIPLE_SIGNALS','RESOLVED','32110000-0000-4000-8000-000000000001',now());
insert into public.research_dedupe_decisions(id,organization_id,dedupe_case_id,decision,canonical_account_id,rationale,idempotency_key,decided_by) values
('32274000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32273000-0000-4000-8000-000000000001','DISTINCT','32120000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL',repeat('b',64),'32110000-0000-4000-8000-000000000002'),
('32274000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32273000-0000-4000-8000-000000000002','DISTINCT','32120000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL',repeat('e',64),'32110000-0000-4000-8000-000000000002');

do $$ begin
  perform set_config('app.research_rpc_write','true',false);
  begin
    delete from public.research_contact_candidates where id='32270000-0000-4000-8000-000000000003';
    raise exception 'EXPECTED_CROSS_TENANT_RESEARCH_RETENTION_REJECTION';
  exception when others then if sqlerrm<>'RESEARCH_RETENTION_TOMBSTONE_REQUIRED' then raise; end if; end;
end $$;
insert into public.tasks(id,organization_id,account_id,contact_id,task_type,normalized_objective,due_at) values
('32240000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','RETENTION_SYNTHETIC','M021_GRAPH_SENTINEL',now());
insert into public.prequote_documents(id,organization_id,prequote_id,storage_path,media_type,sha256,size_bytes,retention_until) values
('32250000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32150000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001/prequotes/32150000-0000-4000-8000-000000000001/32250000-0000-4000-8000-000000000001.pdf','application/pdf',repeat('6',64),100,now()+interval '90 days');
insert into storage.objects(id,bucket_id,name,metadata) values
('32260000-0000-4000-8000-000000000001','ennco-sensitive-documents','32100000-0000-4000-8000-000000000001/prequotes/32150000-0000-4000-8000-000000000001/32250000-0000-4000-8000-000000000001.pdf','{"sentinel":"M021_GRAPH_SENTINEL"}');

create temp table m021_gate_values(
  key text primary key,
  value jsonb not null
) on commit preserve rows;
grant select,insert,update on m021_gate_values to authenticated,service_role;

create temp table m021_predelete_contact_snapshot as
select * from public.contacts
where organization_id='32100000-0000-4000-8000-000000000001'
  and id='32130000-0000-4000-8000-000000000001';

set request.jwt.claim.sub='32110000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin perform public.evaluate_retention_health('32100000-0000-4000-8000-000000000001'); raise exception 'EXPECTED_AAL1_REJECTION';
  exception when others then if sqlerrm<>'RETENTION_MEMBER_AAL2_REQUIRED' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.aal='aal2';
set role authenticated;
insert into m021_gate_values(key,value)
select 'policy',public.create_retention_policy('32100000-0000-4000-8000-000000000001',1,'SYNTHETIC_LOCAL','2026-01-01',repeat('1',64),
  '[{"category":"SYNTHETIC_CONTACT","evidence_class":"synthetic_demo","retention_days":30,"rule_state":"VERIFIED"}]'::jsonb,repeat('2',64));
do $$ declare journal_table text; begin
  foreach journal_table in array array[
    'legal_holds','deletion_batches','deletion_items','deletion_tombstones',
    'retention_policy_versions','retention_policy_rules','retention_subject_clocks',
    'retention_reconciliation_runs','retention_command_ledger','retention_provider_propagations',
    'retention_restore_reconciliation_runs','retention_restore_tombstone_entries'
  ] loop
    if has_table_privilege(current_user,format('public.%I',journal_table),'INSERT')
      or has_table_privilege(current_user,format('public.%I',journal_table),'UPDATE')
      or has_table_privilege(current_user,format('public.%I',journal_table),'DELETE')
      or has_table_privilege(current_user,format('public.%I',journal_table),'TRUNCATE')
    then raise exception 'AUTHENTICATED_RETENTION_JOURNAL_DML_GRANT:%',journal_table; end if;
  end loop;
  begin perform public.activate_retention_policy('32100000-0000-4000-8000-000000000001',(select (value->>'policy_id')::uuid from m021_gate_values where key='policy'),repeat('3',64),repeat('4',64)); raise exception 'EXPECTED_POLICY_FOUR_EYES';
  exception when others then if sqlerrm<>'RETENTION_POLICY_FOUR_EYES_REQUIRED' then raise; end if; end;
  begin update public.deletion_batches set status='FAILED'; raise exception 'EXPECTED_DIRECT_BATCH_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin insert into public.retention_subject_clocks(organization_id,subject_id,category,anchor_at,evidence_sha256,recorded_by)
    values('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','SYNTHETIC_CONTACT',now(),repeat('5',64),auth.uid());
    raise exception 'EXPECTED_DIRECT_RETENTION_DML_REJECTION'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.retention_policy_versions where organization_id='32100000-0000-4000-8000-000000000002')
  then raise exception 'CROSS_TENANT_POLICY_READ'; end if;
end $$;
reset role;

set request.jwt.claim.sub='32110000-0000-4000-8000-000000000002';
set role authenticated;
select public.activate_retention_policy('32100000-0000-4000-8000-000000000001',(select (value->>'policy_id')::uuid from m021_gate_values where key='policy'),repeat('3',64),repeat('5',64));
reset role;
reset request.jwt.claim.sub;
do $$ begin
  if (select approval_evidence_sha256 from public.retention_policy_versions where id=(select (value->>'policy_id')::uuid from m021_gate_values where key='policy'))<>repeat('3',64)
    or not exists(select 1 from public.event_outbox where aggregate_type='retention_policy'
      and aggregate_id=(select (value->>'policy_id')::uuid from m021_gate_values where key='policy')
      and payload_json->>'approval_evidence_sha256'=repeat('3',64))
  then raise exception 'RETENTION_POLICY_APPROVAL_LINEAGE_NOT_BOUND'; end if;
end $$;

set role service_role;
select set_config('app.retention_test_clock','2026-08-12T12:00:00Z',false);
select app.record_retention_subject_clock('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','SYNTHETIC_CONTACT','2026-06-01',repeat('6',64),repeat('7',64));
select app.record_retention_subject_clock('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000002','SYNTHETIC_CONTACT','2026-06-01',repeat('8',64),repeat('9',64));
do $$ declare unchanged jsonb; begin
  begin
    perform app.record_retention_subject_clock('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','SYNTHETIC_CONTACT','2026-05-01',repeat('6',64),repeat('4',64));
    raise exception 'EXPECTED_CLOCK_REGRESSION_REJECTION';
  exception when others then if sqlerrm<>'RETENTION_CLOCK_REGRESSION' then raise; end if; end;
  begin
    perform app.record_retention_subject_clock('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','SYNTHETIC_CONTACT','2026-06-01',repeat('0',64),repeat('5',64));
    raise exception 'EXPECTED_CLOCK_EVIDENCE_DRIFT_REJECTION';
  exception when others then if sqlerrm<>'RETENTION_CLOCK_EVIDENCE_DRIFT' then raise; end if; end;
  unchanged:=app.record_retention_subject_clock('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','SYNTHETIC_CONTACT','2026-06-01',repeat('6',64),repeat('a',64));
  if unchanged->>'status'<>'UNCHANGED' then raise exception 'RETENTION_CLOCK_IDEMPOTENT_EQUAL_INVALID'; end if;
end $$;
insert into m021_gate_values(key,value)
select 'reconciled',app.run_retention_reconciler('32100000-0000-4000-8000-000000000001',repeat('a',64));
reset role;

set request.jwt.claim.sub='32110000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  begin perform public.create_retention_legal_hold('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000002','LEGAL',repeat('b',64),null,repeat('6',64));
    raise exception 'EXPECTED_NULL_REVIEW_DUE_REJECTION'; exception when others then if sqlerrm<>'RETENTION_HOLD_REVIEW_DUE_INVALID' then raise; end if; end;
  begin perform public.create_retention_legal_hold('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000002','LEGAL',repeat('b',64),'2026-08-01',repeat('7',64));
    raise exception 'EXPECTED_PAST_REVIEW_DUE_REJECTION'; exception when others then if sqlerrm<>'RETENTION_HOLD_REVIEW_DUE_INVALID' then raise; end if; end;
  begin perform public.create_retention_legal_hold('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000002','LEGAL',repeat('b',64),'2026-11-20',repeat('8',64));
    raise exception 'EXPECTED_REVIEW_DUE_OVER_90_DAYS_REJECTION'; exception when others then if sqlerrm<>'RETENTION_HOLD_REVIEW_DUE_INVALID' then raise; end if; end;
end $$;
insert into m021_gate_values(key,value)
select 'hold',public.create_retention_legal_hold('32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000002','LEGAL',repeat('b',64),'2026-11-01',repeat('c',64));
select public.approve_retention_batch('32100000-0000-4000-8000-000000000001',
  (select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'),
  (select value->>'manifest_sha256' from m021_gate_values where key='reconciled'),repeat('d',64));
reset role;
reset request.jwt.claim.sub;

set role service_role;
select set_config('app.retention_test_clock','2026-08-12T12:00:00Z',false);
insert into m021_gate_values(key,value)
select 'execution_one',app.execute_retention_batch('32100000-0000-4000-8000-000000000001',(select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'),repeat('e',64));
insert into m021_gate_values(key,value)
select 'finalize_hold',app.finalize_retention_batch('32100000-0000-4000-8000-000000000001',(select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'),repeat('f',64));
reset role;
do $$ begin
  if (select value->>'status' from m021_gate_values where key='execution_one')<>'DEGRADED'
    or (select value->>'status' from m021_gate_values where key='finalize_hold')<>'HOLD'
    or (select status from public.deletion_batches where id=(select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'))<>'IN_PROGRESS'
    or not (select is_deleted from public.contacts where id='32130000-0000-4000-8000-000000000001')
    or (select is_deleted from public.contacts where id='32130000-0000-4000-8000-000000000002')
    or (select count(*) from public.retention_provider_propagations where organization_id='32100000-0000-4000-8000-000000000001')<>6
    or exists(select 1 from public.source_evidence where id in ('32230000-0000-4000-8000-000000000001','32230000-0000-4000-8000-000000000002','32230000-0000-4000-8000-000000000003','32230000-0000-4000-8000-000000000004'))
    or not exists(select 1 from public.source_evidence se join public.payments p on p.organization_id=se.organization_id and p.evidence_record_id=se.id
      where se.id='32230000-0000-4000-8000-000000000005' and se.source_url='https://retention.invalid/redacted' and se.source_name='RETENTION_REDACTED'
        and se.field_name='first_payment_mxn' and se.value_json ?& array['amount_mxn','paid_at'] and p.id='32235000-0000-4000-8000-000000000001'
        and app.payment_evidence_is_verified(p.organization_id,p.opportunity_id,p.evidence_record_id,p.amount_mxn,p.paid_at))
    or exists(select 1 from public.qualification_evidence_links where id in ('32232000-0000-4000-8000-000000000001','32232000-0000-4000-8000-000000000002','32232000-0000-4000-8000-000000000003','32232000-0000-4000-8000-000000000004'))
    or not exists(select 1 from public.qualification_evidence_links where id='32232000-0000-4000-8000-000000000005')
    or exists(select 1 from public.research_contact_candidates where id='32270000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_evidence_records where id='32271000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_reviews where id='32272000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_dedupe_cases where id in ('32273000-0000-4000-8000-000000000001','32273000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.research_dedupe_decisions where id in ('32274000-0000-4000-8000-000000000001','32274000-0000-4000-8000-000000000002'))
    or exists(select 1 from public.event_outbox where id='32210000-0000-4000-8000-000000000001' and last_error is not null)
    or exists(select 1 from public.notification_deliveries where id='32221000-0000-4000-8000-000000000001' and num_nonnulls(provider_id,last_error)>0)
    or exists(select 1 from public.approval_requests where id='32233000-0000-4000-8000-000000000001' and (request_reason<>'RETENTION_REDACTED' or rationale<>'RETENTION_REDACTED'))
    or exists(select 1 from public.approvals where id='32234000-0000-4000-8000-000000000001' and rationale<>'RETENTION_REDACTED')
    or not exists(select 1 from public.meetings where id='32180000-0000-4000-8000-000000000001' and attendance_verified and held_at is not null and outcome_notes='RETENTION_REDACTED')
    or not exists(select 1 from public.first_send_batch_enrollments f where f.id='32350000-0000-4000-8000-000000000001'
      and f.contact_email_sha256=encode(digest('RETENTION:'||encode(digest(f.organization_id::text||':CONTACT:'||f.contact_id::text,'sha256'),'hex')||':FIRST_SEND:'||f.id::text,'sha256'),'hex'))
    or not exists(select 1 from public.rollout_wave_enrollments w where w.id='32390000-0000-4000-8000-000000000001'
      and w.contact_email_sha256=encode(digest('RETENTION:'||encode(digest(w.organization_id::text||':CONTACT:'||w.contact_id::text,'sha256'),'hex')||':ROLLOUT:'||w.id::text,'sha256'),'hex'))
    or not exists(select 1 from public.opportunity_capacity_schedules where id='32410000-0000-4000-8000-000000000001' and change_reason='RETENTION_REDACTED')
    or not exists(select 1 from public.operational_capacity_commands where id='32420000-0000-4000-8000-000000000001' and change_reason='RETENTION_REDACTED')
  then raise exception 'RETENTION_HOLD_OR_PROPAGATION_FAIL_CLOSED_INVALID'; end if;
end $$;

set request.jwt.claim.sub='32110000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.release_retention_legal_hold('32100000-0000-4000-8000-000000000001',(select (value->>'hold_id')::uuid from m021_gate_values where key='hold'),repeat('1',64),repeat('0',64));
reset role;
reset request.jwt.claim.sub;
set role service_role;
select set_config('app.retention_test_clock','2026-08-12T13:00:00Z',false);
select app.execute_retention_batch('32100000-0000-4000-8000-000000000001',(select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'),repeat('1',64));
do $$ declare propagation_id uuid; journal_table text; begin
  perform set_config('app.retention_rpc_write','on',false);
  perform set_config('app.research_rpc_write','true',false);
  foreach journal_table in array array[
    'legal_holds','deletion_batches','deletion_items','deletion_tombstones',
    'retention_policy_versions','retention_policy_rules','retention_subject_clocks',
    'retention_reconciliation_runs','retention_command_ledger','retention_provider_propagations',
    'retention_restore_reconciliation_runs','retention_restore_tombstone_entries'
  ] loop
    if has_table_privilege(current_user,format('public.%I',journal_table),'INSERT')
      or has_table_privilege(current_user,format('public.%I',journal_table),'UPDATE')
      or has_table_privilege(current_user,format('public.%I',journal_table),'DELETE')
      or has_table_privilege(current_user,format('public.%I',journal_table),'TRUNCATE')
    then raise exception 'SERVICE_ROLE_RETENTION_JOURNAL_DML_GRANT:%',journal_table; end if;
  end loop;
  select id into propagation_id from public.retention_provider_propagations
  where organization_id='32100000-0000-4000-8000-000000000001' order by id limit 1;
  begin
    insert into public.retention_command_ledger(organization_id,command_name,idempotency_key,request_sha256)
    values('32100000-0000-4000-8000-000000000001','forged',repeat('c',64),repeat('d',64));
    raise exception 'EXPECTED_SERVICE_JOURNAL_INSERT_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    update public.retention_provider_propagations set status='ACKNOWLEDGED',evidence_sha256=repeat('e',64),acknowledged_at=now() where id=propagation_id;
    raise exception 'EXPECTED_SERVICE_JOURNAL_UPDATE_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.retention_provider_propagations where id=propagation_id;
    raise exception 'EXPECTED_SERVICE_JOURNAL_DELETE_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    execute 'truncate table public.retention_provider_propagations';
    raise exception 'EXPECTED_SERVICE_JOURNAL_TRUNCATE_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.research_contact_candidates where id='32270000-0000-4000-8000-000000000003';
    raise exception 'EXPECTED_SERVICE_RESEARCH_GUC_BYPASS_REJECTION';
  exception when insufficient_privilege then null; end;
end $$;
do $$ declare p record; n integer:=0; begin
  for p in select id,provider_code from public.retention_provider_propagations where organization_id='32100000-0000-4000-8000-000000000001' order by id loop
    n:=n+1;
    if n=1 then
      begin
        perform app.record_retention_provider_propagation('32100000-0000-4000-8000-000000000001',p.id,
          'NOT_APPLICABLE',encode(digest('na:'||p.id::text,'sha256'),'hex'),null,encode(digest('na-command:'||p.id::text,'sha256'),'hex'));
        raise exception 'EXPECTED_NOT_APPLICABLE_REJECTION';
      exception when others then if sqlerrm<>'RETENTION_PROPAGATION_INPUT_INVALID' then raise; end if; end;
    end if;
    perform app.record_retention_provider_propagation('32100000-0000-4000-8000-000000000001',p.id,
      'ACKNOWLEDGED',encode(digest('evidence:'||p.id::text,'sha256'),'hex'),null,encode(digest('propagation:'||p.id::text,'sha256'),'hex'));
  end loop;
end $$;
do $$ declare p public.retention_provider_propagations%rowtype; begin
  perform set_config('app.retention_rpc_write','on',false);
  select * into p from public.retention_provider_propagations
  where organization_id='32100000-0000-4000-8000-000000000001' order by id limit 1;
  begin
    update public.retention_provider_propagations set evidence_sha256=repeat('0',64) where id=p.id;
    raise exception 'EXPECTED_TERMINAL_EVIDENCE_REWRITE_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    perform app.record_retention_provider_propagation('32100000-0000-4000-8000-000000000001',p.id,'ACKNOWLEDGED',repeat('0',64),null,encode(digest('terminal-rewrite:'||p.id::text,'sha256'),'hex'));
    raise exception 'EXPECTED_CANONICAL_TERMINAL_REWRITE_REJECTION';
  exception when others then if sqlerrm<>'RETENTION_PROPAGATION_TERMINAL' then raise; end if; end;
end $$;
insert into m021_gate_values(key,value)
select 'finalized',app.finalize_retention_batch('32100000-0000-4000-8000-000000000001',(select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'),repeat('2',64));
reset role;
do $$ begin
  if (select value->>'status' from m021_gate_values where key='finalized')<>'COMPLETED'
    or (select status from public.deletion_batches where id=(select (value->>'batch_id')::uuid from m021_gate_values where key='reconciled'))<>'COMPLETED'
  then raise exception 'RETENTION_COMPLETION_AFTER_CONFIRMATION_INVALID'; end if;
  if exists(select 1 from public.retention_provider_propagations where organization_id='32100000-0000-4000-8000-000000000001' and status in ('UNKNOWN','PENDING','FAILED'))
  then raise exception 'RETENTION_PROPAGATION_STILL_UNKNOWN'; end if;
  if exists(select 1 from public.retention_provider_propagations where organization_id='32100000-0000-4000-8000-000000000001'
    and evidence_sha256<>encode(digest('evidence:'||id::text,'sha256'),'hex'))
  then raise exception 'RETENTION_TERMINAL_EVIDENCE_REWRITTEN'; end if;
end $$;

select set_config('app.research_rpc_write','true',false);
update public.contacts c
set full_name=s.full_name,role_title=s.role_title,normalized_email=s.normalized_email,is_deleted=false
from m021_predelete_contact_snapshot s
where c.organization_id=s.organization_id and c.id=s.id;
update public.provider_events set payload_json='{"sentinel":"M021_GRAPH_SENTINEL"}' where id='32200000-0000-4000-8000-000000000001';
update public.event_outbox set payload_json='{"sentinel":"M021_GRAPH_SENTINEL"}',last_error='M021_GRAPH_SENTINEL' where id='32210000-0000-4000-8000-000000000001';
update public.notification_deliveries set provider_id='M021_GRAPH_SENTINEL',last_error='M021_GRAPH_SENTINEL' where id='32221000-0000-4000-8000-000000000001';
update public.dead_letters set reason='M021_GRAPH_SENTINEL',payload_json='{"sentinel":"M021_GRAPH_SENTINEL"}' where id='32220000-0000-4000-8000-000000000001';
update public.messages set normalized_to='delete-one@m021.invalid',normalized_from='sender@m021.invalid',subject='M021_GRAPH_SENTINEL',body_text='M021_GRAPH_SENTINEL',provider_message_id='M021_GRAPH_SENTINEL' where id='32190000-0000-4000-8000-000000000001';
update public.prequotes set contact_name='M021_GRAPH_SENTINEL',contact_role='M021_GRAPH_SENTINEL',normalized_email='delete-one@m021.invalid',phone_e164='+520000000000' where id='32150000-0000-4000-8000-000000000001';
update public.meetings set outcome_notes='M021_GRAPH_SENTINEL' where id='32180000-0000-4000-8000-000000000001';
set session_replication_role=replica;
update public.opportunities set next_action='M021_GRAPH_SENTINEL',loss_reason='M021_GRAPH_SENTINEL' where id='32170000-0000-4000-8000-000000000001';
set session_replication_role=origin;
update public.leads set qualification_reason='M021_GRAPH_SENTINEL' where id='32160000-0000-4000-8000-000000000001';
insert into public.source_evidence(id,organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum) values
('32230000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','contact','32130000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('5',64)),
('32230000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','lead','32160000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('6',64)),
('32230000-0000-4000-8000-000000000003','32100000-0000-4000-8000-000000000001','message','32190000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('7',64)),
('32230000-0000-4000-8000-000000000004','32100000-0000-4000-8000-000000000001','prequote','32150000-0000-4000-8000-000000000001','contact_detail',null,'synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('8',64));
insert into public.qualification_evidence_links(id,organization_id,qualification_check_id,lead_id,criterion,source_evidence_id,evidence_checksum) values
('32232000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','explicit_interest','32230000-0000-4000-8000-000000000001',repeat('5',64)),
('32232000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','industrial_over_100_kwp','32230000-0000-4000-8000-000000000002',repeat('6',64)),
('32232000-0000-4000-8000-000000000003','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','outside_annex_a','32230000-0000-4000-8000-000000000003',repeat('7',64)),
('32232000-0000-4000-8000-000000000004','32100000-0000-4000-8000-000000000001','32231000-0000-4000-8000-000000000001','32160000-0000-4000-8000-000000000001','verified_target_role','32230000-0000-4000-8000-000000000004',repeat('8',64));
insert into public.research_contact_candidates(id,organization_id,account_id,full_name,role_title,role_category,normalized_email,research_status,promoted_contact_id,idempotency_key,created_by,verified_by,verified_at) values
('32270000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL','M021_GRAPH_SENTINEL','CEO','research-sentinel@m021.invalid','PROMOTED','32130000-0000-4000-8000-000000000001',repeat('7',64),'32110000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000002',now());
insert into public.research_evidence_records(id,organization_id,subject_type,subject_id,field_name,source_url,source_name,observed_at,confidence,value_json,checksum,idempotency_key,created_by) values
('32271000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000001','full_name','https://example.invalid/m021','synthetic',now(),'VERIFIED','{"sentinel":"M021_GRAPH_SENTINEL"}',repeat('8',64),repeat('9',64),'32110000-0000-4000-8000-000000000001');
insert into public.research_reviews(id,organization_id,subject_type,subject_id,decision,evidence_ids,review_notes,idempotency_key,reviewer_id) values
('32272000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000001','VERIFIED',array['32271000-0000-4000-8000-000000000001'::uuid],'M021_GRAPH_SENTINEL',repeat('a',64),'32110000-0000-4000-8000-000000000002');
insert into public.research_dedupe_cases(id,organization_id,subject_type,candidate_contact_id,matched_candidate_id,match_reason,status,created_by,resolved_at) values
('32273000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000001',null,'NORMALIZED_EMAIL','RESOLVED','32110000-0000-4000-8000-000000000001',now()),
('32273000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','CONTACT_CANDIDATE','32270000-0000-4000-8000-000000000002','32270000-0000-4000-8000-000000000001','MULTIPLE_SIGNALS','RESOLVED','32110000-0000-4000-8000-000000000001',now());
insert into public.research_dedupe_decisions(id,organization_id,dedupe_case_id,decision,canonical_account_id,rationale,idempotency_key,decided_by) values
('32274000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32273000-0000-4000-8000-000000000001','DISTINCT','32120000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL',repeat('b',64),'32110000-0000-4000-8000-000000000002'),
('32274000-0000-4000-8000-000000000002','32100000-0000-4000-8000-000000000001','32273000-0000-4000-8000-000000000002','DISTINCT','32120000-0000-4000-8000-000000000001','M021_GRAPH_SENTINEL',repeat('e',64),'32110000-0000-4000-8000-000000000002');
set session_replication_role=replica;
update public.source_evidence set source_url='https://example.invalid/m021-payment',source_name='synthetic',
  value_json=jsonb_build_object('amount_mxn',1000,'paid_at','2026-08-10T12:00:00Z'),checksum=repeat('9',64)
where id='32230000-0000-4000-8000-000000000005';
update public.approval_requests set request_reason='M021_GRAPH_SENTINEL',rationale='M021_GRAPH_SENTINEL' where id='32233000-0000-4000-8000-000000000001';
update public.approvals set rationale='M021_GRAPH_SENTINEL' where id='32234000-0000-4000-8000-000000000001';
update public.first_send_batch_enrollments set contact_email_sha256=encode(digest('delete-one@m021.invalid','sha256'),'hex') where id='32350000-0000-4000-8000-000000000001';
update public.rollout_wave_enrollments set contact_email_sha256=encode(digest('delete-one@m021.invalid','sha256'),'hex') where id='32390000-0000-4000-8000-000000000001';
update public.opportunity_capacity_schedules set change_reason='M021_GRAPH_SENTINEL' where id='32410000-0000-4000-8000-000000000001';
update public.operational_capacity_commands set change_reason='M021_GRAPH_SENTINEL' where id='32420000-0000-4000-8000-000000000001';
set session_replication_role=origin;
insert into public.tasks(id,organization_id,account_id,contact_id,task_type,normalized_objective,due_at) values
('32240000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','RETENTION_SYNTHETIC','M021_GRAPH_SENTINEL',now());
insert into public.prequote_documents(id,organization_id,prequote_id,storage_path,media_type,sha256,size_bytes,retention_until) values
('32250000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32150000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001/prequotes/32150000-0000-4000-8000-000000000001/32250000-0000-4000-8000-000000000001.pdf','application/pdf',repeat('6',64),100,now()+interval '90 days');
insert into storage.objects(id,bucket_id,name,metadata) values
('32260000-0000-4000-8000-000000000001','ennco-sensitive-documents','32100000-0000-4000-8000-000000000001/prequotes/32150000-0000-4000-8000-000000000001/32250000-0000-4000-8000-000000000001.pdf','{"sentinel":"M021_GRAPH_SENTINEL"}');
set request.jwt.claim.sub='32110000-0000-4000-8000-000000000001';
insert into public.legal_holds(id,organization_id,subject_id,reason_code,evidence_sha256,effective_at,review_due_at,created_by)
values('32280000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','LEGAL',repeat('f',64),'2026-01-01','2026-09-01','32110000-0000-4000-8000-000000000001');
reset request.jwt.claim.sub;
set role service_role;
select set_config('app.retention_test_clock','2026-08-12T14:00:00Z',false);
insert into m021_gate_values(key,value)
select 'restore_manifest',jsonb_build_object('entries',entries,'sha256',app.canonical_retention_tombstone_manifest_sha256(entries))
from (
  select jsonb_agg(jsonb_build_object('subject_hash',t.subject_hash,'deletion_evidence_sha256',t.deletion_evidence_sha256,'deleted_at',t.deleted_at) order by t.subject_hash desc) entries
  from public.deletion_tombstones t where t.organization_id='32100000-0000-4000-8000-000000000001'
) manifest;
do $$ declare entries jsonb; canonical_sha text; foreign_entries jsonb; foreign_sha text; foreign_response jsonb; subset_entries jsonb; subset_sha text; subset_response jsonb; hold_response jsonb; begin
  select value->'entries',value->>'sha256' into entries,canonical_sha from m021_gate_values where key='restore_manifest';
  begin perform app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',repeat('8',64),entries,repeat('a',64));
    raise exception 'EXPECTED_MANIFEST_SHA_MISMATCH'; exception when others then if sqlerrm<>'RETENTION_RESTORE_MANIFEST_SHA256_MISMATCH' then raise; end if; end;
  begin perform app.canonical_retention_tombstone_manifest_sha256(jsonb_build_array((entries->0)||jsonb_build_object('extra','forbidden')));
    raise exception 'EXPECTED_MANIFEST_EXTRA_FIELD_REJECTION'; exception when others then if sqlerrm<>'RETENTION_RESTORE_MANIFEST_ENTRY_INVALID' then raise; end if; end;
  begin perform app.canonical_retention_tombstone_manifest_sha256(jsonb_build_array(entries->0,entries->0));
    raise exception 'EXPECTED_MANIFEST_DUPLICATE_REJECTION'; exception when others then if sqlerrm<>'RETENTION_RESTORE_MANIFEST_DUPLICATE' then raise; end if; end;
  begin perform app.canonical_retention_tombstone_manifest_sha256(jsonb_build_array((entries->0)-'deleted_at'||jsonb_build_object('deleted_at','not-a-timestamp')));
    raise exception 'EXPECTED_MANIFEST_TIMESTAMP_REJECTION'; exception when others then if sqlerrm<>'RETENTION_RESTORE_MANIFEST_ENTRY_INVALID' then raise; end if; end;
  subset_entries:=jsonb_build_array(entries->0);
  subset_sha:=app.canonical_retention_tombstone_manifest_sha256(subset_entries);
  subset_response:=app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',subset_sha,subset_entries,repeat('c',64));
  insert into m021_gate_values(key,value) values('restore_subset_unknown',subset_response);
  if subset_response->>'status'<>'UNKNOWN' or subset_response->>'reason_code'<>'TOMBSTONE_MANIFEST_INCOMPLETE'
  then raise exception 'RETENTION_RESTORE_AUTHENTIC_SUBSET_NOT_CONTAINED'; end if;
  foreign_entries:=jsonb_build_array(jsonb_build_object(
    'subject_hash',encode(digest('32100000-0000-4000-8000-000000000002:CONTACT:32130000-0000-4000-8000-000000000003','sha256'),'hex'),
    'deletion_evidence_sha256',repeat('7',64),'deleted_at','2026-08-12T14:00:00Z'));
  foreign_sha:=app.canonical_retention_tombstone_manifest_sha256(foreign_entries);
  foreign_response:=app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',foreign_sha,foreign_entries,repeat('b',64));
  insert into m021_gate_values(key,value) values('restore_foreign_unknown',foreign_response);
  if foreign_response->>'status'<>'UNKNOWN' then raise exception 'RETENTION_RESTORE_TENANT_DRIFT_NOT_CONTAINED'; end if;
  foreign_entries:=jsonb_build_array(jsonb_build_object(
    'subject_hash',encode(digest('32100000-0000-4000-8000-000000000001:CONTACT:32130000-0000-4000-8000-000000000005','sha256'),'hex'),
    'deletion_evidence_sha256',repeat('7',64),'deleted_at','2026-08-12T14:00:00Z'));
  foreign_sha:=app.canonical_retention_tombstone_manifest_sha256(foreign_entries);
  foreign_response:=app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',foreign_sha,foreign_entries,repeat('d',64));
  insert into m021_gate_values(key,value) values('restore_no_origin_unknown',foreign_response);
  if foreign_response->>'status'<>'UNKNOWN' then raise exception 'RETENTION_RESTORE_UNAUTHENTIC_ORIGIN_ACCEPTED'; end if;
  hold_response:=app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',canonical_sha,entries,repeat('f',64));
  insert into m021_gate_values(key,value) values('restore_active_hold_unknown',hold_response);
  if hold_response->>'status'<>'UNKNOWN' then raise exception 'RETENTION_RESTORE_ACTIVE_HOLD_NOT_FAIL_CLOSED'; end if;
end $$;
reset role;
do $$ begin
  if exists(
    select 1 from m021_gate_values v where v.key in ('restore_subset_unknown','restore_foreign_unknown','restore_no_origin_unknown')
      and (select count(*) from public.event_outbox where aggregate_id=(v.value->>'run_id')::uuid and event_type='retention.restore.unknown')<>1
  )
    or not exists(select 1 from public.retention_restore_tombstone_entries where reconciliation_run_id=(select (value->>'run_id')::uuid from m021_gate_values where key='restore_active_hold_unknown') and reason_code='ACTIVE_LEGAL_HOLD_REQUIRES_REVIEW')
    or not exists(select 1 from public.contacts where id='32130000-0000-4000-8000-000000000001' and not is_deleted and normalized_email='delete-one@m021.invalid')
  then raise exception 'RETENTION_EARLY_UNKNOWN_OR_ACTIVE_HOLD_ASSERTION_INVALID'; end if;
end $$;
set request.jwt.claim.sub='32110000-0000-4000-8000-000000000002';
update public.legal_holds set status='RELEASED',released_by='32110000-0000-4000-8000-000000000002',released_at=now(),release_evidence_sha256=repeat('1',64)
where id='32280000-0000-4000-8000-000000000001';
reset request.jwt.claim.sub;
do $$ begin
  if not exists(select 1 from public.contacts where id='32130000-0000-4000-8000-000000000001' and not is_deleted and normalized_email='delete-one@m021.invalid')
    or (select is_deleted from public.contacts where id='32130000-0000-4000-8000-000000000003')
    or (select is_deleted from public.contacts where id='32130000-0000-4000-8000-000000000005')
  then raise exception 'INVALID_MANIFEST_OR_TENANT_DRIFT_MUTATED_CONTACT'; end if;
end $$;
set role service_role;
insert into m021_gate_values(key,value)
select 'restore_one',app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',
  value->>'sha256',value->'entries',repeat('3',64)) from m021_gate_values where key='restore_manifest';
insert into m021_gate_values(key,value)
select 'restore_two',app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',
  value->>'sha256',(select jsonb_agg(entry order by entry->>'subject_hash') from jsonb_array_elements(value->'entries') entry),repeat('4',64))
from m021_gate_values where key='restore_manifest';
reset role;
do $$ begin
  if (select (value->>'reapplied_count')::int from m021_gate_values where key='restore_one')<>1
    or (select (value->>'already_applied_count')::int from m021_gate_values where key='restore_two')<>2
    or exists(select 1 from public.contacts where id='32130000-0000-4000-8000-000000000001' and (not is_deleted or full_name<>'Deleted subject' or normalized_email='delete-one@m021.invalid'))
  then raise exception 'RETENTION_POST_RESTORE_REAPPLY_INVALID'; end if;
  if exists(select 1 from public.provider_events where id='32200000-0000-4000-8000-000000000001' and payload_json::text like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.event_outbox where id='32210000-0000-4000-8000-000000000001' and payload_json::text like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.dead_letters where id='32220000-0000-4000-8000-000000000001' and (reason||payload_json::text) like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.messages where id='32190000-0000-4000-8000-000000000001' and concat_ws('|',normalized_to,normalized_from,subject,body_text,provider_message_id) like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.prequote_documents where id='32250000-0000-4000-8000-000000000001')
    or exists(select 1 from storage.objects where id='32260000-0000-4000-8000-000000000001')
    or exists(select 1 from public.prequotes where id='32150000-0000-4000-8000-000000000001' and concat_ws('|',contact_name,contact_role,normalized_email,phone_e164) like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.meetings where id='32180000-0000-4000-8000-000000000001' and outcome_notes like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.opportunities where id='32170000-0000-4000-8000-000000000001' and concat_ws('|',next_action,loss_reason) like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.leads where id='32160000-0000-4000-8000-000000000001' and qualification_reason like '%M021_GRAPH_SENTINEL%')
    or exists(select 1 from public.source_evidence where id='32230000-0000-4000-8000-000000000001')
    or exists(select 1 from public.qualification_evidence_links where id='32232000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_contact_candidates where id='32270000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_evidence_records where id='32271000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_reviews where id='32272000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_dedupe_cases where id='32273000-0000-4000-8000-000000000001')
    or exists(select 1 from public.research_dedupe_decisions where id='32274000-0000-4000-8000-000000000001')
    or exists(select 1 from public.tasks where id='32240000-0000-4000-8000-000000000001')
    or not app.retention_payment_evidence_is_canonical('32100000-0000-4000-8000-000000000001','32230000-0000-4000-8000-000000000005')
    or not exists(select 1 from public.qualification_evidence_links where id='32232000-0000-4000-8000-000000000005')
    or exists(select 1 from public.event_outbox where id='32210000-0000-4000-8000-000000000001' and last_error is not null)
    or exists(select 1 from public.notification_deliveries where id='32221000-0000-4000-8000-000000000001' and num_nonnulls(provider_id,last_error)>0)
    or not exists(select 1 from public.meetings where id='32180000-0000-4000-8000-000000000001' and attendance_verified and held_at is not null and outcome_notes='RETENTION_REDACTED')
    or not exists(select 1 from public.first_send_batch_enrollments f where f.id='32350000-0000-4000-8000-000000000001'
      and f.contact_email_sha256=encode(digest('RETENTION:'||encode(digest(f.organization_id::text||':CONTACT:'||f.contact_id::text,'sha256'),'hex')||':FIRST_SEND:'||f.id::text,'sha256'),'hex'))
    or not exists(select 1 from public.rollout_wave_enrollments w where w.id='32390000-0000-4000-8000-000000000001'
      and w.contact_email_sha256=encode(digest('RETENTION:'||encode(digest(w.organization_id::text||':CONTACT:'||w.contact_id::text,'sha256'),'hex')||':ROLLOUT:'||w.id::text,'sha256'),'hex'))
    or not exists(select 1 from public.opportunity_capacity_schedules where id='32410000-0000-4000-8000-000000000001' and change_reason='RETENTION_REDACTED')
    or not exists(select 1 from public.operational_capacity_commands where id='32420000-0000-4000-8000-000000000001' and change_reason='RETENTION_REDACTED')
  then raise exception 'RETENTION_RESTORE_GRAPH_SENTINEL_RESIDUE'; end if;
  if exists(select 1 from public.audit_log where record_type like 'retention_%' and (coalesce(old_data::text,'')||coalesce(new_data::text,'')) like '%M021 Delete One%')
  then raise exception 'RETENTION_AUDIT_PII_LEAK'; end if;
end $$;

set role service_role;
select set_config('app.retention_test_clock',clock_timestamp()::text,false);
do $$ declare reconciled jsonb; begin
  reconciled:=app.run_retention_reconciler('32100000-0000-4000-8000-000000000001',repeat('0',64));
  if reconciled->>'status'<>'HEALTHY' then raise exception 'RETENTION_HEALTHY_RECONCILIATION_EXPECTED'; end if;
end $$;
reset role;
set request.jwt.claim.sub='32110000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare h jsonb; begin
  h:=public.evaluate_retention_health('32100000-0000-4000-8000-000000000001');
  if h->>'state'<>'HEALTHY' or h->>'production_retention_state'<>'BLOCKED_EXTERNAL' or (h->>'live_provider_calls')::int<>0
    or h->'coverage'->>'PREQUOTE_DOCUMENT'<>'HOLD_BLOCKED_EXTERNAL' or h->'coverage'->>'MESSAGE_CONTENT'<>'HOLD_BLOCKED_EXTERNAL'
  then raise exception 'RETENTION_HEALTH_COVERAGE_OR_HEALTHY_STATE_INVALID'; end if;
end $$;
reset role;
set role service_role;
do $$ declare entries jsonb; sha text; response jsonb; begin
  entries:=jsonb_build_array(jsonb_build_object(
    'subject_hash',encode(digest('32100000-0000-4000-8000-000000000001:CONTACT:32130000-0000-4000-8000-000000000005','sha256'),'hex'),
    'deletion_evidence_sha256',repeat('7',64),'deleted_at','2026-08-12T16:00:00Z'));
  sha:=app.canonical_retention_tombstone_manifest_sha256(entries);
  response:=app.reapply_retention_tombstones('32100000-0000-4000-8000-000000000001',sha,entries,repeat('9',64));
  insert into m021_gate_values(key,value) values('restore_final_unknown',response);
  if response->>'status'<>'UNKNOWN' then raise exception 'RETENTION_UNKNOWN_RESTORE_ALERT_INVALID'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.event_outbox where aggregate_id=(select (value->>'run_id')::uuid from m021_gate_values where key='restore_final_unknown') and event_type='retention.restore.unknown')<>1
  then raise exception 'RETENTION_FINAL_UNKNOWN_OUTBOX_CARDINALITY_INVALID'; end if;
end $$;
set role authenticated;
do $$ declare h jsonb; begin
  h:=public.evaluate_retention_health('32100000-0000-4000-8000-000000000001');
  if h->>'state'<>'UNKNOWN' or h->>'reason_code'<>'RESTORE_RECONCILIATION_UNKNOWN'
  then raise exception 'RETENTION_HEALTH_DID_NOT_FAIL_CLOSED_AFTER_UNKNOWN_RESTORE'; end if;
end $$;
reset role;

update public.prequotes set contact_name='M021_SHARED_PREQUOTE_SENTINEL'
where id='32150000-0000-4000-8000-000000000001';
insert into public.leads(id,organization_id,account_id,contact_id,prequote_id,status,contractual_qualified,evidence_class)
values('32160000-0000-4000-8000-000000000005','32100000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001',
  '32130000-0000-4000-8000-000000000005','32150000-0000-4000-8000-000000000001','CAPTURED',false,'synthetic_demo');
set role service_role;
insert into m021_gate_values(key,value)
select 'restore_shared_prequote_unknown',app.reapply_retention_tombstones(
  '32100000-0000-4000-8000-000000000001',value->>'sha256',value->'entries',repeat('6',64)
) from m021_gate_values where key='restore_manifest';
reset role;
do $$ begin
  if (select value->>'status' from m021_gate_values where key='restore_shared_prequote_unknown')<>'UNKNOWN'
    or not exists(select 1 from public.retention_restore_tombstone_entries
      where reconciliation_run_id=(select (value->>'run_id')::uuid from m021_gate_values where key='restore_shared_prequote_unknown')
        and reason_code='SHARED_PREQUOTE_OWNERSHIP_UNKNOWN')
    or not exists(select 1 from public.prequotes where id='32150000-0000-4000-8000-000000000001' and contact_name='M021_SHARED_PREQUOTE_SENTINEL')
    or not exists(select 1 from public.contacts where id='32130000-0000-4000-8000-000000000005' and not is_deleted and normalized_email='no-tombstone@m021.invalid')
  then raise exception 'RETENTION_SHARED_PREQUOTE_NOT_FAIL_CLOSED'; end if;
end $$;

\echo 'RETENTION_LIVE_LOCAL_CONTROL_FORWARD_PASS'
