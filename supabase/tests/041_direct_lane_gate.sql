\set ON_ERROR_STOP on

-- ============================================================================
-- M041 carril directo — gate forward.
--
-- Prueba lo que el carril promete: consentimiento por invitación con identidad
-- exacta, bóveda inalcanzable por los roles de la app, campaña aprobada sólo
-- por teckel_admin, inscripción por cargo, claim/settle con tope, ritmo y
-- avance de secuencia, respuesta del operador en hilo con copia, y que los
-- candados que SÍ aplican (kill switch, Anexo A, supresión, texto plano)
-- muerden mientras los del carril híbrido ya no estorban.
-- ============================================================================

insert into public.organizations(id,slug,legal_name) values
  ('41000000-0000-4000-8000-000000000001','m041-ennco','ENNCO M041 Synthetic'),
  ('41000000-0000-4000-8000-000000000002','m041-other','M041 Other Tenant');
insert into public.organization_users(organization_id,user_id,role) values
  ('41000000-0000-4000-8000-000000000001','41100000-0000-4000-8000-000000000001','teckel_admin'),
  ('41000000-0000-4000-8000-000000000001','41100000-0000-4000-8000-000000000002','teckel_operator'),
  ('41000000-0000-4000-8000-000000000002','41100000-0000-4000-8000-000000000003','teckel_admin');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values
  ('41000000-0000-4000-8000-000000000001',true,false),
  ('41000000-0000-4000-8000-000000000002',true,false);
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret,dispatch_secret) values
  ('41000000-0000-4000-8000-000000000001',repeat('p',64),repeat('a',64),'m041-dispatch-secret-0123456789abcdef'),
  ('41000000-0000-4000-8000-000000000002',repeat('q',64),repeat('b',64),null);

do $$ begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.accounts(id,organization_id,legal_name,normalized_name,primary_domain,tier,evidence_class,source_confidence) values
    ('41200000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','Autopartes del Bajío','autopartes-del-bajio','autopartes-bajio.invalid',1,'live','VERIFIED'),
    ('41200000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','Papelera del Centro','papelera-del-centro','papelera-centro.invalid',2,'live','VERIFIED'),
    ('41200000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000001','Suprimida SA','suprimida-sa','suprimida.invalid',2,'live','VERIFIED');
  insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence) values
    ('41300000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','41200000-0000-4000-8000-000000000001','Juan Pérez','Purchasing Manager','compras@autopartes-bajio.invalid',true,clock_timestamp(),'VERIFIED'),
    ('41300000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','41200000-0000-4000-8000-000000000002','Ana Ruiz','Gerente de Mantenimiento','mantenimiento@papelera-centro.invalid',true,clock_timestamp(),'VERIFIED'),
    ('41300000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000001','41200000-0000-4000-8000-000000000002','Luis Ortega','Coordinador de Seguridad e Higiene','ehs@papelera-centro.invalid',false,null,'HIGH'),
    ('41300000-0000-4000-8000-000000000004','41000000-0000-4000-8000-000000000001','41200000-0000-4000-8000-000000000003','Pedro Gil','Director General','dg@suprimida.invalid',true,clock_timestamp(),'VERIFIED');
  insert into public.suppression_entries(organization_id,kind,normalized_domain,reason) values
    ('41000000-0000-4000-8000-000000000001','DNC','suprimida.invalid','gate m041');
end $$;

-- Dos buzones del carril + el del cliente, con la forma exacta de M037.
insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name, provider,
  eligibility_route, domain_role, custody_status, ownership_status,
  warmup_minimum_days, warmup_status, provider_daily_limit,
  auth_spf, auth_dkim, auth_dmarc, auth_tls, health_status, credential_status, kill_switch,
  domain_registered_at, human_history_verified, blocklist_status, tier1_only, max_account_count, max_email_touches,
  sender_identity_verified, gmail_seed_verified, outlook_seed_verified, yahoo_seed_verified, reply_sync_verified,
  list_unsubscribe_verified, one_click_unsubscribe_verified
) values
  ('41400000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','francisco@enncoindustrial.com','enncoindustrial.com','Francisco Cuellar','gmail',
   'NEW_ISOLATED_MAILBOX_WARMUP','OUTREACH_ISOLATED','TECKEL_MANAGED_FOR_ENNCO','ENNCO_OWNED',42,'NOT_STARTED',0,
   true,true,true,true,'HOLD','UNKNOWN',false,'2026-08-26',false,'UNKNOWN',true,50,3,false,false,false,false,false,false,false),
  ('41400000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','francisco@enncoenergia.com','enncoenergia.com','Francisco Cuellar','gmail',
   'NEW_ISOLATED_MAILBOX_WARMUP','OUTREACH_ISOLATED','TECKEL_MANAGED_FOR_ENNCO','ENNCO_OWNED',42,'NOT_STARTED',0,
   true,true,true,true,'HOLD','UNKNOWN',false,'2026-08-26',false,'UNKNOWN',true,50,3,false,false,false,false,false,false,false);

-- Helpers desechables (se borran al final).
create or replace function app.m041_proof(target_org uuid, target_command text, target_parts text[],
  out proof_command_id text, out proof_nonce uuid, out proof_expires_at timestamptz, out proof_signature text)
language plpgsql volatile set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; secret text; signed_value text;
begin
  select dispatch_secret into secret from app.private_runtime_config where organization_id=target_org;
  proof_nonce := gen_random_uuid();
  proof_expires_at := date_trunc('second',clock_timestamp()+interval '5 minutes');
  proof_command_id := target_command||':'||proof_nonce::text;
  payload_sha := encode(digest(convert_to(array_to_string(array[target_command]||target_parts,E'\n'),'utf8'),'sha256'),'hex');
  signed_value := concat_ws(E'\n',target_org::text,proof_command_id,proof_nonce::text,
    to_char(proof_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),payload_sha);
  proof_signature := encode(app.hmac(convert_to(signed_value,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
end $$;

-- La ventana de envío y el Anexo A dependen del reloj y de un snapshot real:
-- se sustituyen por versiones de prueba y se RESTAURAN al final, para que el
-- diff de esquema del runner compare el estado real.
create table pg_temp.m041_saved(name text primary key, definition text);
insert into pg_temp.m041_saved select 'window',pg_get_functiondef('app.hybrid_dispatch_window_is_open(timestamptz)'::regprocedure);
insert into pg_temp.m041_saved select 'annex',pg_get_functiondef('app.annex_a_manifest_is_ready(uuid)'::regprocedure);
create or replace function app.hybrid_dispatch_window_is_open(target_at timestamptz) returns boolean
language sql stable set search_path=pg_catalog as $$ select true $$;

-- 1. Variante por cargo: espejo de src/lib/correos/roles.ts.
do $$ begin
  if app.direct_lane_variant_for_role('Purchasing Manager')<>'COMPRAS'
    or app.direct_lane_variant_for_role('Coordinador de Seguridad e Higiene')<>'SEGURIDAD'
    or app.direct_lane_variant_for_role('Seguridad, higiene y mantenimiento')<>'SEGURIDAD'
    or app.direct_lane_variant_for_role('EHS Manager')<>'SEGURIDAD'
    or app.direct_lane_variant_for_role('Gerente de Mantenimiento')<>'MANTENIMIENTO'
    or app.direct_lane_variant_for_role('Plant Manager')<>'MANTENIMIENTO'
    or app.direct_lane_variant_for_role('Director General')<>'DIRECCION'
    or app.direct_lane_variant_for_role(null)<>'DIRECCION'
  then raise exception 'M041_VARIANT_FOR_ROLE_MISMATCH'; end if;
end $$;

-- 2. Bóveda y comandos inalcanzables por los roles de la aplicación.
do $$ begin
  if has_table_privilege('authenticated','public.direct_lane_credentials','select')
    or has_table_privilege('service_role','public.direct_lane_credentials','select')
    or has_table_privilege('anon','public.direct_lane_credentials','select')
    or has_table_privilege('authenticated','public.direct_lane_authorizations','select')
    or has_table_privilege('authenticated','public.direct_lane_commands','insert')
    or has_function_privilege('anon','public.create_direct_lane_invitation(uuid,uuid,text,timestamptz,text)','execute')
    or has_function_privilege('service_role','public.read_direct_lane_credential(uuid,uuid,text,uuid,timestamptz,text)','execute')
  then raise exception 'M041_PRIVILEGES_TOO_OPEN'; end if;
end $$;

-- 3. Sin sesión de operador nada se crea; el extraño de otro tenant tampoco.
set role authenticated;
do $$ begin
  begin
    perform public.create_direct_lane_invitation('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',repeat('1',64),date_trunc('day',clock_timestamp())+interval '1 day 12 hours',repeat('a',64));
    raise exception 'M041_INVITATION_WITHOUT_SESSION';
  exception when others then if sqlerrm<>'DIRECT_LANE_OPERATOR_REQUIRED' then raise; end if; end;
end $$;
reset role;
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000003';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ begin
  begin
    perform public.create_direct_lane_invitation('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',repeat('1',64),date_trunc('day',clock_timestamp())+interval '1 day 12 hours',repeat('a',64));
    raise exception 'M041_INVITATION_CROSS_TENANT';
  exception when others then if sqlerrm<>'DIRECT_LANE_OPERATOR_REQUIRED' then raise; end if; end;
end $$;
reset role;

-- 4. Invitación → armado → consentimiento, con identidad exacta.
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ declare r jsonb; begin
  r := public.create_direct_lane_invitation('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',repeat('1',64),date_trunc('day',clock_timestamp())+interval '1 day 12 hours',repeat('a',64));
  if r->>'status'<>'CREATED' or r->>'normalized_email'<>'francisco@enncoindustrial.com' or (r->>'replayed')::boolean then raise exception 'M041_INVITATION_CREATE_FAILED %', r; end if;
  r := public.create_direct_lane_invitation('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',repeat('1',64),date_trunc('day',clock_timestamp())+interval '1 day 12 hours',repeat('a',64));
  if not (r->>'replayed')::boolean then raise exception 'M041_INVITATION_REPLAY_FAILED'; end if;
  begin
    perform public.create_direct_lane_invitation('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',repeat('2',64),date_trunc('day',clock_timestamp())+interval '1 day 12 hours',repeat('a',64));
    raise exception 'M041_IDEMPOTENCY_REUSE_ACCEPTED';
  exception when others then if sqlerrm<>'DIRECT_LANE_IDEMPOTENCY_KEY_REUSE_MISMATCH' then raise; end if; end;
  -- Segundo buzón: invitación aparte.
  r := public.create_direct_lane_invitation('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000002',repeat('3',64),date_trunc('day',clock_timestamp())+interval '1 day 12 hours',repeat('b',64));
  if r->>'status'<>'CREATED' then raise exception 'M041_INVITATION_2_FAILED'; end if;
end $$;
reset role;

do $$ declare p record; r jsonb; begin
  -- Leer con prueba HMAC (sin sesión).
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','read_direct_lane_invitation',array['41000000-0000-4000-8000-000000000001',repeat('1',64)]);
  r := public.read_direct_lane_invitation('41000000-0000-4000-8000-000000000001',repeat('1',64),p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'VALID' or r->>'normalized_email'<>'francisco@enncoindustrial.com' then raise exception 'M041_INVITATION_READ_FAILED %', r; end if;
  -- Un token que no existe es INVALID, no un error.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','read_direct_lane_invitation',array['41000000-0000-4000-8000-000000000001',repeat('9',64)]);
  r := public.read_direct_lane_invitation('41000000-0000-4000-8000-000000000001',repeat('9',64),p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'INVALID' then raise exception 'M041_INVITATION_UNKNOWN_NOT_INVALID'; end if;
  -- Una prueba con firma falsa se rechaza.
  begin
    perform public.read_direct_lane_invitation('41000000-0000-4000-8000-000000000001',repeat('1',64),p.proof_command_id,gen_random_uuid(),p.proof_expires_at,repeat('0',64));
    raise exception 'M041_FORGED_PROOF_ACCEPTED';
  exception when others then if sqlerrm<>'DISPATCH_PROOF_SIGNATURE_INVALID' then raise; end if; end;
  -- Armar.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','arm_direct_lane_authorization',array['41000000-0000-4000-8000-000000000001',repeat('1',64),repeat('5',64)]);
  r := public.arm_direct_lane_authorization('41000000-0000-4000-8000-000000000001',repeat('1',64),repeat('5',64),p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'ARMED' then raise exception 'M041_ARM_FAILED %', r; end if;
  -- Completar con la identidad equivocada: rechazado, nada se guarda.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','complete_direct_lane_authorization',
    array['41000000-0000-4000-8000-000000000001',repeat('5',64),'otro@enncoindustrial.com',repeat('6',64),repeat('c',64),'app-aes256gcm:v1:0123456789abcdef']);
  begin
    perform public.complete_direct_lane_authorization('41000000-0000-4000-8000-000000000001',repeat('5',64),'otro@enncoindustrial.com',repeat('6',64),
      'v1.'||repeat('x',60),'app-aes256gcm:v1:0123456789abcdef',repeat('c',64),
      array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly','openid','email'],clock_timestamp(),
      p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
    raise exception 'M041_IDENTITY_MISMATCH_ACCEPTED';
  exception when others then if sqlerrm<>'DIRECT_LANE_IDENTITY_MISMATCH' then raise; end if; end;
  if exists(select 1 from public.direct_lane_credentials) then raise exception 'M041_CREDENTIAL_WRITTEN_ON_MISMATCH'; end if;
  -- Completar bien.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','complete_direct_lane_authorization',
    array['41000000-0000-4000-8000-000000000001',repeat('5',64),'francisco@enncoindustrial.com',repeat('6',64),repeat('c',64),'app-aes256gcm:v1:0123456789abcdef']);
  r := public.complete_direct_lane_authorization('41000000-0000-4000-8000-000000000001',repeat('5',64),'francisco@enncoindustrial.com',repeat('6',64),
    'v1.'||repeat('x',60),'app-aes256gcm:v1:0123456789abcdef',repeat('c',64),
    array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly','openid','email'],clock_timestamp(),
    p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'CONNECTED' then raise exception 'M041_COMPLETE_FAILED %', r; end if;
  if (select direct_lane_status from public.mailboxes where id='41400000-0000-4000-8000-000000000001')<>'CONNECTED' then raise exception 'M041_MAILBOX_NOT_CONNECTED_AFTER_CONSENT'; end if;
  if (select credential_status from public.mailboxes where id='41400000-0000-4000-8000-000000000001')<>'OAUTH_CONNECTED' then raise exception 'M041_CREDENTIAL_STATUS_NOT_SET'; end if;
  -- Repetir el mismo estado ya consumido con el mismo hash: DUPLICATE, no doble credencial.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','complete_direct_lane_authorization',
    array['41000000-0000-4000-8000-000000000001',repeat('5',64),'francisco@enncoindustrial.com',repeat('6',64),repeat('c',64),'app-aes256gcm:v1:0123456789abcdef']);
  r := public.complete_direct_lane_authorization('41000000-0000-4000-8000-000000000001',repeat('5',64),'francisco@enncoindustrial.com',repeat('6',64),
    'v1.'||repeat('x',60),'app-aes256gcm:v1:0123456789abcdef',repeat('c',64),
    array['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly','openid','email'],clock_timestamp(),
    p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'DUPLICATE' then raise exception 'M041_DUPLICATE_NOT_DETECTED %', r; end if;
  if (select count(*) from public.direct_lane_credentials where status='ACTIVE')<>1 then raise exception 'M041_ACTIVE_CREDENTIAL_COUNT'; end if;
  -- Leer la credencial con prueba: regresa ciphertext, no secreto, y audita el hash.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','read_direct_lane_credential',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001']);
  r := public.read_direct_lane_credential('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'ciphertext'<>'v1.'||repeat('x',60) or r->>'credential_sha256'<>repeat('c',64) then raise exception 'M041_CREDENTIAL_READ_FAILED'; end if;
  if not exists(select 1 from public.audit_log where action='DIRECT_LANE_CREDENTIAL_READ' and new_data->>'credential_sha256'=repeat('c',64)) then raise exception 'M041_CREDENTIAL_READ_NOT_AUDITED'; end if;
  if exists(select 1 from public.audit_log where new_data::text like '%'||repeat('x',60)||'%') then raise exception 'M041_CIPHERTEXT_LEAKED_TO_AUDIT'; end if;
end $$;

-- 5. Campaña: crear (operador), aprobar (sólo admin).
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ declare r jsonb; seq jsonb; touches jsonb; v jsonb; variants jsonb := '[]'::jsonb; i integer; begin
  touches := '[]'::jsonb;
  for i in 1..8 loop
    touches := touches || jsonb_build_object('touch_number',i,'day_offset',(array[0,3,7,14,28,42,60,75])[i],
      'subject','Toque '||i||' para {{company}}','body','Hola {{first_name}}, cuerpo corto del toque '||i||' sin ligas. Francisco');
  end loop;
  i := 0;
  foreach v in array array['"DIRECCION"'::jsonb,'"MANTENIMIENTO"'::jsonb,'"SEGURIDAD"'::jsonb,'"COMPRAS"'::jsonb] loop
    i := i+1;
    variants := variants || jsonb_build_object('key',v#>>'{}','label',v#>>'{}','version',i,'content_sha256',repeat(substr('abcd',i,1),64),'touches',touches);
  end loop;
  seq := jsonb_build_object('source','gate','source_sha256',repeat('f',64),'content_sha256',repeat('e',64),'sender_name','Francisco Cuellar','sender_title','CEO, ENNCO',
    'day_offsets','[0,3,7,14,28,42,60,75]'::jsonb,'variants',variants);
  r := public.create_direct_lane_campaign('41000000-0000-4000-8000-000000000001','Gate M041','paco@ennco.com.mx',seq,repeat('d',64));
  if r->>'status'<>'CREATED' then raise exception 'M041_CAMPAIGN_CREATE_FAILED %', r; end if;
  perform set_config('m041.campaign',r->>'campaign_id',false);
  if (select count(*) from public.sequence_touches st join public.sequence_versions sv on sv.id=st.sequence_version_id where sv.campaign_id=(r->>'campaign_id')::uuid)<>32 then raise exception 'M041_SEQUENCE_TOUCH_COUNT'; end if;
  if (select lane||'/'||direct_lane_state||'/'||status from public.campaigns where id=(r->>'campaign_id')::uuid)<>'DIRECT/DRAFT/DRAFT' then raise exception 'M041_CAMPAIGN_INITIAL_STATE'; end if;
  begin
    perform public.approve_direct_lane_campaign('41000000-0000-4000-8000-000000000001',(r->>'campaign_id')::uuid,repeat('e',64));
    raise exception 'M041_OPERATOR_APPROVED_CAMPAIGN';
  exception when others then if sqlerrm<>'DIRECT_LANE_APPROVAL_REQUIRES_ADMIN' then raise; end if; end;
end $$;
reset role;
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ declare r jsonb; cid uuid := current_setting('m041.campaign')::uuid; begin
  r := public.approve_direct_lane_campaign('41000000-0000-4000-8000-000000000001',cid,repeat('e',64));
  if r->>'status'<>'RUNNING' then raise exception 'M041_APPROVE_FAILED %', r; end if;
  if (select direct_lane_state||'/'||status from public.campaigns where id=cid)<>'RUNNING/APPROVED' then raise exception 'M041_CAMPAIGN_NOT_RUNNING'; end if;
  if exists(select 1 from public.sequence_versions where campaign_id=cid and approved_at is null) then raise exception 'M041_SEQUENCE_NOT_APPROVED'; end if;
end $$;
reset role;

-- 6. Candados globales en live: kill switch primero, Anexo A después.
do $$ declare p record; r jsonb; begin
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','false']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',false,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'NOOP' or r->>'reason'<>'RUNTIME_HOLD' then raise exception 'M041_KILL_SWITCH_IGNORED %', r; end if;
  update public.runtime_controls set global_kill_switch=false,external_send_allowed=true where organization_id='41000000-0000-4000-8000-000000000001';
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','false']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',false,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'NOOP' or r->>'reason'<>'ANNEX_A_NOT_READY' then raise exception 'M041_ANNEX_A_IGNORED %', r; end if;
end $$;
-- Sin el Anexo A aplicado, la supresión falla cerrado (M025) y nadie se inscribe:
-- de aquí en adelante el gate lo da por listo, y lo restaura al final.
create or replace function app.annex_a_manifest_is_ready(target_organization_id uuid) returns boolean
language sql stable set search_path=pg_catalog as $$ select true $$;

-- 6b. Inscribir por cargo: 1 compras, 1 mantenimiento; el no verificado y el suprimido quedan fuera.
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ declare r jsonb; cid uuid := current_setting('m041.campaign')::uuid; begin
  r := public.enroll_direct_lane_contacts('41000000-0000-4000-8000-000000000001',cid,null,null,50,repeat('f',64));
  if (r->>'enrolled')::integer<>2 or (r->>'skipped_unverified')::integer<>1 or (r->>'skipped_suppressed')::integer<>1
    or (r->'by_variant'->>'COMPRAS')::integer<>1 or (r->'by_variant'->>'MANTENIMIENTO')::integer<>1
  then raise exception 'M041_ENROLL_COUNTS %', r; end if;
  if (select count(distinct mailbox_id) from public.campaign_enrollments where campaign_id=cid)<>1
    or (select mailbox_id from public.campaign_enrollments where campaign_id=cid limit 1)<>'41400000-0000-4000-8000-000000000001'
  then raise exception 'M041_ENROLL_MAILBOX_DISTRIBUTION'; end if;
  r := public.enroll_direct_lane_contacts('41000000-0000-4000-8000-000000000001',cid,null,null,50,repeat('0',64));
  if (r->>'enrolled')::integer<>0 or (r->>'skipped_enrolled')::integer<>2 then raise exception 'M041_ENROLL_DUPLICATED %', r; end if;
end $$;
reset role;

-- 6c. Sombra funciona con el kill switch activo y no toca Gmail ni el estado real.
update public.runtime_controls set global_kill_switch=true,external_send_allowed=false where organization_id='41000000-0000-4000-8000-000000000001';
do $$ declare p record; r jsonb; begin
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','true']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',true,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'SHADOW_CLAIMED' or r->>'kind'<>'TOUCH' or (r->>'touch_number')::integer<>1 then raise exception 'M041_SHADOW_CLAIM_FAILED %', r; end if;
  if (select status||'/'||lane from public.messages where id=(r->>'message_id')::uuid)<>'DRY_RUN/DIRECT' then raise exception 'M041_SHADOW_MESSAGE_STATE'; end if;
  if r->>'subject' not like 'Toque 1 para %' or r->>'body_text' not like 'Hola %' or r->>'body_text' like '%{{%' then raise exception 'M041_RENDER_FAILED %', r->>'body_text'; end if;
  if exists(select 1 from public.campaign_enrollments where campaign_id=current_setting('m041.campaign')::uuid and status<>'PENDING') then raise exception 'M041_SHADOW_MUTATED_ENROLLMENT'; end if;
end $$;
update public.runtime_controls set global_kill_switch=false,external_send_allowed=true where organization_id='41000000-0000-4000-8000-000000000001';

-- 7. Claim live → SENDING; settle SENT avanza la secuencia; ritmo y tope muerden.
do $$ declare p record; r jsonb; mid uuid; eid uuid; begin
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','false']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',false,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'CLAIMED' or r->>'kind'<>'TOUCH' then raise exception 'M041_LIVE_CLAIM_FAILED %', r; end if;
  mid := (r->>'message_id')::uuid; eid := (r->>'enrollment_id')::uuid;
  if (select status from public.messages where id=mid)<>'SENDING' then raise exception 'M041_LIVE_MESSAGE_NOT_SENDING'; end if;
  if (select status from public.campaign_enrollments where id=eid)<>'ACTIVE' then raise exception 'M041_ENROLLMENT_NOT_ACTIVATED'; end if;
  -- Settle SENT sin provider id: rechazado.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','settle_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001',mid::text,'SENT','','','','']);
  begin
    perform public.settle_direct_lane_dispatch('41000000-0000-4000-8000-000000000001',mid,'SENT',null,null,null,null,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
    raise exception 'M041_SENT_WITHOUT_PROVIDER_ID';
  exception when others then if sqlerrm<>'DIRECT_LANE_SETTLE_SENT_INVALID' then raise; end if; end;
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','settle_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001',mid::text,'SENT','gm-1','th-1','<msg-'||mid::text||'@enncoindustrial.com>','']);
  r := public.settle_direct_lane_dispatch('41000000-0000-4000-8000-000000000001',mid,'SENT','gm-1','th-1','<msg-'||mid::text||'@enncoindustrial.com>',null,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'SETTLED' then raise exception 'M041_SETTLE_FAILED %', r; end if;
  if (select status||'/'||provider_message_id||'/'||provider_thread_id from public.messages where id=mid)<>'SENT/gm-1/th-1' then raise exception 'M041_SENT_STATE'; end if;
  if (select next_touch_number from public.campaign_enrollments where id=eid)<>2 then raise exception 'M041_ENROLLMENT_NOT_ADVANCED'; end if;
  if (select next_touch_at from public.campaign_enrollments where id=eid) < clock_timestamp()+interval '2 days 23 hours' then raise exception 'M041_NEXT_TOUCH_AT_WRONG'; end if;
  if (select direct_lane_first_send_at from public.mailboxes where id='41400000-0000-4000-8000-000000000001') is null then raise exception 'M041_FIRST_SEND_AT_NOT_SET'; end if;
  -- La atribución automática del primer contacto también aplica al carril directo.
  if not exists(select 1 from public.attribution_events where organization_id='41000000-0000-4000-8000-000000000001' and first_contact_message_id=mid) then raise exception 'M041_ATTRIBUTION_NOT_RECORDED'; end if;
  -- Settle repetido: DUPLICATE.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','settle_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001',mid::text,'SENT','gm-1','th-1','','']);
  r := public.settle_direct_lane_dispatch('41000000-0000-4000-8000-000000000001',mid,'SENT','gm-1','th-1',null,null,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'DUPLICATE' then raise exception 'M041_SETTLE_NOT_IDEMPOTENT %', r; end if;
  -- Ritmo: el segundo claim inmediato se detiene.
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','false']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',false,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'NOOP' or r->>'reason'<>'PACING_HOLD' then raise exception 'M041_PACING_IGNORED %', r; end if;
  -- Tope: con rampa fija de 1 ya no hay presupuesto.
  update public.mailboxes set direct_lane_ramp_mode='FIXED',direct_lane_fixed_cap=1 where id='41400000-0000-4000-8000-000000000001';
  update public.messages set created_at=created_at-interval '20 minutes',sent_at=sent_at-interval '20 minutes' where id=mid;
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','false']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',false,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'NOOP' or r->>'reason'<>'BUDGET_EXHAUSTED' then raise exception 'M041_CAP_IGNORED %', r; end if;
  update public.mailboxes set direct_lane_ramp_mode='AUTO' where id='41400000-0000-4000-8000-000000000001';
  perform set_config('m041.sent_message',mid::text,false);
  perform set_config('m041.enrollment',eid::text,false);
end $$;

-- 8. Respuesta del prospecto → secuencia detenida → respuesta del operador en hilo con copia.
do $$ declare p record; r jsonb; mid uuid := current_setting('m041.sent_message')::uuid; eid uuid := current_setting('m041.enrollment')::uuid; peid uuid; rid uuid; begin
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','apply_dispatch_provider_event',
    array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','gm-reply-1','gm-reply-1',mid::text,'REPLY','compras@autopartes-bajio.invalid',
      encode(digest(convert_to('Re: Toque 1','utf8'),'sha256'),'hex'),encode(digest(convert_to('','utf8'),'sha256'),'hex'),floor(extract(epoch from clock_timestamp()))::bigint::text]);
  r := public.apply_dispatch_provider_event('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','gm-reply-1','gm-reply-1',mid,'REPLY','compras@autopartes-bajio.invalid','Re: Toque 1',null,
    to_timestamp(floor(extract(epoch from clock_timestamp()))),p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'PROCESSED' then raise exception 'M041_REPLY_NOT_PROCESSED %', r; end if;
  peid := (r->>'provider_event_id')::uuid;
  if (select status from public.campaign_enrollments where id=eid)<>'REPLIED' then raise exception 'M041_REPLY_DID_NOT_STOP_SEQUENCE'; end if;
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','annotate_direct_lane_inbound',array['41000000-0000-4000-8000-000000000001',peid::text,'<reply-1@autopartes-bajio.invalid>','th-1']);
  r := public.annotate_direct_lane_inbound('41000000-0000-4000-8000-000000000001',peid,'<reply-1@autopartes-bajio.invalid>','th-1',p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'ANNOTATED' then raise exception 'M041_ANNOTATE_FAILED %', r; end if;
  perform set_config('m041.provider_event',peid::text,false);
end $$;
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ declare r jsonb; peid uuid := current_setting('m041.provider_event')::uuid; begin
  r := public.enqueue_direct_lane_reply('41000000-0000-4000-8000-000000000001',peid,'Gracias, Juan. Te mando el formato para revisar recibo o capacidad instalada. Francisco',repeat('1',64));
  if r->>'status'<>'QUEUED' or r->>'cc'<>'paco@ennco.com.mx' then raise exception 'M041_REPLY_ENQUEUE_FAILED %', r; end if;
  if (select touch_number is null and cc_emails=array['paco@ennco.com.mx'] and subject='Re: Toque 1' and provider_thread_id='th-1' from public.messages where id=(r->>'message_id')::uuid) is not true then raise exception 'M041_REPLY_MESSAGE_SHAPE'; end if;
  perform set_config('m041.reply_message',r->>'message_id',false);
end $$;
reset role;
do $$ declare p record; r jsonb; rid uuid := current_setting('m041.reply_message')::uuid; begin
  update public.messages set created_at=created_at-interval '20 minutes',sent_at=sent_at-interval '20 minutes' where lane='DIRECT' and direction='OUTBOUND' and id<>rid;
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','claim_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','false']);
  r := public.claim_direct_lane_dispatch('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001',false,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'CLAIMED' or r->>'kind'<>'REPLY' or (r->>'message_id')::uuid<>rid then raise exception 'M041_REPLY_NOT_PRIORITIZED %', r; end if;
  if r->'thread'->>'in_reply_to'<>'<reply-1@autopartes-bajio.invalid>' or r->'thread'->>'provider_thread_id'<>'th-1' or r->'cc_emails'->>0<>'paco@ennco.com.mx' then raise exception 'M041_REPLY_THREAD_OR_CC %', r; end if;
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','settle_direct_lane_dispatch',array['41000000-0000-4000-8000-000000000001',rid::text,'SENT','gm-2','th-1','<msg-'||rid::text||'@enncoindustrial.com>','']);
  r := public.settle_direct_lane_dispatch('41000000-0000-4000-8000-000000000001',rid,'SENT','gm-2','th-1','<msg-'||rid::text||'@enncoindustrial.com>',null,p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if r->>'status'<>'SETTLED' then raise exception 'M041_REPLY_SETTLE_FAILED %', r; end if;
  if (select status from public.campaign_enrollments where id=current_setting('m041.enrollment')::uuid)<>'REPLIED' then raise exception 'M041_REPLY_SEND_CHANGED_ENROLLMENT'; end if;
end $$;

-- 9. El trigger propio muerde donde debe y el híbrido ya no estorba.
do $$ declare eid uuid := current_setting('m041.enrollment')::uuid; cid uuid := current_setting('m041.campaign')::uuid; begin
  -- Texto con liga en toque 1.
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    values ('41000000-0000-4000-8000-000000000001',eid,'41400000-0000-4000-8000-000000000001','41300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','DIRECT',1,
      'compras@autopartes-bajio.invalid','francisco@enncoindustrial.com','x','Mira https://ejemplo.invalid','m041-neg-1',gen_random_uuid());
    raise exception 'M041_LINK_IN_FIRST_TOUCH_ACCEPTED';
  exception when others then if sqlerrm not in ('DIRECT_LANE_FIRST_TOUCH_LINK_FORBIDDEN','DIRECT_LANE_ENROLLMENT_NOT_ACTIVE') then raise; end if; end;
  -- HTML.
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,reply_to_provider_event_id)
    values ('41000000-0000-4000-8000-000000000001',eid,'41400000-0000-4000-8000-000000000001','41300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','DIRECT',null,
      'compras@autopartes-bajio.invalid','francisco@enncoindustrial.com','x','<b>hola</b> respuesta','m041-neg-2',gen_random_uuid(),current_setting('m041.provider_event')::uuid);
    raise exception 'M041_HTML_ACCEPTED';
  exception when others then if sqlerrm<>'DIRECT_LANE_PLAIN_TEXT_REQUIRED' then raise; end if; end;
  -- Remitente distinto del buzón.
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,reply_to_provider_event_id)
    values ('41000000-0000-4000-8000-000000000001',eid,'41400000-0000-4000-8000-000000000001','41300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','DIRECT',null,
      'compras@autopartes-bajio.invalid','otro@enncoindustrial.com','x','respuesta limpia','m041-neg-3',gen_random_uuid(),current_setting('m041.provider_event')::uuid);
    raise exception 'M041_FROM_DRIFT_ACCEPTED';
  exception when others then if sqlerrm<>'DIRECT_LANE_FROM_IDENTITY_DRIFT' then raise; end if; end;
  -- Campaña en pausa: ningún toque sale.
  update public.campaigns set direct_lane_state='PAUSED',status='PAUSED' where id=cid;
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    select '41000000-0000-4000-8000-000000000001',ce.id,ce.mailbox_id,ce.contact_id,'OUTBOUND','QUEUED','DIRECT',1,'mantenimiento@papelera-centro.invalid','francisco@enncoindustrial.com','x','cuerpo limpio sin ligas','m041-neg-4',gen_random_uuid()
    from public.campaign_enrollments ce where ce.campaign_id=cid and ce.contact_id='41300000-0000-4000-8000-000000000002';
    raise exception 'M041_PAUSED_CAMPAIGN_SENT';
  exception when others then if sqlerrm<>'DIRECT_LANE_CAMPAIGN_NOT_RUNNING' then raise; end if; end;
  update public.campaigns set direct_lane_state='RUNNING',status='APPROVED' where id=cid;
  -- Un mensaje híbrido sigue exigiendo su release (el bypass es sólo para DIRECT).
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    select '41000000-0000-4000-8000-000000000001',ce.id,ce.mailbox_id,ce.contact_id,'OUTBOUND','QUEUED','HYBRID',1,'mantenimiento@papelera-centro.invalid','francisco@enncoindustrial.com','x','cuerpo','m041-neg-5',gen_random_uuid()
    from public.campaign_enrollments ce where ce.campaign_id=cid and ce.contact_id='41300000-0000-4000-8000-000000000002';
    raise exception 'M041_HYBRID_BYPASSED';
  exception when others then if sqlerrm<>'HYBRID_RELEASE_NOT_BOUND' then raise; end if; end;
end $$;

-- 10. Pausar y desconectar el buzón; el buzón del cliente no pasa de 20.
-- (El segundo buzón se convierte en el del cliente fuera del rol de sesión: la
-- app no puede escribir mailboxes directo, sólo por RPC.)
update public.mailboxes set eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP',domain_role='PRIMARY_CORPORATE',custody_status='TECKEL_MANAGED_FOR_ENNCO',human_history_verified=true,warmup_minimum_days=0 where id='41400000-0000-4000-8000-000000000002';
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$ declare r jsonb; begin
  r := public.configure_direct_lane_mailbox('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','{"status":"PAUSED"}'::jsonb,'gate',repeat('2',64));
  if r->'mailbox'->>'status'<>'PAUSED' then raise exception 'M041_PAUSE_FAILED %', r; end if;
  begin
    perform public.configure_direct_lane_mailbox('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000002','{"status":"CONNECTED"}'::jsonb,'gate',repeat('3',64));
    raise exception 'M041_CONNECTED_WITHOUT_CREDENTIAL';
  exception when others then if sqlerrm<>'DIRECT_LANE_CREDENTIAL_MISSING' then raise; end if; end;
  begin
    perform public.configure_direct_lane_mailbox('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000002','{"cap_max":30}'::jsonb,'gate',repeat('4',64));
    raise exception 'M041_CLIENT_CAP_ACCEPTED';
  exception when others then if sqlerrm<>'DIRECT_LANE_CLIENT_MAILBOX_CAP_LIMIT' then raise; end if; end;
  r := public.revoke_direct_lane_credential('41000000-0000-4000-8000-000000000001','41400000-0000-4000-8000-000000000001','gate',repeat('5',64));
  if (r->>'revoked')::integer<>1 then raise exception 'M041_REVOKE_FAILED %', r; end if;
  if (select direct_lane_status||'/'||credential_status from public.mailboxes where id='41400000-0000-4000-8000-000000000001')<>'DISCONNECTED/REVOKED' then raise exception 'M041_REVOKE_STATE'; end if;
  r := public.read_direct_lane_overview('41000000-0000-4000-8000-000000000001');
  if not (r ? 'mailboxes' and r ? 'campaigns' and r ? 'pending_replies' and r ? 'recent_messages' and r ? 'flags') then raise exception 'M041_OVERVIEW_SHAPE'; end if;
  if (r->'totals'->>'sent_total')::integer<>2 then raise exception 'M041_OVERVIEW_TOTALS %', r->'totals'; end if;
end $$;
reset role;
set request.jwt.claim.sub = '41100000-0000-4000-8000-000000000003';
set role authenticated;
do $$ begin
  begin
    perform public.read_direct_lane_overview('41000000-0000-4000-8000-000000000001');
    raise exception 'M041_OVERVIEW_CROSS_TENANT';
  exception when others then if sqlerrm<>'DIRECT_LANE_MEMBER_REQUIRED' then raise; end if; end;
end $$;
reset role;

-- 11. El informe de salud del motor expone el carril.
do $$ declare p record; r jsonb; begin
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','read_dispatch_health',array['41000000-0000-4000-8000-000000000001']);
  r := public.read_dispatch_health('41000000-0000-4000-8000-000000000001',p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if not (r ? 'direct_lane') or not (r->'direct_lane' ? 'mailboxes') then raise exception 'M041_HEALTH_MISSING_DIRECT_LANE'; end if;
  select * into p from app.m041_proof('41000000-0000-4000-8000-000000000001','read_direct_lane_health',array['41000000-0000-4000-8000-000000000001']);
  r := public.read_direct_lane_health('41000000-0000-4000-8000-000000000001',p.proof_command_id,p.proof_nonce,p.proof_expires_at,p.proof_signature);
  if jsonb_array_length(r->'mailboxes')<>2 then raise exception 'M041_DIRECT_HEALTH_MAILBOXES'; end if;
end $$;

-- Restaurar y limpiar.
do $$ declare d text; begin
  select definition into d from pg_temp.m041_saved where name='window'; execute d;
  select definition into d from pg_temp.m041_saved where name='annex'; execute d;
end $$;
drop function app.m041_proof(uuid,text,text[]);
drop table pg_temp.m041_saved;
select 'DIRECT_LANE_GATE_PASS' as result;
