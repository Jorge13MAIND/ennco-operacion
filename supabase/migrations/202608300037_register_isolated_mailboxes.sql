begin;

-- M037 alta de los tres buzones del carril aislado.
--
-- Viven en dominios comprados por Teckel (Vercel Registrar, 26-ago-2026) con
-- DNS bajo nuestros nameservers. Verificado por DNS el 29-ago: NS en
-- vercel-dns.com, MX en smtp.google.com, DKIM publicado y respondiendo en
-- ambos. Por eso auth_spf/dkim/dmarc entran en true: es lo que responde el
-- resolutor, no optimismo.
--
-- ownership_status = ENNCO_OWNED y custody_status = TECKEL_MANAGED_FOR_ENNCO:
-- el registrante es ENNCO (contrato: la infraestructura es del cliente desde
-- el dia uno) y la custodia operativa es de Teckel. Los dos campos existen
-- justo para esa distincion.
--
-- El cuarto buzon creado en Workspace (fcuellar@enncoenergia.com) NO se da de
-- alta: no esta en el allowlist de app.hybrid_mailbox_address_is_allowed. Era
-- la reserva diferida por DEC-100 y solo entra si se activa esa palanca.
--
-- credential_status UNKNOWN y provider_daily_limit 0 a proposito: el motor no
-- puede enviar hasta que tengan credencial cifrada y terminen los 42 dias.
--
-- GUARDIA: esta es una migracion de DATOS con la organizacion de produccion
-- fijada. Los gates de base corren en entornos efimeros con organizaciones
-- sinteticas propias, donde ese id no existe y el insert reventaria por llave
-- foranea. Se ejecuta solo si la organizacion esta presente.

do $alta$
begin
  if not exists (
    select 1 from public.organizations
    where id = 'e0000000-0000-4000-8000-000000000001'::uuid
  ) then
    return;
  end if;

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
    m.correo, m.dominio, 'Francisco Cuellar', 'gmail',
    'NEW_ISOLATED_MAILBOX_WARMUP', 'OUTREACH_ISOLATED',
    'TECKEL_MANAGED_FOR_ENNCO', 'ENNCO_OWNED',
    42, 'NOT_STARTED', 0,
    true, true, true, true,
    'HOLD', 'UNKNOWN', false,
    '2026-08-26'::timestamptz, false, 'UNKNOWN',
    true, 50, 3,
    false, false, false, false, false, false, false
  from (values
    ('francisco@enncoindustrial.com', 'enncoindustrial.com'),
    ('fcuellar@enncoindustrial.com',  'enncoindustrial.com'),
    ('francisco@enncoenergia.com',    'enncoenergia.com')
  ) as m(correo, dominio)
  where not exists (
    select 1 from public.mailboxes x
    where x.organization_id = 'e0000000-0000-4000-8000-000000000001'::uuid
      and x.normalized_email = m.correo
  );
end
$alta$;

do $verificacion$
declare fuera text;
begin
  if to_regprocedure('app.hybrid_mailbox_address_is_allowed(text,text)') is null then return; end if;
  select string_agg(normalized_email, ', ') into fuera
  from public.mailboxes
  where eligibility_route = 'NEW_ISOLATED_MAILBOX_WARMUP'
    and not app.hybrid_mailbox_address_is_allowed(normalized_email, eligibility_route);
  if fuera is not null then
    raise exception 'M037_BUZON_FUERA_DEL_ALLOWLIST: %', fuera;
  end if;
end
$verificacion$;

commit;
