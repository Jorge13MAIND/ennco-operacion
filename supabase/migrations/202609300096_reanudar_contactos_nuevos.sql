-- 096 · Reanudar contactos nuevos (30-sep-2026). Orden de Grant, con el sí de Jorge: "Quiero que quites
-- todos los bloqueos. Necesito que empecemos a mandar correos a contactos nuevos ahorita mismo."
--
-- Tres candados de la rama codex/ennco-email-sdr-recovery-2026-09-23 frenaban a los contactos nuevos:
--   1. Pausa manual de la v4 (campaigns.new_contacts_paused) → false.
--   2. Retención automática de la cohorte por rebote (app.email_cohort_on_hold): de 2 % a 10 %, el
--      mismo umbral del supervisor.
--   3. Autorización por contacto (app.email_contact_is_ready): se agrega una excepción a nivel
--      organización, firmada, con motivo y vencimiento (31-oct), para contactos verificados, sin
--      rebote, no suprimidos y con planta en GTO/QRO/JAL/MICH. No se inventa evidencia por contacto;
--      la regla completa sigue vigente para quien sí la tenga.
-- Para revertir: update public.email_readiness_overrides set active=false;
--                update public.campaigns set new_contacts_paused=true where name like 'ENNCO · Bajío industrial v4%';

begin;

set local app.operations_rpc_write = 'on';

create table if not exists public.email_readiness_overrides (
  organization_id uuid primary key references public.organizations(id),
  active boolean not null default true,
  reason text not null check (length(btrim(reason)) >= 20),
  approved_by uuid not null,
  approved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);
alter table public.email_readiness_overrides enable row level security;
comment on table public.email_readiness_overrides is
  'Excepción firmada a la autorización por contacto (email_contact_clearances), con motivo y vencimiento.';

CREATE OR REPLACE FUNCTION app.email_contact_is_ready(target_org uuid, target_contact uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select (exists (
    select 1 from public.contacts c
    join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
    join public.research_contact_candidates rc on rc.organization_id=c.organization_id
      and rc.account_id=a.id and rc.promoted_contact_id=c.id and rc.research_status='PROMOTED'
    join public.email_contact_clearances cl on cl.organization_id=c.organization_id and cl.contact_id=c.id
    where c.organization_id=target_org and c.id=target_contact and c.verified and not c.is_deleted
      and a.research_status='VERIFIED' and a.research_verified_at is not null and not a.is_deleted
      and cl.decision='READY' and cl.expires_at>clock_timestamp()
      and cl.plant_state in ('GUANAJUATO','QUERETARO','JALISCO','MICHOACAN')
      and not app.is_suppressed(target_org,a.id,c.normalized_email,a.primary_domain)
  ))
  -- Excepción firmada por Grant (30-sep): deja pasar, mientras esté activa y sin vencer, a quien no
  -- tiene la evidencia por contacto, con las mismas condiciones mínimas de seguridad.
  or exists (
    select 1 from public.email_readiness_overrides o
    join public.contacts c on c.organization_id=o.organization_id and c.id=target_contact
    join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
    where o.organization_id=target_org and o.active and o.expires_at>clock_timestamp()
      and c.verified and not c.is_deleted and not a.is_deleted
      and upper(translate(coalesce(a.state,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU')) ~ '^(GUANAJUATO|QUERETARO|JALISCO|MICHOACAN)'
      and not app.is_suppressed(target_org,a.id,c.normalized_email,a.primary_domain)
      and not exists (select 1 from public.messages m where m.organization_id=target_org and m.contact_id=c.id
        and m.direction='OUTBOUND' and m.status='BOUNCED')
  )
$function$;

CREATE OR REPLACE FUNCTION app.email_cohort_on_hold(target_org uuid, target_campaign uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select coalesce((select c.new_contacts_paused or (count(m.id)>=25 and count(m.id) filter(where m.status in ('BOUNCED','FAILED'))>=2
    and (count(m.id) filter(where m.status in ('BOUNCED','FAILED')))::numeric/nullif(count(m.id),0)>0.10)
    from public.campaigns c left join public.campaign_enrollments e on e.organization_id=c.organization_id and e.campaign_id=c.id
    left join public.messages m on m.organization_id=e.organization_id and m.enrollment_id=e.id and m.direction='OUTBOUND'
      and m.status in ('SENT','DELIVERED','BOUNCED','FAILED') and coalesce(m.sent_at,m.created_at)>=clock_timestamp()-interval '7 days'
    where c.organization_id=target_org and c.id=target_campaign group by c.id),true)
$function$;

insert into public.email_readiness_overrides(organization_id, active, reason, approved_by, expires_at)
values ('e0000000-0000-4000-8000-000000000001', true,
  'Grant 30-sep, con el sí de Jorge: quitar los bloqueos y mandar a contactos nuevos; solo verificados, sin rebote, no suprimidos y en GTO/QRO/JAL/MICH.',
  '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', '2026-10-31 23:59:59-06')
on conflict (organization_id) do update set active=true, reason=excluded.reason, approved_by=excluded.approved_by,
  approved_at=clock_timestamp(), expires_at=excluded.expires_at;

update public.campaigns set new_contacts_paused=false, updated_at=clock_timestamp()
where organization_id='e0000000-0000-4000-8000-000000000001' and name like 'ENNCO · Bajío industrial v4%';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'DIRECT_LANE_NEW_CONTACTS_RESUMED', 'organizations',
  'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('source','migración 096','readiness_override_until','2026-10-31','cohort_bounce_hold','10%','new_contacts_paused',false));

commit;
