begin;
-- A legacy three-argument overload exists remotely but not in the repo's
-- authenticated transport. It lacks the proof and current safety gates.
-- Keep its definition for forensic rollback; remove every application caller.
do $$ begin
  if to_regprocedure('public.claim_direct_lane_dispatch(uuid,uuid,boolean)') is not null then
    revoke all on function public.claim_direct_lane_dispatch(uuid,uuid,boolean) from public,anon,authenticated,service_role;
  end if;
end $$;
commit;
