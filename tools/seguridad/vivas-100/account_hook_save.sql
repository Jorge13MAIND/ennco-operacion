CREATE OR REPLACE FUNCTION public.account_hook_save(target_organization_id uuid, target_account_id uuid, target_hook_text text, target_source_url text, target_source_name text, target_observed_at date, target_confidence text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare h public.ennco_account_hooks;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_source_url is null and coalesce(target_confidence,'MEDIA') <> 'BAJA' then raise exception 'HOOK_SOURCE_REQUIRED'; end if;
  insert into public.ennco_account_hooks(organization_id,account_id,hook_text,source_url,source_name,observed_at,confidence,status,created_by)
  values (target_organization_id,target_account_id,btrim(target_hook_text),target_source_url,target_source_name,target_observed_at,coalesce(target_confidence,'MEDIA'),'DRAFT',auth.uid())
  returning * into h;
  return jsonb_build_object('id',h.id,'accountId',h.account_id,'hookText',h.hook_text,'status',h.status,'confidence',h.confidence);
end $function$
