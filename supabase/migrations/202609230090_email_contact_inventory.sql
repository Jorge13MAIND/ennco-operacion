begin;
create function public.read_email_contact_inventory(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'EMAIL_INVENTORY_MEMBER_REQUIRED'; end if;
  return jsonb_build_object(
    'uncontacted',(select count(*) from public.contacts c where c.organization_id=target_organization_id
      and not c.is_deleted and not exists(select 1 from public.campaign_enrollments ce
        join public.campaigns ca on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
        where ce.organization_id=c.organization_id and ce.contact_id=c.id and ca.lane='DIRECT')),
    'ready',(select count(*) from public.email_contact_clearances cl join public.contacts c
      on c.organization_id=cl.organization_id and c.id=cl.contact_id
      where cl.organization_id=target_organization_id and cl.decision='READY' and cl.expires_at>clock_timestamp()
      and app.email_contact_is_ready(c.organization_id,c.id)
      and not exists(select 1 from public.campaign_enrollments ce
        join public.campaigns ca on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
        where ce.organization_id=c.organization_id and ce.contact_id=c.id and ca.lane='DIRECT')),
    'verified_accounts',(select count(*) from public.accounts a where a.organization_id=target_organization_id
      and a.research_status='VERIFIED' and a.research_verified_at is not null and not a.is_deleted),
    'promoted_contacts',(select count(*) from public.research_contact_candidates rc where rc.organization_id=target_organization_id
      and rc.research_status='PROMOTED' and rc.promoted_contact_id is not null),
    'review_queue',coalesce((select jsonb_agg(to_jsonb(q)) from (select c.id as contact_id,c.full_name,c.role_title,
      a.legal_name,a.state,a.research_status as account_research_status,
      exists(select 1 from public.research_contact_candidates rc where rc.organization_id=c.organization_id
        and rc.promoted_contact_id=c.id and rc.research_status='PROMOTED') as person_researched,
      cl.decision as clearance_decision,cl.expires_at as clearance_expires_at
      from public.contacts c join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
      left join public.email_contact_clearances cl on cl.organization_id=c.organization_id and cl.contact_id=c.id
      where c.organization_id=target_organization_id and not c.is_deleted and not a.is_deleted
        and not exists(select 1 from public.campaign_enrollments ce join public.campaigns ca
          on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
          where ce.organization_id=c.organization_id and ce.contact_id=c.id and ca.lane='DIRECT')
      order by case when upper(a.state) in ('GUANAJUATO','QUERETARO','QUERÉTARO') then 0 else 1 end,
        a.tier nulls last,c.created_at limit 50) q),'[]'::jsonb)
  );
end $$;
revoke all on function public.read_email_contact_inventory(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_email_contact_inventory(uuid) to authenticated;
commit;
