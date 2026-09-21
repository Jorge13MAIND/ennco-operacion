-- 061 · El acceso de una persona no puede sobrevivir a su cuenta.
--
-- Incidente del 17 de septiembre de 2026: la cuenta george@teckel-ai.com se
-- borró y se volvió a crear. El borrado dejó su fila de organization_users
-- (user_id a61c5ce5…) apuntando a un usuario que ya no existe, y la cuenta
-- nueva (b16cdecb…) quedó sin ninguna fila. Resultado: la contraseña
-- funcionaba, la sesión se creaba y requireOperationsAccess() la expulsaba
-- con "La cuenta no tiene acceso activo a esta organización".
--
-- organization_users.user_id nunca tuvo llave foránea contra auth.users, así
-- que nada impedía el huérfano ni avisaba de él. La fila huérfana además era
-- dueña de 3,603 incidentes, 3,603 casos SLA y 1 asignación operativa, así
-- que no se puede borrar sin reasignar: Jorge es la misma persona, se le
-- reasignan a su identificador nuevo.

begin;

-- Las tablas de control operativo solo admiten escrituras desde sus RPC
-- (disparador app.prevent_operations_control_direct_write); esta es la misma
-- bandera de sesión que ellos ponen. Vive solo en esta transacción.
set local app.operations_rpc_write = 'on';

-- 1. Alta de la cuenta nueva con el rol que tenía la vieja.
insert into public.organization_users (organization_id, user_id, role, active)
values ('e0000000-0000-4000-8000-000000000001', 'b16cdecb-098b-4cc4-a059-5d3c0ca96295', 'teckel_admin', true)
on conflict (organization_id, user_id) do update set role = excluded.role, active = true;

-- 2. Lo que era de la cuenta vieja pasa a la nueva (misma persona).
update public.incidents set owner_user_id = 'b16cdecb-098b-4cc4-a059-5d3c0ca96295'
  where owner_user_id = 'a61c5ce5-be5c-4c2d-854b-2687145ca70e';
update public.operational_sla_cases set owner_user_id = 'b16cdecb-098b-4cc4-a059-5d3c0ca96295'
  where owner_user_id = 'a61c5ce5-be5c-4c2d-854b-2687145ca70e';
update public.operational_assignments set primary_user_id = 'b16cdecb-098b-4cc4-a059-5d3c0ca96295'
  where primary_user_id = 'a61c5ce5-be5c-4c2d-854b-2687145ca70e';

-- 3. Limpiar las filas de acceso cuyo usuario ya no existe.
delete from public.organization_users ou
where not exists (select 1 from auth.users u where u.id = ou.user_id);

-- 4. Que no vuelva a pasar: borrar la cuenta borra su acceso en la misma
--    transacción. Si esa persona es dueña de incidentes, tareas o casos, las
--    llaves de esas tablas lo impiden con un error claro en vez de dejar un
--    huérfano en silencio.
alter table public.organization_users
  add constraint organization_users_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

commit;
