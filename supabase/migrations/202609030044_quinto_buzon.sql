begin;

-- M044 el quinto buzón entra al programa.
--
-- fcuellar@enncoenergia.com quedó fuera del alta original a propósito
-- ("reserva, fuera del allowlist"). Desde el 2-sep está calentando en
-- SmartLead junto a los otros tres, y Grant pidió el 3-sep tenerlo en la
-- plataforma para operar los cinco desde la pantalla de Correos.
--
-- Mismo molde que la migración 0037: nace en HOLD, sin credencial, DNS ya
-- autenticado (verificado por dig el 3-sep: SPF, DKIM, DMARC del dominio
-- responden), y con los mismos topes que sus hermanos aislados.

insert into public.mailboxes (
  organization_id, normalized_email, domain, sender_name, provider,
  eligibility_route, domain_role, custody_status, ownership_status,
  warmup_minimum_days, warmup_status, provider_daily_limit,
  auth_spf, auth_dkim, auth_dmarc, auth_tls,
  health_status, credential_status, kill_switch,
  domain_registered_at, human_history_verified, blocklist_status,
  tier1_only, max_account_count, max_email_touches,
  sender_identity_verified, gmail_seed_verified, outlook_seed_verified,
  yahoo_seed_verified, reply_sync_verified, list_unsubscribe_verified,
  one_click_unsubscribe_verified
)
select
  'e0000000-0000-4000-8000-000000000001'::uuid,
  'fcuellar@enncoenergia.com', 'enncoenergia.com', 'Francisco Cuellar', 'gmail',
  'NEW_ISOLATED_MAILBOX_WARMUP', 'OUTREACH_ISOLATED',
  'TECKEL_MANAGED_FOR_ENNCO', 'ENNCO_OWNED',
  42, 'NOT_STARTED', 0,
  true, true, true, true,
  'HOLD', 'UNKNOWN', false,
  '2026-08-26'::timestamptz, false, 'UNKNOWN',
  true, 50, 3,
  false, false, false, false, false, false, false
where not exists (
  select 1 from public.mailboxes
  where organization_id = 'e0000000-0000-4000-8000-000000000001'
    and normalized_email = 'fcuellar@enncoenergia.com'
);

-- El carril directo le pone el mismo nombre visible que a los demás.
update public.mailboxes
set direct_lane_display_name = 'Francisco Cuellar'
where organization_id = 'e0000000-0000-4000-8000-000000000001'
  and normalized_email = 'fcuellar@enncoenergia.com'
  and direct_lane_display_name is null;

commit;
