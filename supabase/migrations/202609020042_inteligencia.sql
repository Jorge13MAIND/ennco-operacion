begin;

-- M042 capa de inteligencia: puntuación ICP y sugerencia de clasificación.
--
-- Traduce tres patrones del motor Atlas (agente 05 ICP scoring, agente 03
-- reply classifier, agentes 11/12 morning brief y EOD) al stack de ENNCO.
-- Atlas los resuelve con agentes LLM que llaman herramientas; aquí la lógica
-- es determinista y vive en src/lib/inteligencia/, con pruebas unitarias. La
-- base sólo persiste el resultado y hace cumplir las invariantes.
--
-- La invariante que más importa: una sugerencia NUNCA es una clasificación.
-- provider_events.reply_classification sigue siendo la única verdad y sólo la
-- mueve review_reply_and_route con un humano detrás. Esta migración no toca esa
-- columna ni concede permiso para hacerlo, porque marcar POSITIVE crea un lead,
-- una tarea y un caso SLA P1 cuyo vencimiento congela todo el outbound.

-- ---------------------------------------------------------------------------
-- A. Puntuación ICP por cuenta
-- ---------------------------------------------------------------------------
create table if not exists public.account_icp_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  band text not null check (band in ('A','B','C','D','FUERA_DE_CONTRATO')),
  rubric_version text not null check (rubric_version ~ '^icp-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  factors_json jsonb not null default '[]'::jsonb,
  missing_signals text[] not null default '{}',
  -- Estado que el contrato incluye pero investigación todavía no acepta
  -- (Jalisco y Michoacán). Se puntúa igual para que el mercado sin explotar
  -- sea visible en vez de desaparecer en silencio.
  contract_only_state boolean not null default false,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, account_id, rubric_version)
  -- Sin llave foránea compuesta: public.accounts no expone un índice único
  -- sobre (organization_id, id), así que el aislamiento por tenant se hace
  -- donde sí es verificable, en el join de upsert_account_icp_scores.
);
create index if not exists account_icp_scores_priority_idx
  on public.account_icp_scores (organization_id, score desc, computed_at desc);

-- ---------------------------------------------------------------------------
-- B. Sugerencia de clasificación (propuesta, jamás decisión)
-- ---------------------------------------------------------------------------
create table if not exists public.reply_classification_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_event_id uuid not null references public.provider_events(id) on delete cascade,
  suggested_intent text not null check (suggested_intent in (
    'POSITIVE','REFERRAL','NOT_NOW','WHAT_IS_THIS','PRICE_OBJECTION',
    'CHEAPER_VENDOR','INTERNAL_ALIGNMENT','COMMERCIAL_COMMITMENT','UNSUBSCRIBE')),
  suggested_classification text not null check (suggested_classification in ('POSITIVE','NEUTRAL','NEGATIVE')),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  signals_json jsonb not null default '[]'::jsonb,
  needs_human_now boolean not null default false,
  classifier_version text not null check (classifier_version ~ '^clasificador-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, provider_event_id, classifier_version)
);
create index if not exists reply_suggestions_pending_idx
  on public.reply_classification_suggestions (organization_id, needs_human_now, created_at desc);

alter table public.account_icp_scores enable row level security;
alter table public.account_icp_scores force row level security;
alter table public.reply_classification_suggestions enable row level security;
alter table public.reply_classification_suggestions force row level security;
revoke all on table public.account_icp_scores, public.reply_classification_suggestions
  from public, anon, authenticated, service_role;

drop policy if exists account_icp_scores_member_read on public.account_icp_scores;
create policy account_icp_scores_member_read on public.account_icp_scores
  for select using (app.is_member(organization_id));
grant select on table public.account_icp_scores to authenticated;

drop policy if exists reply_suggestions_member_read on public.reply_classification_suggestions;
create policy reply_suggestions_member_read on public.reply_classification_suggestions
  for select using (app.is_member(organization_id));
grant select on table public.reply_classification_suggestions to authenticated;

-- ---------------------------------------------------------------------------
-- C. Helper de autorización
-- ---------------------------------------------------------------------------
create or replace function app.intelligence_assert_operator(target_organization_id uuid)
returns uuid language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not app.has_role(target_organization_id,
    array['teckel_admin','teckel_operator','ennco_admin']::public.user_role[]) then
    raise exception 'INTELLIGENCE_OPERATOR_REQUIRED';
  end if;
  return actor;
end $$;
revoke all on function app.intelligence_assert_operator(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. Escritura de puntuaciones (lote idempotente)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_account_icp_scores(
  target_organization_id uuid,
  target_scores jsonb
)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare
  actor uuid;
  written integer := 0;
begin
  actor := app.intelligence_assert_operator(target_organization_id);
  if jsonb_typeof(target_scores) <> 'array' then raise exception 'ICP_SCORES_MUST_BE_ARRAY'; end if;
  if jsonb_array_length(target_scores) > 2000 then raise exception 'ICP_SCORES_BATCH_TOO_LARGE'; end if;

  with entrada as (
    select
      (value->>'account_id')::uuid as account_id,
      (value->>'score')::smallint as score,
      value->>'band' as band,
      value->>'rubric_version' as rubric_version,
      coalesce(value->'factors', '[]'::jsonb) as factors_json,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(value->'missing','[]'::jsonb)) x), '{}') as missing_signals,
      coalesce((value->>'contract_only_state')::boolean, false) as contract_only_state
    from jsonb_array_elements(target_scores)
  ),
  -- Sólo cuentas vivas del mismo tenant: una puntuación de otra organización
  -- o de una cuenta borrada sería un falso positivo en la cola de prioridad.
  validas as (
    select e.* from entrada e
    join public.accounts a
      on a.id = e.account_id and a.organization_id = target_organization_id and a.is_deleted = false
  ),
  guardadas as (
    insert into public.account_icp_scores as s
      (organization_id, account_id, score, band, rubric_version, factors_json, missing_signals, contract_only_state, computed_at)
    select target_organization_id, account_id, score, band, rubric_version, factors_json, missing_signals, contract_only_state, now()
    from validas
    on conflict (organization_id, account_id, rubric_version) do update
      set score = excluded.score,
          band = excluded.band,
          factors_json = excluded.factors_json,
          missing_signals = excluded.missing_signals,
          contract_only_state = excluded.contract_only_state,
          computed_at = now()
    returning 1
  )
  select count(*) into written from guardadas;

  return jsonb_build_object(
    'written', written,
    'submitted', jsonb_array_length(target_scores),
    'actor', actor);
end $$;
revoke all on function public.upsert_account_icp_scores(uuid, jsonb) from public, anon, service_role;
grant execute on function public.upsert_account_icp_scores(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- E. Cola de prioridad: qué cuentas atacar primero
-- ---------------------------------------------------------------------------
create or replace function public.read_icp_priority_queue(
  target_organization_id uuid,
  target_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then
    raise exception 'INTELLIGENCE_MEMBER_REQUIRED';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'totals', (select jsonb_build_object(
        'scored', count(*),
        'band_a', count(*) filter (where band = 'A'),
        'band_b', count(*) filter (where band = 'B'),
        'band_c', count(*) filter (where band = 'C'),
        'band_d', count(*) filter (where band = 'D'),
        'out_of_contract', count(*) filter (where band = 'FUERA_DE_CONTRATO'),
        'contract_only_state', count(*) filter (where contract_only_state))
      from public.account_icp_scores where organization_id = target_organization_id),
    'accounts', coalesce((
      select jsonb_agg(fila order by fila->>'score' desc)
      from (
        select jsonb_build_object(
          'account_id', a.id,
          'legal_name', a.legal_name,
          'city', a.city,
          'state', a.state,
          'industrial_park', a.industrial_park,
          'tier', a.tier,
          'score', s.score,
          'band', s.band,
          'contract_only_state', s.contract_only_state,
          'missing', to_jsonb(s.missing_signals),
          'factors', s.factors_json,
          -- Una cuenta suprimida (Anexo A incluido) nunca debe encabezar la
          -- cola aunque puntúe alto: se marca aquí para que la interfaz la
          -- muestre bloqueada en vez de omitirla en silencio.
          'suppressed', exists(
            select 1 from public.suppression_entries se
            where se.organization_id = target_organization_id
              and se.account_id = a.id),
          'enrolled', exists(
            select 1 from public.campaign_enrollments ce
            where ce.organization_id = target_organization_id
              and ce.account_id = a.id)
        ) as fila
        from public.account_icp_scores s
        join public.accounts a
          on a.id = s.account_id and a.organization_id = s.organization_id and a.is_deleted = false
        where s.organization_id = target_organization_id
        order by s.score desc, a.legal_name
        limit greatest(1, least(coalesce(target_limit, 50), 500))
      ) top), '[]'::jsonb)
  ) into result;

  return result;
end $$;
revoke all on function public.read_icp_priority_queue(uuid, integer) from public, anon, service_role;
grant execute on function public.read_icp_priority_queue(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- F. Sugerencias de clasificación
-- ---------------------------------------------------------------------------
create or replace function public.upsert_reply_suggestions(
  target_organization_id uuid,
  target_suggestions jsonb
)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare
  actor uuid;
  written integer := 0;
begin
  actor := app.intelligence_assert_operator(target_organization_id);
  if jsonb_typeof(target_suggestions) <> 'array' then raise exception 'SUGGESTIONS_MUST_BE_ARRAY'; end if;
  if jsonb_array_length(target_suggestions) > 500 then raise exception 'SUGGESTIONS_BATCH_TOO_LARGE'; end if;

  with entrada as (
    select
      (value->>'provider_event_id')::uuid as provider_event_id,
      value->>'intent' as suggested_intent,
      value->>'classification' as suggested_classification,
      (value->>'confidence')::numeric as confidence,
      coalesce(value->'signals','[]'::jsonb) as signals_json,
      coalesce((value->>'needs_human_now')::boolean, false) as needs_human_now,
      value->>'classifier_version' as classifier_version
    from jsonb_array_elements(target_suggestions)
  ),
  -- Sólo eventos REPLY del mismo tenant que siguen sin revisar. Sugerir sobre
  -- una respuesta ya clasificada por un humano no aporta y confunde la bandeja.
  validas as (
    select e.* from entrada e
    join public.provider_events pe
      on pe.id = e.provider_event_id
     and pe.organization_id = target_organization_id
     and pe.event_kind = 'REPLY'
     and pe.reply_classification = 'UNREVIEWED'
  ),
  guardadas as (
    insert into public.reply_classification_suggestions
      (organization_id, provider_event_id, suggested_intent, suggested_classification,
       confidence, signals_json, needs_human_now, classifier_version)
    select target_organization_id, provider_event_id, suggested_intent, suggested_classification,
           confidence, signals_json, needs_human_now, classifier_version
    from validas
    on conflict (organization_id, provider_event_id, classifier_version) do update
      set suggested_intent = excluded.suggested_intent,
          suggested_classification = excluded.suggested_classification,
          confidence = excluded.confidence,
          signals_json = excluded.signals_json,
          needs_human_now = excluded.needs_human_now
    returning 1
  )
  select count(*) into written from guardadas;

  return jsonb_build_object('written', written, 'submitted', jsonb_array_length(target_suggestions), 'actor', actor);
end $$;
revoke all on function public.upsert_reply_suggestions(uuid, jsonb) from public, anon, service_role;
grant execute on function public.upsert_reply_suggestions(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- G. Lectura para el brief y la bandeja
-- ---------------------------------------------------------------------------
create or replace function public.read_reply_suggestions(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then
    raise exception 'INTELLIGENCE_MEMBER_REQUIRED';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'needs_human_now', (select count(*) from public.reply_classification_suggestions s
      join public.provider_events pe on pe.id = s.provider_event_id
      where s.organization_id = target_organization_id and s.needs_human_now
        and pe.reply_classification = 'UNREVIEWED'),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider_event_id', s.provider_event_id,
        'intent', s.suggested_intent,
        'classification', s.suggested_classification,
        'confidence', s.confidence,
        'signals', s.signals_json,
        'needs_human_now', s.needs_human_now,
        'classifier_version', s.classifier_version,
        'observed_at', pe.observed_at,
        'subject', m.subject,
        'from_email', m.normalized_from
      ) order by s.needs_human_now desc, s.confidence desc, pe.observed_at asc)
      from public.reply_classification_suggestions s
      join public.provider_events pe
        on pe.id = s.provider_event_id and pe.organization_id = s.organization_id
      left join public.messages m on m.id = pe.message_id
      where s.organization_id = target_organization_id
        and pe.reply_classification = 'UNREVIEWED'
      limit 200), '[]'::jsonb)
  ) into result;

  return result;
end $$;
revoke all on function public.read_reply_suggestions(uuid) from public, anon, service_role;
grant execute on function public.read_reply_suggestions(uuid) to authenticated;

commit;
