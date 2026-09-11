begin;
set local search_path=pg_catalog,public,extensions,app,pg_temp;

-- M055: expediente operativo independiente de leads, comisiones y precotizador.
-- No se concede SELECT crudo: las RPC aplican proyecciones por área también en DB.
create table public.ennco_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  folio text not null,
  name text not null check (length(trim(name)) between 1 and 160),
  segment text not null check (segment in ('RESIDENTIAL','COMMERCIAL','INDUSTRIAL')),
  customer jsonb not null default '{}'::jsonb check (jsonb_typeof(customer) = 'object'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  stage text not null default 'PROSPECT' check (stage in ('PROSPECT','INFORMATION','QUOTATION','SURVEY','PROPOSAL','NEGOTIATION','CONTRACTED','ADVANCE','PURCHASES','ENGINEERING','EXECUTION','INTERCONNECTION','COLLECTION','DELIVERY','CLOSED')),
  lifecycle text not null default 'ACTIVE' check (lifecycle in ('ACTIVE','PAUSED','CANCELLED','LOST')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,folio), unique (organization_id,id)
);
create table public.ennco_project_members (
  organization_id uuid not null,
  user_id uuid not null,
  area text not null check (area in ('direction','administration','purchases','engineering','projects','sales')),
  granted_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id,area),
  foreign key (organization_id,user_id) references public.organization_users(organization_id,user_id)
);
create table public.ennco_project_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  kind text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  actor_id uuid not null,
  project_version integer not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id,project_id) references public.ennco_projects(organization_id,id),
  unique (project_id,project_version), unique (organization_id,project_id,id)
);
create index ennco_project_records_lookup on public.ennco_project_records(project_id,kind,project_version desc);
create table public.ennco_project_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  record_id uuid not null,
  section text not null,
  drive_file_id text,
  status text not null default 'PENDING' check (status in ('PENDING','READY','FAILED')),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id,project_id,record_id) references public.ennco_project_records(organization_id,project_id,id),
  unique (project_id,record_id)
);
create table public.ennco_project_catalogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  category text not null,
  name text not null check (length(trim(name)) between 1 and 160),
  version integer not null check (version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  source_url text,
  source_date date not null,
  status text not null check (status in ('DRAFT','APPROVED','RETIRED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id,category,name,version)
);
create table app.ennco_project_counters (
  organization_id uuid not null references public.organizations(id),
  folio_year integer not null,
  next_value bigint not null,
  primary key (organization_id,folio_year)
);
create table app.ennco_project_commands (
  organization_id uuid not null,
  actor_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id,actor_id,idempotency_key)
);
create table app.ennco_project_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid,
  actor_id uuid not null,
  action text not null,
  version integer,
  record_id uuid,
  occurred_at timestamptz not null default now()
);
-- La clave nunca sale de PostgreSQL. El servidor sólo obtiene firmas ligadas a
-- una solicitud concreta; la sesión del usuario sigue autorizando la escritura.
create table app.ennco_project_signing_secret (
  singleton boolean primary key default true check (singleton),
  secret bytea not null check (octet_length(secret)=32),
  created_at timestamptz not null default now()
);
insert into app.ennco_project_signing_secret(singleton,secret) values(true,gen_random_bytes(32));

create function app.ennco_project_attestation(target_org uuid,target_actor uuid,target_project uuid,
  expected_version integer,record_kind text,payload jsonb,request_key text) returns text
language sql stable security definer set search_path=pg_catalog,public,extensions,app,pg_temp as $$
  select encode(hmac(convert_to(jsonb_build_object('organizationId',target_org,'actorId',target_actor,
    'projectId',target_project,'expectedVersion',expected_version,'kind',record_kind,'data',payload,'requestKey',request_key)::text,'UTF8'),secret,'sha256'),'hex')
  from app.ennco_project_signing_secret where singleton;
$$;
create function public.ennco_projects_attest(target_organization_id uuid,target_actor_id uuid,target_project_id uuid,
  expected_version integer,record_kind text,payload jsonb,idempotency_key text) returns text
language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
begin
  if record_kind is null or record_kind not in ('calculation','proposal','supplier_quote','document','drive_setup') then
    raise exception 'PROJECT_ATTESTATION_KIND_INVALID' using errcode='22023';
  end if;
  if target_actor_id is null or not exists(select 1 from public.organization_users
    where organization_id=target_organization_id and user_id=target_actor_id and active) then
    raise exception 'PROJECT_FORBIDDEN' using errcode='42501';
  end if;
  if not exists(select 1 from public.ennco_projects where organization_id=target_organization_id and id=target_project_id) then
    raise exception 'PROJECT_NOT_FOUND' using errcode='P0002';
  end if;
  if expected_version is null or expected_version<1 or payload is null or jsonb_typeof(payload)<>'object'
    or octet_length(payload::text)>1000000 or idempotency_key is null or length(idempotency_key) not between 8 and 160 then
    raise exception 'PROJECT_ATTESTATION_INPUT_INVALID' using errcode='22023';
  end if;
  return app.ennco_project_attestation(target_organization_id,target_actor_id,target_project_id,
    expected_version,record_kind,payload,idempotency_key);
end;
$$;

create function app.ennco_project_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, app, pg_temp as $$
begin raise exception 'PROJECT_APPEND_ONLY' using errcode = '23514'; end;
$$;
create trigger ennco_records_immutable before update or delete on public.ennco_project_records
for each row execute function app.ennco_project_immutable();
create trigger ennco_catalogs_immutable before update or delete on public.ennco_project_catalogs
for each row execute function app.ennco_project_immutable();
create trigger ennco_audit_immutable before update or delete on app.ennco_project_audit
for each row execute function app.ennco_project_immutable();

create function app.ennco_project_areas(target_organization_id uuid) returns text[]
language plpgsql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
declare role_value public.user_role; result text[];
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then
    raise exception 'PROJECT_FORBIDDEN' using errcode = '42501';
  end if;
  select role into role_value from public.organization_users
  where organization_id=target_organization_id and user_id=auth.uid() and active;
  if role_value='auditor_readonly' then return array[]::text[]; end if;
  if role_value='ennco_admin' then return array['direction','administration','purchases','engineering','projects','sales']; end if;
  select coalesce(array_agg(area),array[]::text[]) into result from public.ennco_project_members
  where organization_id=target_organization_id and user_id=auth.uid();
  return result;
end;
$$;
create function public.ennco_projects_permissions(target_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
declare areas text[]:=app.ennco_project_areas(target_organization_id);
begin
  return jsonb_build_object('areas',areas,'readOnly',cardinality(areas)=0,
    'canCreate',areas && array['direction','administration','engineering','projects','sales'],
    'canEdit',areas && array['direction','administration','engineering','projects','sales'],
    'canEngineer',areas && array['direction','engineering'],
    'canSell',areas && array['direction','sales'],
    'canPurchase',areas && array['direction','purchases'],
    'canConfirmPayments',areas && array['direction','administration'],
    'canApprove',areas && array['direction'],
    'canExecute',areas && array['direction','engineering','projects'],
    'canReadCosts',areas && array['direction','administration','purchases'] or app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]),
    'canReadMargins',areas && array['direction'] or app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]),
    'costScope',case when areas && array['direction','administration'] or app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]) then 'ALL' when 'purchases'=any(areas) then 'PURCHASES' else 'NONE' end,
    'canManageCatalogs',areas && array['direction','engineering','purchases'],
    'canManageMembers',areas && array['direction'],
    'canCloseFinancial',areas && array['direction','administration']);
end;
$$;
create function app.ennco_project_require(target_organization_id uuid,allowed text[]) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, app, pg_temp as $$
begin
  if not (app.ennco_project_areas(target_organization_id) && allowed) then
    raise exception 'PROJECT_FORBIDDEN' using errcode='42501';
  end if;
end;
$$;

-- Serializa claves antes de la comprobación de versión: un reintento exacto siempre
-- recupera el resultado original. Otra carga con la misma clave produce conflicto.
create function app.ennco_project_command_begin(target_org uuid,target_key text,target_request jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp as $$
declare previous app.ennco_project_commands; hash_value text:=encode(sha256(convert_to(target_request::text,'UTF8')),'hex');
begin
  if target_key is null or length(target_key) not between 8 and 160 then
    raise exception 'PROJECT_IDEMPOTENCY_REQUIRED' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text||auth.uid()::text||target_key,0));
  select * into previous from app.ennco_project_commands
  where organization_id=target_org and actor_id=auth.uid() and idempotency_key=target_key;
  if found then
    if previous.request_hash<>hash_value then raise exception 'PROJECT_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.response;
  end if;
  insert into app.ennco_project_commands(organization_id,actor_id,idempotency_key,request_hash)
  values(target_org,auth.uid(),target_key,hash_value);
  return null;
end;
$$;
create function app.ennco_project_command_finish(target_org uuid,target_key text,result jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, app, pg_temp as $$
begin
  update app.ennco_project_commands set response=result
  where organization_id=target_org and actor_id=auth.uid() and idempotency_key=target_key;
  return result;
end;
$$;

create function app.ennco_project_json(p public.ennco_projects) returns jsonb
language sql immutable set search_path=pg_catalog,public,app,pg_temp as $$
select jsonb_build_object('id',p.id,'organizationId',p.organization_id,'folio',p.folio,
 'name',p.name,'segment',p.segment,'customerName',coalesce(p.customer->>'name',''),
 'contactName',coalesce(p.customer->>'contactName',''),'email',coalesce(p.customer->>'email',''),
 'phone',coalesce(p.customer->>'phone',''),'location',coalesce(p.customer->>'location',''),
 'scope',coalesce(p.customer->>'scope',''),'data',p.data,'stage',p.stage,
 'lifecycle',p.lifecycle,'version',p.version,'createdBy',p.created_by,'createdAt',p.created_at,'updatedAt',p.updated_at);
$$;

create function public.ennco_projects_list(target_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
begin
  perform app.ennco_project_areas(target_organization_id);
  return coalesce((select jsonb_agg(app.ennco_project_json(p) order by p.updated_at desc)
    from public.ennco_projects p where organization_id=target_organization_id),'[]'::jsonb);
end;
$$;
-- CRM linkage is evidence/context only. Never creates or qualifies CRM records.
create function app.ennco_project_validate_links(target_org uuid,metadata jsonb) returns void
language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare linked_account uuid; linked_opportunity uuid; opportunity_account uuid;
begin
  linked_account:=(metadata->>'accountId')::uuid;
  linked_opportunity:=(metadata->>'opportunityId')::uuid;
  if linked_account is not null and not exists(select 1 from public.accounts where id=linked_account and organization_id=target_org) then
    raise exception 'PROJECT_ACCOUNT_REFERENCE_INVALID' using errcode='23514';
  end if;
  if linked_opportunity is not null then
    select account_id into opportunity_account from public.opportunities where id=linked_opportunity and organization_id=target_org;
    if not found then raise exception 'PROJECT_OPPORTUNITY_REFERENCE_INVALID' using errcode='23514'; end if;
    if linked_account is not null and linked_account<>opportunity_account then
      raise exception 'PROJECT_ACCOUNT_OPPORTUNITY_MISMATCH' using errcode='23514';
    end if;
  end if;
end;
$$;
create function public.ennco_projects_create(target_organization_id uuid,input jsonb,idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare previous jsonb; p public.ennco_projects; y integer:=extract(year from now() at time zone 'America/Mexico_City'); counter_value bigint;
begin
  perform app.ennco_project_require(target_organization_id,array['direction','administration','engineering','projects','sales']);
  previous:=app.ennco_project_command_begin(target_organization_id,idempotency_key,jsonb_build_object('action','create','input',input));
  if previous is not null then return previous; end if;
  if jsonb_typeof(input)<>'object' or input->>'name' is null or input->>'segment' is null then raise exception 'PROJECT_INPUT_INVALID' using errcode='22023'; end if;
  perform app.ennco_project_validate_links(target_organization_id,input->'data');
  insert into app.ennco_project_counters(organization_id,folio_year,next_value) values(target_organization_id,y,1)
  on conflict(organization_id,folio_year) do update set next_value=app.ennco_project_counters.next_value+1
  returning next_value into counter_value;
  insert into public.ennco_projects(organization_id,folio,name,segment,customer,data,created_by)
  values(target_organization_id,'ENN-'||y||'-'||lpad(counter_value::text,greatest(5,length(counter_value::text)),'0'),
    trim(input->>'name'),input->>'segment',jsonb_strip_nulls(jsonb_build_object('name',input->>'customerName',
      'contactName',input->>'contactName','email',input->>'email','phone',input->>'phone','location',input->>'location','scope',input->>'scope')),
    jsonb_strip_nulls(jsonb_build_object('accountId',input->'data'->>'accountId','opportunityId',input->'data'->>'opportunityId',
      'ownerName',input->'data'->>'ownerName','latitude',input->'data'->'latitude','longitude',input->'data'->'longitude','dueDate',input->'data'->>'dueDate')),auth.uid()) returning * into p;
  insert into app.ennco_project_audit(organization_id,project_id,actor_id,action,version)
  values(target_organization_id,p.id,auth.uid(),'created',p.version);
  return app.ennco_project_command_finish(target_organization_id,idempotency_key,jsonb_build_object('projectId',p.id,'version',p.version));
end;
$$;

create function app.ennco_project_active_records(target_project_id uuid)
returns setof public.ennco_project_records language sql stable security definer
set search_path=pg_catalog,public,app,pg_temp as $$
  select r.* from public.ennco_project_records r
  where r.project_id=target_project_id and r.kind<>'reversal'
    and not exists(select 1 from public.ennco_project_records v where v.project_id=r.project_id
      and v.kind='reversal' and v.data->>'recordId'=r.id::text);
$$;
create function app.ennco_project_redact(value jsonb,read_costs boolean,read_margins boolean)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public,app,pg_temp as $$
declare result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(value)='object' then
    result:='{}'::jsonb;
    for k,v in select * from jsonb_each(value) loop
      if (not read_margins and lower(k) ~ '(margin|profit|utilidad|margen)')
        or (not read_costs and lower(k) ~ '(cost|budget|presupuesto|purchaseprice)') then continue; end if;
      result:=result||jsonb_build_object(k,app.ennco_project_redact(v,read_costs,read_margins));
    end loop;
    return result;
  elsif jsonb_typeof(value)='array' then
    return coalesce((select jsonb_agg(app.ennco_project_redact(item,read_costs,read_margins)) from jsonb_array_elements(value) item),'[]'::jsonb);
  end if;
  return value;
end;
$$;
create function public.ennco_projects_get(target_organization_id uuid,target_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare p public.ennco_projects; areas text[]:=app.ennco_project_areas(target_organization_id);
  can_admin boolean:=areas && array['direction','administration'] or app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]); can_cost boolean:=areas && array['direction','administration','purchases'] or app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]); read_margins boolean:=areas && array['direction'] or app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]); records jsonb;
begin
  select * into p from public.ennco_projects where organization_id=target_organization_id and id=target_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'projectId',r.project_id,'kind',r.kind,
    'data',app.ennco_project_redact(case
      when not can_admin and r.kind='budget' then jsonb_build_object('approved',r.data->'approved')
      when not can_admin and r.kind='financial_closure' then '{}'::jsonb
      when not can_cost and r.kind='purchase_exception' then '{}'::jsonb
      when not can_cost and r.kind='purchase_order' then r.data-array['subtotalMxn','vatMxn','totalMxn']
      else r.data end,can_admin or (can_cost and r.kind in ('supplier_quote','purchase_order','material_receipt')),read_margins),
    'createdAt',r.created_at,'actorId',r.actor_id,'revision',r.project_version) order by r.project_version),'[]'::jsonb)
  into records from public.ennco_project_records r where r.project_id=p.id
    and (can_admin or r.kind not in ('expense','supplier_payment'))
    and (can_cost or r.kind not in ('supplier_quote'))
    and (r.kind<>'document' or coalesce(r.data->>'visibility','ADMIN')='TEAM'
      or (r.data->>'visibility'='ADMIN' and can_admin)
      or (r.data->>'visibility'='PURCHASES' and can_cost));
  return jsonb_build_object('project',app.ennco_project_json(p),'records',records,
    'permissions',public.ennco_projects_permissions(target_organization_id));
end;
$$;

create function app.ennco_project_money(data jsonb,key text,allow_zero boolean default false)
returns numeric language plpgsql immutable set search_path=pg_catalog,public,app,pg_temp as $$
declare amount numeric;
begin
  if jsonb_typeof(data->key)<>'number' or data->key is null then raise exception 'PROJECT_AMOUNT_REQUIRED:%',key using errcode='22023'; end if;
  amount:=(data->>key)::numeric;
  if amount<0 or (amount=0 and not allow_zero) or amount>1000000000000 or amount<>round(amount,2) then
    raise exception 'PROJECT_AMOUNT_INVALID:%',key using errcode='22023';
  end if;
  return amount;
end;
$$;
create function app.ennco_project_evidence(data jsonb,key text default 'evidence') returns void
language plpgsql immutable set search_path=pg_catalog,public,app,pg_temp as $$
begin
  if coalesce(length(trim(data->>key)),0)<3 then raise exception 'PROJECT_EVIDENCE_REQUIRED:%',key using errcode='22023'; end if;
end;
$$;
create function app.ennco_project_reference(target_project uuid,reference_id text,expected_kind text)
returns public.ennco_project_records language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare r public.ennco_project_records;
begin
  select * into r from app.ennco_project_active_records(target_project) where id::text=reference_id and kind=expected_kind;
  if not found then raise exception 'PROJECT_REFERENCE_INVALID:%',expected_kind using errcode='23514'; end if;
  return r;
end;
$$;
-- Una asignación es una revisión completa de distribución, nunca otro cobro.
-- Sólo participa la última revisión activa de cada pago confirmado y activo.
create function app.ennco_project_installment_paid(target_project uuid,target_contract uuid,target_schedule text,
  excluded_payment uuid default null,excluded_allocation uuid default null) returns numeric
language sql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
  select coalesce(sum(case when allocation.id is not null then
    coalesce((select sum((line->>'amountMxn')::numeric) from jsonb_array_elements(allocation.data->'allocations') line
      where line->>'scheduleId'=target_schedule),0)
    when payment.data->>'scheduleId'=target_schedule then (payment.data->>'amountMxn')::numeric else 0 end),0)
  from app.ennco_project_active_records(target_project) payment
  left join lateral (select a.id,a.data from app.ennco_project_active_records(target_project) a
    where a.kind='customer_payment_allocation' and a.data->>'paymentId'=payment.id::text
      and a.id is distinct from excluded_allocation order by a.project_version desc limit 1) allocation on true
  where payment.kind='customer_payment' and payment.data->'confirmed'='true'::jsonb
    and payment.data->>'contractId'=target_contract::text and payment.id is distinct from excluded_payment;
$$;
create function app.ennco_project_business_date(start_date date,days integer) returns date
language plpgsql immutable set search_path=pg_catalog,public,app,pg_temp as $$
declare result date:=start_date; count_days integer:=0;
begin
  -- Lunes-viernes y descansos obligatorios LFT 74. Jornadas electorales/extraordinarias requieren calendario validado.
  while count_days<days loop
    result:=result+1;
    if extract(isodow from result)<6
      and to_char(result,'MM-DD') not in ('01-01','05-01','09-16','12-25')
      and not (extract(isodow from result)=1 and ((extract(month from result)=2 and extract(day from result)<=7)
        or (extract(month from result) in (3,11) and extract(day from result) between 15 and 21)))
      and not (to_char(result,'MM-DD')='10-01' and mod(extract(year from result)::integer-2024,6)=0)
      then count_days:=count_days+1; end if;
  end loop;
  return result;
end;
$$;
create function app.ennco_project_effective_schedule(target_project uuid,target_contract uuid,excluded_revision uuid default null)
returns jsonb language sql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
  select coalesce((select r.data->'schedule' from app.ennco_project_active_records(target_project) r
    where r.kind='payment_schedule' and r.data->>'contractId'=target_contract::text and r.id is distinct from excluded_revision
    order by r.project_version desc limit 1),
    (select c.data->'schedule' from app.ennco_project_active_records(target_project) c where c.kind='contract' and c.id=target_contract),'[]'::jsonb);
$$;
create function app.ennco_project_validate_record(target_org uuid,target_project uuid,record_kind text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare areas text[]:=app.ennco_project_areas(target_org); allowed text[]; ref public.ennco_project_records;
  contract_row public.ennco_project_records; total numeric; prior_total numeric; expected numeric;
  advance numeric; last_paid timestamptz; line jsonb; source_line jsonb; active_count integer; next_data jsonb:=payload;
  incurred numeric; supplier_paid numeric; received_qty numeric; item_id text; schedule_value jsonb;
begin
  allowed:=case
    when record_kind in ('purchase_exception','change_approval','technical_review','source_review') then array['direction']
    when record_kind in ('contract','customer_invoice','customer_payment','customer_payment_allocation','payment_schedule','expense','supplier_payment','financial_closure','drive_setup') then array['direction','administration']
    when record_kind in ('supplier_quote','purchase_order','material_receipt') then array['direction','purchases']
    when record_kind='calculation' then array['direction','engineering']
    when record_kind='budget' then array['direction','administration']
    when record_kind in ('proposal','proposal_acceptance') then array['direction','sales']
    when record_kind in ('survey','progress','technical_closure') then array['direction','engineering','projects']
    when record_kind='change_order' then array['direction','engineering','projects','sales']
    when record_kind='receipt' then array['direction','administration','engineering','projects','sales']
    when record_kind in ('document','note') then array['direction','administration','purchases','engineering','projects','sales']
    when record_kind='reversal' then array['direction','administration']
    else array[]::text[] end;
  if not areas && allowed then raise exception 'PROJECT_FORBIDDEN_KIND:%',record_kind using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>1000000 then raise exception 'PROJECT_RECORD_INVALID' using errcode='22023'; end if;
  if record_kind in ('contract','budget','customer_payment','customer_payment_allocation','payment_schedule','customer_invoice','expense','supplier_payment','change_approval','purchase_order','financial_closure')
    and exists(select 1 from app.ennco_project_active_records(target_project) where kind='financial_closure') then
    raise exception 'PROJECT_FINANCIALLY_CLOSED' using errcode='23514';
  end if;
  if record_kind in ('receipt','survey','calculation','technical_review','progress')
    and exists(select 1 from app.ennco_project_active_records(target_project) where kind='technical_closure') then
    raise exception 'PROJECT_TECHNICALLY_CLOSED' using errcode='23514';
  end if;

  if record_kind in ('proposal','contract','customer_invoice','expense','purchase_order') then
    total:=app.ennco_project_money(payload,'totalMxn');
    if app.ennco_project_money(payload,'subtotalMxn',true)+app.ennco_project_money(payload,'vatMxn',true)<>total then
      raise exception 'PROJECT_TOTAL_MISMATCH' using errcode='23514';
    end if;
  end if;
  if record_kind in ('contract','customer_invoice','customer_payment','customer_payment_allocation','payment_schedule','expense','supplier_payment','purchase_order','material_receipt',
     'purchase_exception','progress','change_order','change_approval','technical_review','technical_closure','financial_closure','reversal') then
    perform app.ennco_project_evidence(payload);
  end if;
  if record_kind in ('customer_payment','supplier_payment') then
    if nullif(trim(payload->>'reference'),'') is null or nullif(trim(payload->>'method'),'') is null then
      raise exception 'PROJECT_PAYMENT_IDENTITY_REQUIRED' using errcode='22023';
    end if;
    if nullif(trim(payload->>'paidAt'),'') is null then raise exception 'PROJECT_PAID_AT_REQUIRED' using errcode='22023'; end if;
    perform (payload->>'paidAt')::timestamptz;
    if exists(select 1 from app.ennco_project_active_records(target_project) payment where payment.kind=record_kind
      and lower(trim(payment.data->>'reference'))=lower(trim(payload->>'reference'))
      and lower(trim(payment.data->>'method'))=lower(trim(payload->>'method'))
      and (payment.data->>'paidAt')::timestamptz=(payload->>'paidAt')::timestamptz) then
      raise exception 'PROJECT_PAYMENT_DUPLICATE' using errcode='23514';
    end if;
  end if;
  if record_kind='receipt' then
    if coalesce(jsonb_typeof(payload->'confirmed'),'null')<>'boolean' or jsonb_typeof(payload->'kWh')<>'number' or (payload->>'kWh')::numeric<0
      or (payload->>'periodEnd')::date<(payload->>'periodStart')::date then raise exception 'PROJECT_RECEIPT_INVALID' using errcode='22023'; end if;
  elsif record_kind='proposal' then
    if payload->>'pricingMethod' not in ('USD_PER_WATT','COST_PLUS_MARGIN') then raise exception 'PROJECT_PRICING_METHOD_INVALID' using errcode='22023'; end if;
    if payload->>'calculationId' is not null then perform app.ennco_project_reference(target_project,payload->>'calculationId','calculation'); end if;
  elsif record_kind='technical_review' then
    ref:=app.ennco_project_reference(target_project,payload->>'calculationId','calculation');
    if payload->>'decision' is null or payload->>'decision' not in ('APPROVED','REJECTED') then raise exception 'PROJECT_DECISION_INVALID' using errcode='22023'; end if;
    if payload->>'decision'='APPROVED' and (coalesce(jsonb_array_length(ref.data->'result'->'missingData'),0)>0
      or exists(select 1 from jsonb_array_elements(coalesce(ref.data->'result'->'warnings','[]'::jsonb)) w where w->>'severity'='BLOCKER')) then
      raise exception 'PROJECT_ENGINEERING_DATA_INCOMPLETE' using errcode='23514';
    end if;
  elsif record_kind='proposal_acceptance' then
    perform app.ennco_project_evidence(payload,'customerEvidence');
    ref:=app.ennco_project_reference(target_project,payload->>'proposalId','proposal');
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='contract') then raise exception 'PROJECT_USE_CHANGE_ORDER' using errcode='23514'; end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='proposal_acceptance' and data->>'proposalId'=ref.id::text) then
      raise exception 'PROJECT_PROPOSAL_ALREADY_ACCEPTED' using errcode='23514';
    end if;
    if ref.data->>'calculationId' is not null then
      if (select data->>'decision' from app.ennco_project_active_records(target_project)
        where kind='technical_review' and data->>'calculationId'=ref.data->>'calculationId' order by project_version desc limit 1) is distinct from 'APPROVED' then
        raise exception 'PROJECT_TECHNICAL_REVIEW_REQUIRED' using errcode='23514';
      end if;
    end if;
    next_data:=payload||jsonb_build_object('snapshot',ref.data,'proposalRevision',ref.project_version);
  elsif record_kind='budget' then
    if payload ? 'includedChangeOrderIds' then
      if jsonb_typeof(payload->'includedChangeOrderIds')<>'array' then raise exception 'PROJECT_BUDGET_CHANGE_INVALID' using errcode='22023'; end if;
      for item_id in select jsonb_array_elements_text(payload->'includedChangeOrderIds') loop
        perform app.ennco_project_reference(target_project,item_id,'change_order');
        if not exists(select 1 from app.ennco_project_active_records(target_project) where kind='change_approval' and data->>'changeOrderId'=item_id and data->>'decision'='APPROVED') then raise exception 'PROJECT_BUDGET_CHANGE_NOT_APPROVED' using errcode='23514'; end if;
      end loop;
    end if;
    if jsonb_typeof(payload->'lines')<>'array' or jsonb_array_length(payload->'lines')=0 then raise exception 'PROJECT_BUDGET_LINES_REQUIRED' using errcode='22023'; end if;
    for line in select * from jsonb_array_elements(payload->'lines') loop perform app.ennco_project_money(line,'amountMxn',true); end loop;
    if coalesce((payload->>'approved')::boolean,false) then perform app.ennco_project_require(target_org,array['direction']); end if;
  elsif record_kind='contract' then
    ref:=app.ennco_project_reference(target_project,payload->>'proposalId','proposal');
    if not exists(select 1 from app.ennco_project_active_records(target_project) where kind='proposal_acceptance' and data->>'proposalId'=ref.id::text) then
      raise exception 'PROJECT_ACCEPTED_PROPOSAL_REQUIRED' using errcode='23514';
    end if;
    if total<>(ref.data->>'totalMxn')::numeric or (payload->>'subtotalMxn')::numeric<>(ref.data->>'subtotalMxn')::numeric then
      raise exception 'PROJECT_CONTRACT_PROPOSAL_MISMATCH' using errcode='23514';
    end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='contract') then raise exception 'PROJECT_CONTRACT_EXISTS_USE_CHANGE_ORDER' using errcode='23514'; end if;
    advance:=app.ennco_project_money(payload,'advanceAmountMxn',true);
    if advance>total then raise exception 'PROJECT_ADVANCE_EXCEEDS_CONTRACT' using errcode='23514'; end if;
    if jsonb_typeof(payload->'schedule')<>'array' or jsonb_array_length(payload->'schedule')=0 then raise exception 'PROJECT_PAYMENT_SCHEDULE_REQUIRED' using errcode='22023'; end if;
    expected:=0;
    for line in select * from jsonb_array_elements(payload->'schedule') loop
      expected:=expected+app.ennco_project_money(line,'amountMxn');
      if nullif(line->>'id','') is null or nullif(line->>'dueDate','') is null then raise exception 'PROJECT_SCHEDULE_INVALID' using errcode='22023'; end if;
      perform (line->>'dueDate')::date;
    end loop;
    if expected<>total or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(payload->'schedule') x) then
      raise exception 'PROJECT_SCHEDULE_TOTAL_MISMATCH' using errcode='23514';
    end if;
    if payload->>'acceptanceId' is not null then
      ref:=app.ennco_project_reference(target_project,payload->>'acceptanceId','proposal_acceptance');
      if ref.data->>'proposalId'<>payload->>'proposalId' then raise exception 'PROJECT_ACCEPTANCE_MISMATCH' using errcode='23514'; end if;
    end if;
  elsif record_kind in ('customer_payment','customer_invoice') then
    contract_row:=app.ennco_project_reference(target_project,payload->>'contractId','contract');
    expected:=(contract_row.data->>'totalMxn')::numeric+coalesce((select sum((c.data->>'saleDeltaMxn')::numeric)
      from app.ennco_project_active_records(target_project) c where c.kind='change_order' and exists(select 1
       from app.ennco_project_active_records(target_project) a where a.kind='change_approval' and a.data->>'changeOrderId'=c.id::text and a.data->>'decision'='APPROVED')),0);
    if record_kind='customer_payment' then
      total:=app.ennco_project_money(payload,'amountMxn');
      if coalesce(jsonb_typeof(payload->'confirmed'),'null')<>'boolean' then raise exception 'PROJECT_PAYMENT_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
      perform (payload->>'paidAt')::timestamptz;
      if nullif(payload->>'paidAt','') is null then raise exception 'PROJECT_PAID_AT_REQUIRED' using errcode='22023'; end if;
      select coalesce(sum((data->>'amountMxn')::numeric),0) into prior_total from app.ennco_project_active_records(target_project) where kind='customer_payment' and data->'confirmed'='true'::jsonb;
      if (payload->'confirmed'='true'::jsonb and prior_total+total>expected) or total>expected then raise exception 'PROJECT_PAYMENT_EXCEEDS_CONTRACT' using errcode='23514'; end if;
      if payload->>'invoiceId' is not null then
        ref:=app.ennco_project_reference(target_project,payload->>'invoiceId','customer_invoice');
        if ref.data->>'contractId'<>contract_row.id::text then raise exception 'PROJECT_INVOICE_CONTRACT_MISMATCH' using errcode='23514'; end if;
        select coalesce(sum((data->>'amountMxn')::numeric),0) into prior_total from app.ennco_project_active_records(target_project)
          where kind='customer_payment' and data->'confirmed'='true'::jsonb and data->>'invoiceId'=ref.id::text;
        if payload->'confirmed'='true'::jsonb and prior_total+total>(ref.data->>'totalMxn')::numeric then raise exception 'PROJECT_PAYMENT_EXCEEDS_INVOICE' using errcode='23514'; end if;
      end if;
      if payload->>'scheduleId' is not null then
        select x into line from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) x where x->>'id'=payload->>'scheduleId';
        if not found then raise exception 'PROJECT_SCHEDULE_REFERENCE_INVALID' using errcode='23514'; end if;
        prior_total:=app.ennco_project_installment_paid(target_project,contract_row.id,payload->>'scheduleId');
        if payload->'confirmed'='true'::jsonb and total+prior_total>(line->>'amountMxn')::numeric then raise exception 'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT' using errcode='23514'; end if;
      end if;
    else
      select coalesce(sum((data->>'totalMxn')::numeric),0) into prior_total from app.ennco_project_active_records(target_project) where kind='customer_invoice';
      if prior_total+total>expected then raise exception 'PROJECT_INVOICE_EXCEEDS_CONTRACT' using errcode='23514'; end if;
      if exists(select 1 from app.ennco_project_active_records(target_project) where kind='customer_invoice' and data->>'number'=payload->>'number') then
        raise exception 'PROJECT_INVOICE_DUPLICATE' using errcode='23514';
      end if;
    end if;
  elsif record_kind='customer_payment_allocation' then
    perform app.ennco_project_evidence(payload,'reason');
    ref:=app.ennco_project_reference(target_project,payload->>'paymentId','customer_payment');
    if ref.data->'confirmed' is distinct from 'true'::jsonb then raise exception 'PROJECT_CONFIRMED_PAYMENT_REQUIRED' using errcode='23514'; end if;
    contract_row:=app.ennco_project_reference(target_project,ref.data->>'contractId','contract');
    if coalesce(jsonb_typeof(payload->'allocations'),'null')<>'array' or jsonb_array_length(payload->'allocations') not between 1 and 100 then
      raise exception 'PROJECT_PAYMENT_ALLOCATIONS_REQUIRED' using errcode='22023';
    end if;
    if (select count(*)<>count(distinct x->>'scheduleId') from jsonb_array_elements(payload->'allocations') x) then
      raise exception 'PROJECT_ALLOCATION_SCHEDULE_DUPLICATE' using errcode='23514';
    end if;
    total:=0;
    for line in select * from jsonb_array_elements(payload->'allocations') loop
      advance:=app.ennco_project_money(line,'amountMxn'); total:=total+advance;
      select s into source_line from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) s where s->>'id'=line->>'scheduleId';
      if not found then raise exception 'PROJECT_SCHEDULE_REFERENCE_INVALID' using errcode='23514'; end if;
      prior_total:=app.ennco_project_installment_paid(target_project,contract_row.id,line->>'scheduleId',ref.id);
      if prior_total+advance>(source_line->>'amountMxn')::numeric then raise exception 'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT' using errcode='23514'; end if;
    end loop;
    if total<>(ref.data->>'amountMxn')::numeric then raise exception 'PROJECT_ALLOCATION_TOTAL_MISMATCH' using errcode='23514'; end if;
  elsif record_kind='payment_schedule' then
    perform app.ennco_project_evidence(payload,'reason');
    contract_row:=app.ennco_project_reference(target_project,payload->>'contractId','contract');
    if coalesce(jsonb_typeof(payload->'schedule'),'null')<>'array' or jsonb_array_length(payload->'schedule') not between 1 and 100 then
      raise exception 'PROJECT_PAYMENT_SCHEDULE_REQUIRED' using errcode='22023';
    end if;
    if (select count(*)<>count(distinct s->>'id') from jsonb_array_elements(payload->'schedule') s) then
      raise exception 'PROJECT_SCHEDULE_TOTAL_MISMATCH' using errcode='23514';
    end if;
    total:=0;
    for line in select * from jsonb_array_elements(payload->'schedule') loop
      advance:=app.ennco_project_money(line,'amountMxn'); total:=total+advance;
      if nullif(trim(line->>'id'),'') is null or nullif(trim(line->>'dueDate'),'') is null then raise exception 'PROJECT_SCHEDULE_INVALID' using errcode='22023'; end if;
      perform (line->>'dueDate')::date;
      if app.ennco_project_installment_paid(target_project,contract_row.id,line->>'id')>advance then
        raise exception 'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT' using errcode='23514';
      end if;
    end loop;
    for line in select * from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) loop
      if app.ennco_project_installment_paid(target_project,contract_row.id,line->>'id')>0
        and not exists(select 1 from jsonb_array_elements(payload->'schedule') s where s->>'id'=line->>'id') then
        raise exception 'PROJECT_PAID_INSTALLMENT_REMOVAL' using errcode='23514';
      end if;
    end loop;
    expected:=(contract_row.data->>'totalMxn')::numeric+coalesce((select sum((c.data->>'saleDeltaMxn')::numeric)
      from app.ennco_project_active_records(target_project) c where c.kind='change_order' and exists(select 1
        from app.ennco_project_active_records(target_project) a where a.kind='change_approval' and a.data->>'changeOrderId'=c.id::text and a.data->>'decision'='APPROVED')),0);
    if total<>expected then raise exception 'PROJECT_SCHEDULE_TOTAL_MISMATCH' using errcode='23514'; end if;
  elsif record_kind='purchase_order' then
    select * into contract_row from app.ennco_project_active_records(target_project) where kind='contract' order by project_version desc limit 1;
    if contract_row.id is null and not exists(select 1 from app.ennco_project_active_records(target_project) where kind='purchase_exception') then raise exception 'PROJECT_ADVANCE_REQUIRED' using errcode='23514'; end if;
    select coalesce(sum((data->>'amountMxn')::numeric),0),max(created_at) into prior_total,last_paid
      from app.ennco_project_active_records(target_project) where kind='customer_payment' and data->'confirmed'='true'::jsonb;
    if prior_total<(contract_row.data->>'advanceAmountMxn')::numeric and not exists(select 1 from app.ennco_project_active_records(target_project) where kind='purchase_exception') then
      raise exception 'PROJECT_ADVANCE_REQUIRED' using errcode='23514';
    end if;
    if payload->>'quoteId' is not null then perform app.ennco_project_reference(target_project,payload->>'quoteId','supplier_quote'); end if;
    if jsonb_typeof(payload->'lines')<>'array' or jsonb_array_length(payload->'lines')=0 then raise exception 'PROJECT_ORDER_LINES_REQUIRED' using errcode='22023'; end if;
    expected:=0;
    for line in select * from jsonb_array_elements(payload->'lines') loop
      if nullif(line->>'id','') is null or jsonb_typeof(line->'quantity')<>'number' or (line->>'quantity')::numeric<=0 then raise exception 'PROJECT_ORDER_LINE_INVALID' using errcode='22023'; end if;
      expected:=expected+round((line->>'quantity')::numeric*app.ennco_project_money(line,'unitCostMxn',true),2);
    end loop;
    if expected<>(payload->>'subtotalMxn')::numeric or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(payload->'lines') x) then
      raise exception 'PROJECT_ORDER_TOTAL_MISMATCH' using errcode='23514';
    end if;
    select min(confirmed_at) into last_paid from (select created_at as confirmed_at,sum((data->>'amountMxn')::numeric) over(order by project_version) as cumulative
      from app.ennco_project_active_records(target_project) where kind='customer_payment' and data->'confirmed'='true'::jsonb) payments
      where cumulative>=(contract_row.data->>'advanceAmountMxn')::numeric;
    if (contract_row.data->>'advanceAmountMxn')::numeric=0 then last_paid:=contract_row.created_at; end if;
    next_data:=payload||jsonb_build_object('purchaseDueDate',case when last_paid is null then null else app.ennco_project_business_date((last_paid at time zone 'America/Mexico_City')::date,5) end);
  elsif record_kind='material_receipt' then
    ref:=app.ennco_project_reference(target_project,payload->>'purchaseOrderId','purchase_order');
    if jsonb_typeof(payload->'lines')<>'array' or jsonb_array_length(payload->'lines')=0 then raise exception 'PROJECT_RECEIPT_LINES_REQUIRED' using errcode='22023'; end if;
    if (select count(*)<>count(distinct x->>'lineId') from jsonb_array_elements(payload->'lines') x) then raise exception 'PROJECT_DUPLICATE_RECEIPT_LINE' using errcode='23514'; end if;
    for line in select * from jsonb_array_elements(payload->'lines') loop
      select x into source_line from jsonb_array_elements(ref.data->'lines') x where x->>'id'=line->>'lineId';
      if not found or jsonb_typeof(line->'quantity')<>'number' or (line->>'quantity')::numeric<=0 then raise exception 'PROJECT_RECEIPT_LINE_INVALID' using errcode='22023'; end if;
      select coalesce(sum((x->>'quantity')::numeric),0) into received_qty from app.ennco_project_active_records(target_project) r,
        lateral jsonb_array_elements(r.data->'lines') x where r.kind='material_receipt' and r.data->>'purchaseOrderId'=ref.id::text and x->>'lineId'=line->>'lineId';
      if received_qty+(line->>'quantity')::numeric>(source_line->>'quantity')::numeric then raise exception 'PROJECT_RECEIPT_EXCEEDS_ORDER' using errcode='23514'; end if;
    end loop;
  elsif record_kind='expense' then
    perform app.ennco_project_money(payload,'costBasisMxn',true);
    if ((payload->>'costBasisMxn')::numeric>total or (payload->>'costBasisMxn')::numeric<(payload->>'subtotalMxn')::numeric) then raise exception 'PROJECT_COST_BASIS_INVALID' using errcode='23514'; end if;
    if payload->>'purchaseOrderId' is not null then perform app.ennco_project_reference(target_project,payload->>'purchaseOrderId','purchase_order'); end if;
    if nullif(payload->>'invoiceNumber','') is null then raise exception 'PROJECT_EXPENSE_NUMBER_REQUIRED' using errcode='22023'; end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='expense' and lower(data->>'supplier')=lower(payload->>'supplier')
      and data->>'invoiceNumber'=payload->>'invoiceNumber') then raise exception 'PROJECT_EXPENSE_DUPLICATE' using errcode='23514'; end if;
  elsif record_kind='supplier_payment' then
    ref:=app.ennco_project_reference(target_project,payload->>'expenseId','expense');
    total:=app.ennco_project_money(payload,'amountMxn');
    select coalesce(sum((data->>'amountMxn')::numeric),0) into prior_total from app.ennco_project_active_records(target_project) where kind='supplier_payment' and data->>'expenseId'=ref.id::text;
    if total+prior_total>(ref.data->>'totalMxn')::numeric then raise exception 'PROJECT_PAYMENT_EXCEEDS_EXPENSE' using errcode='23514'; end if;
  elsif record_kind='progress' then
    if coalesce(jsonb_typeof(payload->'percent'),'null')<>'number' or (payload->>'percent')::numeric not between 0 and 100 then raise exception 'PROJECT_PROGRESS_INVALID' using errcode='22023'; end if;
  elsif record_kind='change_order' then
    for item_id in select unnest(array['saleDeltaMxn','costDeltaMxn','saleVatDeltaMxn']) loop
      if coalesce(jsonb_typeof(coalesce(payload->item_id,case when item_id='saleVatDeltaMxn' then '0'::jsonb end)),'null')<>'number' then raise exception 'PROJECT_CHANGE_AMOUNTS_REQUIRED' using errcode='22023'; end if;
      total:=coalesce((payload->>item_id)::numeric,0);
      if abs(total)>1000000000000 or total<>round(total,2) then raise exception 'PROJECT_AMOUNT_INVALID' using errcode='22023'; end if;
    end loop;
    if abs(coalesce((payload->>'saleVatDeltaMxn')::numeric,0))>abs((payload->>'saleDeltaMxn')::numeric)
      or coalesce((payload->>'saleVatDeltaMxn')::numeric,0)*(payload->>'saleDeltaMxn')::numeric<0 then
      raise exception 'PROJECT_CHANGE_VAT_INVALID' using errcode='22023';
    end if;
  elsif record_kind='change_approval' then
    ref:=app.ennco_project_reference(target_project,payload->>'changeOrderId','change_order');
    if payload->>'decision' is null or payload->>'decision' not in ('APPROVED','REJECTED') then raise exception 'PROJECT_DECISION_INVALID' using errcode='22023'; end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='change_approval' and data->>'changeOrderId'=ref.id::text) then
      raise exception 'PROJECT_CHANGE_ALREADY_DECIDED' using errcode='23514'; end if;
    if payload->>'decision'='APPROVED' then
      select * into contract_row from app.ennco_project_active_records(target_project) where kind='contract' order by project_version desc limit 1;
      if contract_row.id is null then raise exception 'PROJECT_CONTRACT_REQUIRED' using errcode='23514'; end if;
      expected:=(contract_row.data->>'totalMxn')::numeric+(ref.data->>'saleDeltaMxn')::numeric+coalesce((select sum((c.data->>'saleDeltaMxn')::numeric)
        from app.ennco_project_active_records(target_project) c where c.kind='change_order' and exists(select 1 from app.ennco_project_active_records(target_project) a
          where a.kind='change_approval' and a.data->>'changeOrderId'=c.id::text and a.data->>'decision'='APPROVED')),0);
      select coalesce(sum((data->>'amountMxn')::numeric),0) into prior_total from app.ennco_project_active_records(target_project) where kind='customer_payment' and data->'confirmed'='true'::jsonb;
      select coalesce(sum((data->>'totalMxn')::numeric),0) into total from app.ennco_project_active_records(target_project) where kind='customer_invoice';
      if expected<0 or expected<prior_total or expected<total then raise exception 'PROJECT_CHANGE_REQUIRES_PAYMENT_INVOICE_ADJUSTMENT' using errcode='23514'; end if;
    end if;
  elsif record_kind='drive_setup' then
    if payload->>'ownerEmail' is distinct from 'contacto@ennco.com.mx' or nullif(payload->>'folderId','') is null
      or nullif(payload->>'rootId','') is null or coalesce(jsonb_typeof(payload->'sections'),'null')<>'object' then
      raise exception 'PROJECT_DRIVE_SETUP_INVALID' using errcode='22023';
    end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='drive_setup') then
      raise exception 'PROJECT_DRIVE_ALREADY_RESERVED' using errcode='23514';
    end if;
  elsif record_kind='document' then
    if payload->>'visibility' not in ('TEAM','ADMIN','PURCHASES') or payload->>'status' not in ('PENDING','SYNCED','ERROR') then raise exception 'PROJECT_DOCUMENT_INVALID' using errcode='22023'; end if;
    if payload->>'visibility'='ADMIN' then perform app.ennco_project_require(target_org,array['direction','administration']); end if;
    if payload->>'visibility'='PURCHASES' then perform app.ennco_project_require(target_org,array['direction','administration','purchases']); end if;
    if payload->>'status'='SYNCED' and nullif(payload->>'driveFileId','') is null then raise exception 'PROJECT_DRIVE_FILE_REQUIRED' using errcode='22023'; end if;
  elsif record_kind='technical_closure' then
    if jsonb_typeof(payload->'checks')<>'object' or (select count(*) from jsonb_object_keys(payload->'checks'))<3
      or exists(select 1 from jsonb_each(payload->'checks') where value<>'true'::jsonb) then raise exception 'PROJECT_TECHNICAL_CHECKS_REQUIRED' using errcode='23514'; end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where kind='technical_closure') then raise exception 'PROJECT_ALREADY_TECHNICALLY_CLOSED' using errcode='23514'; end if;
  elsif record_kind='financial_closure' then
    select * into contract_row from app.ennco_project_active_records(target_project) where kind='contract' order by project_version desc limit 1;
    if contract_row.id is null then raise exception 'PROJECT_CONTRACT_REQUIRED' using errcode='23514'; end if;
    expected:=(contract_row.data->>'totalMxn')::numeric+coalesce((select sum((c.data->>'saleDeltaMxn')::numeric) from app.ennco_project_active_records(target_project) c
      where c.kind='change_order' and exists(select 1 from app.ennco_project_active_records(target_project) a where a.kind='change_approval' and a.data->>'changeOrderId'=c.id::text and a.data->>'decision'='APPROVED')),0);
    select coalesce(sum((data->>'amountMxn')::numeric),0) into prior_total from app.ennco_project_active_records(target_project) where kind='customer_payment' and data->'confirmed'='true'::jsonb;
    select coalesce(sum((data->>'totalMxn')::numeric),0) into total from app.ennco_project_active_records(target_project) where kind='customer_invoice';
    select coalesce(sum((data->>'totalMxn')::numeric),0) into incurred from app.ennco_project_active_records(target_project) where kind='expense';
    select coalesce(sum((data->>'amountMxn')::numeric),0) into supplier_paid from app.ennco_project_active_records(target_project) where kind='supplier_payment';
    select count(*) into active_count from app.ennco_project_active_records(target_project) o where o.kind='purchase_order'
      and (select coalesce(sum((e.data->>'subtotalMxn')::numeric),0) from app.ennco_project_active_records(target_project) e where e.kind='expense' and e.data->>'purchaseOrderId'=o.id::text)<(o.data->>'subtotalMxn')::numeric;
    select coalesce(sum(app.ennco_project_installment_paid(target_project,contract_row.id,s->>'id')),0),coalesce(sum((s->>'amountMxn')::numeric),0)
      into advance,received_qty from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) s;
    if expected<>prior_total or expected<>total or incurred<>supplier_paid or active_count>0 or advance<>prior_total or received_qty<>expected then
      perform app.ennco_project_require(target_org,array['direction']);
      perform app.ennco_project_evidence(payload,'exceptionReason');
    end if;
  elsif record_kind='reversal' then
    perform app.ennco_project_evidence(payload,'reason');
    select * into ref from app.ennco_project_active_records(target_project) where id::text=payload->>'recordId';
    if not found then raise exception 'PROJECT_REVERSAL_REFERENCE_INVALID' using errcode='23514'; end if;
    if ref.kind in ('technical_review','proposal_acceptance','change_approval','purchase_exception','budget') then perform app.ennco_project_require(target_org,array['direction']); end if;
    if exists(select 1 from app.ennco_project_active_records(target_project) where
      id<>ref.id and (data->>'proposalId'=ref.id::text or data->>'acceptanceId'=ref.id::text or data->>'contractId'=ref.id::text
        or data->>'expenseId'=ref.id::text or data->>'purchaseOrderId'=ref.id::text or data->>'invoiceId'=ref.id::text
        or data->>'changeOrderId'=ref.id::text or data->>'calculationId'=ref.id::text)) then
      raise exception 'PROJECT_REVERSAL_HAS_DEPENDENCIES' using errcode='23514';
    end if;
    if ref.kind in ('contract','budget','customer_payment','customer_payment_allocation','payment_schedule','customer_invoice','expense','supplier_payment','change_approval','purchase_order')
      and exists(select 1 from app.ennco_project_active_records(target_project) where kind='financial_closure') then
      raise exception 'PROJECT_FINANCIALLY_CLOSED' using errcode='23514';
    end if;
    -- Revertir una distribución hace vigente la revisión anterior (o la original).
    -- No puede sobreasignar una parcialidad que otros cobros ya consumieron.
    if ref.kind='customer_payment_allocation' then
      select * into contract_row from app.ennco_project_active_records(target_project) c where c.kind='contract'
        and c.id::text=(select payment.data->>'contractId' from app.ennco_project_active_records(target_project) payment
          where payment.kind='customer_payment' and payment.id::text=ref.data->>'paymentId');
      if contract_row.id is not null then
        select a.data into schedule_value from app.ennco_project_active_records(target_project) a
          where a.kind='customer_payment_allocation' and a.data->>'paymentId'=ref.data->>'paymentId' and a.id<>ref.id
          order by a.project_version desc limit 1;
        if not found then
          select jsonb_build_object('allocations',case when payment.data->>'scheduleId' is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('scheduleId',payment.data->>'scheduleId')) end)
          into schedule_value from app.ennco_project_active_records(target_project) payment
          where payment.kind='customer_payment' and payment.id::text=ref.data->>'paymentId';
        end if;
        for line in select * from jsonb_array_elements(schedule_value->'allocations') loop
          if not exists(select 1 from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) s
            where s->>'id'=line->>'scheduleId') then raise exception 'PROJECT_SCHEDULE_REFERENCE_INVALID' using errcode='23514'; end if;
        end loop;
        for line in select * from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) loop
          if app.ennco_project_installment_paid(target_project,contract_row.id,line->>'id',null,ref.id)>(line->>'amountMxn')::numeric then
            raise exception 'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT' using errcode='23514';
          end if;
        end loop;
      end if;
    end if;
    if ref.kind='payment_schedule' then
      contract_row:=app.ennco_project_reference(target_project,ref.data->>'contractId','contract');
      schedule_value:=app.ennco_project_effective_schedule(target_project,contract_row.id,ref.id);
      for line in select * from jsonb_array_elements(app.ennco_project_effective_schedule(target_project,contract_row.id)) loop
        prior_total:=app.ennco_project_installment_paid(target_project,contract_row.id,line->>'id');
        select s into source_line from jsonb_array_elements(schedule_value) s where s->>'id'=line->>'id';
        if prior_total>0 and not found then raise exception 'PROJECT_PAID_INSTALLMENT_REMOVAL' using errcode='23514'; end if;
        if prior_total>coalesce((source_line->>'amountMxn')::numeric,0) then raise exception 'PROJECT_PAYMENT_EXCEEDS_INSTALLMENT' using errcode='23514'; end if;
      end loop;
    end if;
    if ref.kind in ('receipt','survey','calculation','technical_review','progress')
      and exists(select 1 from app.ennco_project_active_records(target_project) where kind='technical_closure') then
      raise exception 'PROJECT_TECHNICALLY_CLOSED' using errcode='23514';
    end if;
  end if;
  return next_data;
end;
$$;

create function public.ennco_projects_append(target_organization_id uuid,target_project_id uuid,expected_version integer,
  record_kind text,payload jsonb,idempotency_key text,server_attestation text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare previous jsonb; p public.ennco_projects; r public.ennco_project_records; safe_payload jsonb;
begin
  perform app.ennco_project_require(target_organization_id,array['direction','administration','purchases','engineering','projects','sales']);
  previous:=app.ennco_project_command_begin(target_organization_id,idempotency_key,
    jsonb_build_object('action','append','projectId',target_project_id,'expectedVersion',expected_version,'kind',record_kind,'data',payload));
  select * into p from public.ennco_projects where id=target_project_id and organization_id=target_organization_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode='P0002'; end if;
  if record_kind in ('calculation','proposal','supplier_quote','document','drive_setup') and
    (server_attestation is null or server_attestation is distinct from app.ennco_project_attestation(
      target_organization_id,auth.uid(),target_project_id,expected_version,record_kind,payload,idempotency_key)) then
    raise exception 'PROJECT_SERVER_ATTESTATION_REQUIRED' using errcode='42501';
  end if;
  if previous is not null then return previous; end if;
  if expected_version is null or p.version<>expected_version then raise exception 'PROJECT_VERSION_CONFLICT' using errcode='40001'; end if;
  safe_payload:=app.ennco_project_validate_record(target_organization_id,target_project_id,record_kind,payload);
  insert into public.ennco_project_records(organization_id,project_id,kind,data,actor_id,project_version)
  values(target_organization_id,target_project_id,record_kind,safe_payload,auth.uid(),p.version+1) returning * into r;
  update public.ennco_projects set version=version+1,updated_at=now(),
    stage=case when stage='CLOSED' and record_kind='reversal' then
      case (select kind from public.ennco_project_records where project_id=target_project_id and id::text=payload->>'recordId')
        when 'financial_closure' then 'COLLECTION' when 'technical_closure' then 'ENGINEERING' else stage end
      else stage end
    where id=target_project_id returning * into p;
  if record_kind='document' then
    insert into public.ennco_project_documents(organization_id,project_id,record_id,section,drive_file_id,status,sha256)
    values(target_organization_id,target_project_id,r.id,coalesce(safe_payload->>'section','Información del cliente'),safe_payload->>'driveFileId',
      case safe_payload->>'status' when 'SYNCED' then 'READY' when 'ERROR' then 'FAILED' else 'PENDING' end,safe_payload->>'sha256');
  end if;
  insert into app.ennco_project_audit(organization_id,project_id,actor_id,action,version,record_id)
  values(target_organization_id,p.id,auth.uid(),record_kind,p.version,r.id);
  return app.ennco_project_command_finish(target_organization_id,idempotency_key,jsonb_build_object('projectId',p.id,'version',p.version,'recordId',r.id));
end;
$$;
create function public.ennco_projects_update(target_organization_id uuid,target_project_id uuid,expected_version integer,
  patch jsonb,idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare previous jsonb; p public.ennco_projects; customer_value jsonb; data_value jsonb; nullable_key text;
begin
  perform app.ennco_project_require(target_organization_id,array['direction','administration','engineering','projects','sales']);
  previous:=app.ennco_project_command_begin(target_organization_id,idempotency_key,
    jsonb_build_object('action','update','projectId',target_project_id,'expectedVersion',expected_version,'patch',patch));
  if previous is not null then return previous; end if;
  select * into p from public.ennco_projects where id=target_project_id and organization_id=target_organization_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode='P0002'; end if;
  if expected_version is null or p.version<>expected_version then raise exception 'PROJECT_VERSION_CONFLICT' using errcode='40001'; end if;
  if patch is null or jsonb_typeof(patch)<>'object' then raise exception 'PROJECT_INPUT_INVALID' using errcode='22023'; end if;
  if patch->>'stage'='CLOSED' and (not exists(select 1 from app.ennco_project_active_records(p.id) where kind='technical_closure')
    or not exists(select 1 from app.ennco_project_active_records(p.id) where kind='financial_closure')) then raise exception 'PROJECT_CLOSURES_REQUIRED' using errcode='23514'; end if;
  customer_value:=p.customer||jsonb_strip_nulls(jsonb_build_object('name',patch->>'customerName','contactName',patch->>'contactName',
    'email',patch->>'email','phone',patch->>'phone','location',patch->>'location','scope',patch->>'scope'));
  data_value:=p.data||jsonb_strip_nulls(jsonb_build_object('accountId',patch->'data'->>'accountId','opportunityId',patch->'data'->>'opportunityId',
    'ownerName',patch->'data'->>'ownerName','latitude',patch->'data'->'latitude','longitude',patch->'data'->'longitude','dueDate',patch->'data'->>'dueDate'));
  foreach nullable_key in array array['accountId','opportunityId','dueDate','latitude','longitude'] loop
    if patch->'data'->nullable_key='null'::jsonb then data_value:=data_value-nullable_key; end if;
  end loop;
  perform app.ennco_project_validate_links(target_organization_id,data_value);
  update public.ennco_projects set name=coalesce(patch->>'name',name),customer=customer_value,data=data_value,
    stage=coalesce(patch->>'stage',stage),lifecycle=coalesce(patch->>'lifecycle',lifecycle),version=version+1,updated_at=now()
    where id=p.id returning * into p;
  insert into app.ennco_project_audit(organization_id,project_id,actor_id,action,version)
  values(target_organization_id,p.id,auth.uid(),'updated',p.version);
  return app.ennco_project_command_finish(target_organization_id,idempotency_key,jsonb_build_object('projectId',p.id,'version',p.version));
end;
$$;
create function public.ennco_projects_catalog_list(target_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare access_value jsonb:=public.ennco_projects_permissions(target_organization_id);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'category',category,'name',name,'version',version,
    'data',app.ennco_project_redact(data,(access_value->>'canReadCosts')::boolean,(access_value->>'canReadMargins')::boolean),
    'sourceUrl',coalesce(source_url,''),'sourceDate',source_date,'status',status,'createdAt',created_at) order by category,name,version desc)
    from public.ennco_project_catalogs where organization_id=target_organization_id
      and ((access_value->>'canReadCosts')::boolean or category not in ('prices','pricing','commercial','supplier_prices'))),'[]'::jsonb);
end;
$$;
create function public.ennco_projects_catalog_save(target_organization_id uuid,input jsonb,idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare previous jsonb; r public.ennco_project_catalogs; next_version integer;
begin
  perform app.ennco_project_require(target_organization_id,case when input->>'category'='drive_root' then array['direction','administration'] else array['direction','engineering','purchases'] end);
  if input->>'status'='APPROVED' then perform app.ennco_project_require(target_organization_id,array['direction']); end if;
  if input->>'category' in ('prices','pricing','commercial','supplier_prices') then perform app.ennco_project_require(target_organization_id,array['direction','administration','purchases']); end if;
  previous:=app.ennco_project_command_begin(target_organization_id,idempotency_key,jsonb_build_object('action','catalog_save','input',input));
  if previous is not null then return previous; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||'catalog'||(input->>'category')||(input->>'name'),0));
  select coalesce(max(version),0)+1 into next_version from public.ennco_project_catalogs
    where organization_id=target_organization_id and category=input->>'category' and name=input->>'name';
  if input->>'version' is not null and (input->>'version')::integer<>next_version then raise exception 'PROJECT_CATALOG_VERSION_CONFLICT' using errcode='40001'; end if;
  insert into public.ennco_project_catalogs(organization_id,category,name,version,data,source_url,source_date,status,created_by)
  values(target_organization_id,input->>'category',input->>'name',next_version,input->'data',input->>'sourceUrl',
    (input->>'sourceDate')::date,coalesce(input->>'status','DRAFT'),auth.uid()) returning * into r;
  insert into app.ennco_project_audit(organization_id,actor_id,action,version,record_id)
  values(target_organization_id,auth.uid(),'catalog_saved',r.version,r.id);
  return app.ennco_project_command_finish(target_organization_id,idempotency_key,jsonb_build_object('catalogId',r.id,'version',r.version));
end;
$$;
create function public.ennco_projects_member_list(target_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
begin
  perform app.ennco_project_require(target_organization_id,array['direction']);
  return coalesce((select jsonb_agg(jsonb_build_object('userId',ou.user_id,'email',coalesce(u.email,''),
    'displayName',coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',''),
    'role',ou.role,'areas',case when ou.role='ennco_admin' then array['direction','administration','purchases','engineering','projects','sales']
      when ou.role='auditor_readonly' then array[]::text[] else coalesce((select array_agg(m.area order by m.area)
        from public.ennco_project_members m where m.organization_id=ou.organization_id and m.user_id=ou.user_id),array[]::text[]) end)
      order by coalesce(u.email,''),ou.user_id)
    from public.organization_users ou left join auth.users u on u.id=ou.user_id
    where ou.organization_id=target_organization_id and ou.active),'[]'::jsonb);
end;
$$;
create function public.ennco_projects_member_set(target_organization_id uuid,target_user_id uuid,areas text[],idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare previous jsonb; area_value text;
begin
  perform app.ennco_project_require(target_organization_id,array['direction']);
  previous:=app.ennco_project_command_begin(target_organization_id,idempotency_key,
    jsonb_build_object('action','member_set','userId',target_user_id,'areas',areas));
  if previous is not null then return previous; end if;
  if areas is null or not areas<@array['direction','administration','purchases','engineering','projects','sales'] then raise exception 'PROJECT_AREA_INVALID' using errcode='22023'; end if;
  if not exists(select 1 from public.organization_users where organization_id=target_organization_id and user_id=target_user_id and active and role<>'auditor_readonly') then
    raise exception 'PROJECT_ACTIVE_MEMBER_REQUIRED' using errcode='23514'; end if;
  delete from public.ennco_project_members where organization_id=target_organization_id and user_id=target_user_id;
  foreach area_value in array areas loop
    insert into public.ennco_project_members(organization_id,user_id,area,granted_by) values(target_organization_id,target_user_id,area_value,auth.uid()) on conflict do nothing;
  end loop;
  insert into app.ennco_project_audit(organization_id,actor_id,action,record_id) values(target_organization_id,auth.uid(),'member_areas_set',target_user_id);
  return app.ennco_project_command_finish(target_organization_id,idempotency_key,jsonb_build_object('userId',target_user_id,'areas',areas));
end;
$$;

-- Acceso a staging privado. La clasificación vive en la ruta para impedir un
-- bypass de la autorización de documentos por Storage antes de sincronizar Drive.
create function app.ennco_project_storage_access(object_name text,writing boolean) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public,app,pg_temp as $$
declare parts text[]:=string_to_array(object_name,'/'); target_org uuid; target_project uuid; areas text[]; access_value jsonb;
begin
  if cardinality(parts)<>4 or parts[3] not in ('TEAM','ADMIN','PURCHASES') then return false; end if;
  begin target_org:=parts[1]::uuid; target_project:=parts[2]::uuid; exception when invalid_text_representation then return false; end;
  if not app.is_member(target_org) then return false; end if;
  if not exists(select 1 from public.ennco_projects where organization_id=target_org and id=target_project) then return false; end if;
  areas:=app.ennco_project_areas(target_org);
  access_value:=public.ennco_projects_permissions(target_org);
  if writing and cardinality(areas)=0 then return false; end if;
  if parts[3]='TEAM' then return true; end if;
  if parts[3]='ADMIN' then return (not writing and (access_value->>'canReadMargins')::boolean) or areas && array['direction','administration']; end if;
  return (not writing and (access_value->>'canReadCosts')::boolean) or areas && array['direction','administration','purchases'];
end;
$$;

-- Nuevas tablas cerradas por defecto incluso ante futuros GRANT globales.
alter table public.ennco_projects enable row level security;
alter table public.ennco_project_members enable row level security;
alter table public.ennco_project_records enable row level security;
alter table public.ennco_project_documents enable row level security;
alter table public.ennco_project_catalogs enable row level security;
alter table app.ennco_project_counters enable row level security;
alter table app.ennco_project_commands enable row level security;
alter table app.ennco_project_audit enable row level security;
alter table app.ennco_project_signing_secret enable row level security;
revoke all on public.ennco_projects,public.ennco_project_members,public.ennco_project_records,public.ennco_project_documents,public.ennco_project_catalogs from public,anon,authenticated,service_role;
revoke all on app.ennco_project_counters,app.ennco_project_commands,app.ennco_project_audit,app.ennco_project_signing_secret from public,anon,authenticated,service_role;

-- Sólo estos entrypoints se exponen a sesiones autenticadas. Los helpers internos
-- no pueden utilizarse para leer otra organización ni para saltar controles.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app' and p.proname like 'ennco_project_%') or (n.nspname='public' and p.proname like 'ennco_projects_%') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    if r.nspname='public' then
      execute format('grant execute on function %s to %I',r.signature,case when r.proname='ennco_projects_attest' then 'service_role' else 'authenticated' end);
    end if;
  end loop;
end;
$$;
grant execute on function app.ennco_project_storage_access(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ennco-project-documents','ennco-project-documents',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;
create policy ennco_project_documents_read on storage.objects for select to authenticated
using(bucket_id='ennco-project-documents' and app.ennco_project_storage_access(name,false));
create policy ennco_project_documents_insert on storage.objects for insert to authenticated
with check(bucket_id='ennco-project-documents' and app.ennco_project_storage_access(name,true));

comment on table public.ennco_project_records is 'Bitácora inmutable; las correcciones usan reversal; no atribuye leads ni comisiones.';
comment on function public.ennco_projects_append(uuid,uuid,integer,text,jsonb,text,text) is 'Autoriza sesión, verifica firma de datos derivados, serializa proyecto, verifica versión y reglas y registra auditoría atómicamente.';
commit;
