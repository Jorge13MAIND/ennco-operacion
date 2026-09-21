-- 062 · Índices para las consultas del Control Room.
--
-- Diagnóstico del 21 de septiembre de 2026 (PORTAL_QUERY_FAILED:57014 en
-- /operacion/respuestas y /operacion): cada pantalla disparaba ~31 consultas a la
-- vez contra una instancia Micro (2 vCPU compartidas, 1 GB). Las de `incidents` y
-- `operational_sla_cases` (3,600 filas cada una) hacían Seq Scan y evaluaban
-- `app.is_member()` fila por fila; en pg_stat_statements promediaban 4.7 s con
-- picos de 8 s, justo el statement_timeout del rol authenticated. El código ya
-- pide solo lo que cada pantalla necesita; estos índices quitan los Seq Scan de
-- las consultas que quedan. Las tablas son pequeñas: el bloqueo dura milisegundos.

begin;

create index if not exists incidents_org_opened_idx
  on public.incidents (organization_id, opened_at desc);

create index if not exists operational_sla_cases_org_due_idx
  on public.operational_sla_cases (organization_id, due_at);

create index if not exists messages_org_inbound_created_idx
  on public.messages (organization_id, created_at desc)
  where direction = 'INBOUND';

create index if not exists provider_events_org_observed_idx
  on public.provider_events (organization_id, observed_at desc);

create index if not exists leads_org_created_idx
  on public.leads (organization_id, created_at desc);

create index if not exists tasks_org_due_idx
  on public.tasks (organization_id, due_at);

create index if not exists opportunities_org_updated_idx
  on public.opportunities (organization_id, updated_at desc);

create index if not exists meetings_org_scheduled_idx
  on public.meetings (organization_id, scheduled_at);

create index if not exists approval_requests_org_requested_idx
  on public.approval_requests (organization_id, requested_at desc);

create index if not exists accounts_org_live_idx
  on public.accounts (organization_id, updated_at desc)
  where is_deleted = false;

create index if not exists contacts_org_live_idx
  on public.contacts (organization_id, updated_at desc)
  where is_deleted = false;

commit;
