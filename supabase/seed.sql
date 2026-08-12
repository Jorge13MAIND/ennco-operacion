insert into public.organizations (id, slug, legal_name)
values ('11111111-1111-4111-8111-111111111111', 'ennco', 'ENNCO')
on conflict (id) do nothing;

insert into public.runtime_controls (organization_id, global_kill_switch, external_send_allowed)
values ('11111111-1111-4111-8111-111111111111', true, false)
on conflict (organization_id) do nothing;

insert into public.roadmap_milestones (
  organization_id, code, name, owner_role, status, due_date, acceptance_criteria, blocker, next_action
) values
  ('11111111-1111-4111-8111-111111111111', 'M0', 'Readiness', 'Teckel Product & Engineering', 'EVIDENCE_READY', '2026-08-13', 'M0 documentado y Anexo A hasheado.', 'Anexo A y contrato ejecutado pendientes.', 'Importar insumos externos cuando existan.'),
  ('11111111-1111-4111-8111-111111111111', 'M1', 'Control Tower y golden path', 'Teckel Product & Engineering', 'EVIDENCE_READY', '2026-08-18', 'Golden path e idempotencia probados.', null, 'Revalidar con cada cambio material.'),
  ('11111111-1111-4111-8111-111111111111', 'M2', 'Datos seguridad y recuperación', 'Teckel Product & Engineering', 'EVIDENCE_READY', '2026-08-25', 'RLS, Storage privado, restore y threat model probados.', 'Supabase real, legal, credenciales, antivirus y PITR pendientes.', 'Preparar canary aislado sin tráfico.'),
  ('11111111-1111-4111-8111-111111111111', 'M6', 'Primer correo', 'Revenue Operations', 'BLOCKED', '2026-09-16', 'Cinco correos aprobados y monitoreados.', 'Producción y aprobación pendientes.', 'Mantener HOLD.')
on conflict (organization_id, code) do update
set status = excluded.status, blocker = excluded.blocker, next_action = excluded.next_action, updated_at = now();
