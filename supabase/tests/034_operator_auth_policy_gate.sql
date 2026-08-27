-- M033 gate: la política de aseguramiento del operador debe MORDER en los dos
-- modos, y el invariante de "sin sesión no se pasa" debe sobrevivir a ambos.
--
-- Este gate existe porque DEC-106 cambió el nivel exigido. Un gate que solo
-- probara el modo nuevo no probaría nada: la única evidencia útil es que el
-- interruptor cambia el resultado en la dirección esperada y que ninguna
-- posición del interruptor abre la puerta a una petición sin sesión.

\set organization '11111111-1111-4111-8111-111111111111'
\set member_user '83111111-1111-4111-8111-111111111111'
\set stranger_user '84111111-1111-4111-8111-111111111111'

insert into public.organizations (id, slug, legal_name)
values (:'organization', 'm033-synthetic-org', 'M033 Synthetic Org')
on conflict (id) do nothing;

insert into public.organization_users (organization_id, user_id, role, active)
values (:'organization', :'member_user', 'teckel_operator', true)
on conflict (organization_id, user_id) do update set role = excluded.role, active = true;

-- ---------------------------------------------------------------------------
-- 1. La bandera falla cerrado cuando no hay fila de política.
-- ---------------------------------------------------------------------------
do $$
declare saved boolean;
begin
  select require_mfa into saved from app.auth_policy where singleton;
  delete from app.auth_policy;
  if not app.mfa_enforced() then
    raise exception 'M033_POLICY_MISSING_MUST_FAIL_CLOSED';
  end if;
  insert into app.auth_policy (singleton, require_mfa, reason)
  values (true, saved, 'restaurada por el gate 034');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. La tabla de política no es alcanzable por los roles de la aplicación.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'app.auth_policy', 'select')
    or has_table_privilege('authenticated', 'app.auth_policy', 'update')
    or has_table_privilege('anon', 'app.auth_policy', 'select')
  then
    raise exception 'M033_POLICY_TABLE_REACHABLE_BY_APP_ROLE';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Modo estricto: un solo factor NO basta.
-- ---------------------------------------------------------------------------
update app.auth_policy set require_mfa = true;

set request.jwt.claim.sub = :'member_user';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$
begin
  if app.request_assurance_ok() then
    raise exception 'M033_STRICT_MODE_ACCEPTED_SINGLE_FACTOR';
  end if;
  if app.is_member('11111111-1111-4111-8111-111111111111') then
    raise exception 'M033_STRICT_MODE_MEMBER_BYPASS';
  end if;
  if app.has_role('11111111-1111-4111-8111-111111111111',
    array['teckel_operator']::public.user_role[]) then
    raise exception 'M033_STRICT_MODE_ROLE_BYPASS';
  end if;
end;
$$;
reset role;

-- El segundo factor sí basta en modo estricto.
set request.jwt.claim.aal = 'aal2';
set role authenticated;
do $$
begin
  if not app.has_role('11111111-1111-4111-8111-111111111111',
    array['teckel_operator']::public.user_role[]) then
    raise exception 'M033_STRICT_MODE_REJECTED_SECOND_FACTOR';
  end if;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Modo contraseña (DEC-106): un solo factor basta, y solo eso cambia.
-- ---------------------------------------------------------------------------
update app.auth_policy set require_mfa = false;

set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$
begin
  if not app.request_assurance_ok() then
    raise exception 'M033_PASSWORD_MODE_REJECTED_SINGLE_FACTOR';
  end if;
  if not app.is_member('11111111-1111-4111-8111-111111111111') then
    raise exception 'M033_PASSWORD_MODE_MEMBER_DENIED';
  end if;
  if not app.has_role('11111111-1111-4111-8111-111111111111',
    array['teckel_operator']::public.user_role[]) then
    raise exception 'M033_PASSWORD_MODE_ROLE_DENIED';
  end if;
  -- El rol sigue siendo el rol: un rol que no tiene no se lo inventa.
  if app.has_role('11111111-1111-4111-8111-111111111111',
    array['auditor_readonly']::public.user_role[]) then
    raise exception 'M033_PASSWORD_MODE_GRANTED_UNHELD_ROLE';
  end if;
end;
$$;
reset role;

-- Quien no es miembro sigue sin serlo aunque el segundo factor esté apagado.
set request.jwt.claim.sub = :'stranger_user';
set role authenticated;
do $$
begin
  if app.is_member('11111111-1111-4111-8111-111111111111')
    or app.has_role('11111111-1111-4111-8111-111111111111',
      array['teckel_operator']::public.user_role[]) then
    raise exception 'M033_PASSWORD_MODE_ADMITTED_NON_MEMBER';
  end if;
end;
$$;
reset role;

-- Un miembro dado de baja sigue fuera.
set request.jwt.claim.sub = :'member_user';
update public.organization_users set active = false
where organization_id = :'organization' and user_id = :'member_user';
set role authenticated;
do $$
begin
  if app.is_member('11111111-1111-4111-8111-111111111111') then
    raise exception 'M033_PASSWORD_MODE_ADMITTED_INACTIVE_MEMBER';
  end if;
end;
$$;
reset role;
update public.organization_users set active = true
where organization_id = :'organization' and user_id = :'member_user';

-- ---------------------------------------------------------------------------
-- 5. Invariante: SIN sesión se rechaza en los dos modos. Este es el bloque que
--    de verdad importa, porque es el único que no depende de la política.
-- ---------------------------------------------------------------------------
do $$
declare mode boolean;
begin
  foreach mode in array array[true, false] loop
    update app.auth_policy set require_mfa = mode;

    -- Sin claim de aseguramiento: no hay sesión que valga.
    perform set_config('request.jwt.claim.aal', '', true);
    perform set_config('request.jwt.claims', '', true);
    if app.request_assurance_ok() then
      raise exception 'M033_NULL_ASSURANCE_ACCEPTED_IN_MODE_%', mode;
    end if;
    if app.is_member('11111111-1111-4111-8111-111111111111') then
      raise exception 'M033_NULL_ASSURANCE_MEMBER_BYPASS_IN_MODE_%', mode;
    end if;

    -- Un valor de aseguramiento que no reconocemos tampoco pasa.
    perform set_config('request.jwt.claim.aal', 'aal0', true);
    if app.request_assurance_ok() then
      raise exception 'M033_UNKNOWN_ASSURANCE_ACCEPTED_IN_MODE_%', mode;
    end if;
  end loop;
end;
$$;

-- Se restaura el estado que la migración siembra (DEC-106).
update app.auth_policy set require_mfa = false;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

\echo 'OPERATOR_AUTH_POLICY_GATE_PASS'
