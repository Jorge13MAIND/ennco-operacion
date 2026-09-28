-- 069 · RPC públicas con nombres de parámetros (23-sep-2026).
--
-- Nueve funciones públicas que la app llama por nombre estaban declaradas sin nombres de
-- parámetros. PostgREST no las encontraba (PGRST202) y la app lo mostraba como "Rechazado por
-- gate". Caso visible: clasificar la respuesta de Hershey en la bandeja. También afectaba asignar y
-- completar tareas, resultados de juntas, aprobaciones, incidentes y evaluaciones de salud.
--
-- Cada una solo reenvía sus argumentos a app.<misma función>, que sí tiene nombres. Se vuelven a
-- declarar con esos nombres; el cuerpo, los atributos y los permisos quedan iguales.

begin;

drop function public.record_meeting_outcome_v2(uuid, uuid, text, timestamp with time zone, text, text, text);
CREATE FUNCTION public.record_meeting_outcome_v2(target_organization_id uuid, target_meeting_id uuid, target_outcome_status text, target_occurred_at timestamp with time zone, target_outcome_notes text, target_evidence_sha256 text, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.record_meeting_outcome_v2($1,$2,$3,$4,$5,$6,$7) $function$;
revoke all on function public.record_meeting_outcome_v2(uuid, uuid, text, timestamp with time zone, text, text, text) from public;
grant execute on function public.record_meeting_outcome_v2(uuid, uuid, text, timestamp with time zone, text, text, text) to anon, authenticated, service_role;

drop function public.transition_operational_incident(uuid, uuid, text, text, text, boolean, text);
CREATE FUNCTION public.transition_operational_incident(target_organization_id uuid, target_incident_id uuid, target_action text, target_evidence_sha256 text, target_detail text, target_recovery_test_passed boolean, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.transition_operational_incident($1,$2,$3,$4,$5,$6,$7) $function$;
revoke all on function public.transition_operational_incident(uuid, uuid, text, text, text, boolean, text) from public;
grant execute on function public.transition_operational_incident(uuid, uuid, text, text, text, boolean, text) to anon, authenticated, service_role;

drop function public.evaluate_operations_health(uuid, timestamp with time zone);
CREATE FUNCTION public.evaluate_operations_health(target_organization_id uuid, target_evaluated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.evaluate_operations_health($1,$2) $function$;
revoke all on function public.evaluate_operations_health(uuid, timestamp with time zone) from public;
grant execute on function public.evaluate_operations_health(uuid, timestamp with time zone) to anon, authenticated, service_role;

drop function public.request_closed_won_approval(uuid, uuid, text, text);
CREATE FUNCTION public.request_closed_won_approval(target_organization_id uuid, target_opportunity_id uuid, target_request_reason text, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.request_closed_won_approval($1,$2,$3,$4) $function$;
revoke all on function public.request_closed_won_approval(uuid, uuid, text, text) from public;
grant execute on function public.request_closed_won_approval(uuid, uuid, text, text) to anon, authenticated, service_role;

drop function public.decide_operational_approval(uuid, uuid, text, text, text, text);
CREATE FUNCTION public.decide_operational_approval(target_organization_id uuid, target_request_id uuid, target_subject_sha256 text, target_decision text, target_rationale text, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.decide_operational_approval($1,$2,$3,$4,$5,$6) $function$;
revoke all on function public.decide_operational_approval(uuid, uuid, text, text, text, text) from public;
grant execute on function public.decide_operational_approval(uuid, uuid, text, text, text, text) to anon, authenticated, service_role;

drop function public.assign_operational_task(uuid, uuid, uuid, uuid, text);
CREATE FUNCTION public.assign_operational_task(target_organization_id uuid, target_task_id uuid, target_owner_user_id uuid, target_backup_user_id uuid, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.assign_operational_task($1,$2,$3,$4,$5) $function$;
revoke all on function public.assign_operational_task(uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.assign_operational_task(uuid, uuid, uuid, uuid, text) to anon, authenticated, service_role;

drop function public.complete_operational_task_v2(uuid, uuid, text, text);
CREATE FUNCTION public.complete_operational_task_v2(target_organization_id uuid, target_task_id uuid, target_completion_evidence_sha256 text, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.complete_operational_task_v2($1,$2,$3,$4) $function$;
revoke all on function public.complete_operational_task_v2(uuid, uuid, text, text) from public;
grant execute on function public.complete_operational_task_v2(uuid, uuid, text, text) to anon, authenticated, service_role;

drop function public.review_reply_and_route(uuid, uuid, reply_classification, text);
CREATE FUNCTION public.review_reply_and_route(target_organization_id uuid, target_provider_event_id uuid, target_classification reply_classification, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.review_reply_and_route($1,$2,$3,$4) $function$;
revoke all on function public.review_reply_and_route(uuid, uuid, reply_classification, text) from public;
grant execute on function public.review_reply_and_route(uuid, uuid, reply_classification, text) to anon, authenticated, service_role;

drop function public.evaluate_control_cadence_health(uuid, timestamp with time zone);
CREATE FUNCTION public.evaluate_control_cadence_health(target_organization_id uuid, target_evaluated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$ select app.evaluate_control_cadence_health($1,$2) $function$;
revoke all on function public.evaluate_control_cadence_health(uuid, timestamp with time zone) from public;
grant execute on function public.evaluate_control_cadence_health(uuid, timestamp with time zone) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
