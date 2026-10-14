CREATE OR REPLACE FUNCTION public.read_crm(target_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'CRM_ACCESS_DENIED'; end if;
  return jsonb_build_object(
    'records', coalesce((select jsonb_agg(app.crm_record_json(r) order by coalesce(r.last_reply_at, r.created_at) desc)
      from public.crm_records r where r.organization_id = target_organization_id), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', ou.user_id, 'email', u.email, 'role', ou.role) order by u.email)
      from public.organization_users ou join auth.users u on u.id = ou.user_id
      where ou.organization_id = target_organization_id and ou.active), '[]'::jsonb),
    'default_owner_user_id', (select s.default_owner_user_id from app.crm_settings s where s.organization_id = target_organization_id),
    'generated_at', clock_timestamp());
end $function$

