CREATE OR REPLACE FUNCTION public.account_hook_review(target_organization_id uuid, target_id uuid, target_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare h public.ennco_account_hooks;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  if target_status not in ('APPROVED','REJECTED','DRAFT') then raise exception 'HOOK_STATUS_INVALID'; end if;
  -- Un gancho sin fuente no se aprueba: la regla del plan es que nada se inventa.
  if target_status='APPROVED' and not exists (select 1 from public.ennco_account_hooks x where x.organization_id=target_organization_id and x.id=target_id and x.source_url is not null) then
    raise exception 'HOOK_SOURCE_REQUIRED';
  end if;
  if target_status='APPROVED' then
    update public.ennco_account_hooks set status='REJECTED', updated_at=now()
    where organization_id=target_organization_id and status='APPROVED'
      and account_id=(select account_id from public.ennco_account_hooks where organization_id=target_organization_id and id=target_id);
  end if;
  update public.ennco_account_hooks set status=target_status, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now()
  where organization_id=target_organization_id and id=target_id returning * into h;
  if not found then raise exception 'HOOK_NOT_FOUND'; end if;
  return jsonb_build_object('id',h.id,'accountId',h.account_id,'status',h.status);
end $function$
