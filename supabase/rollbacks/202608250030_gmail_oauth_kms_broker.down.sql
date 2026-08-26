begin;

revoke all on function public.begin_gmail_oauth_authorization(uuid,uuid,text,text,text,text[],timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_gmail_oauth_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.evaluate_gmail_oauth_readiness(uuid,uuid) from public,anon,authenticated,service_role;
drop function if exists public.begin_gmail_oauth_authorization(uuid,uuid,text,text,text,text[],timestamptz,text);
drop function if exists public.complete_gmail_oauth_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,text,text);
drop function if exists public.evaluate_gmail_oauth_readiness(uuid,uuid);

update public.gmail_oauth_credentials set status='ERROR',updated_at=clock_timestamp() where status='ACTIVE';
update public.mailboxes set credential_status='ERROR' where credential_status='OAUTH_CONNECTED';

create or replace function app.m030_block_oauth_connected_after_rollback()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.credential_status='OAUTH_CONNECTED' then
    raise exception 'M030_ROLLBACK_OAUTH_CONNECTION_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists mailboxes_aaa_m030_rollback_fail_closed on public.mailboxes;
create trigger mailboxes_aaa_m030_rollback_fail_closed
before insert or update of credential_status on public.mailboxes
for each row execute function app.m030_block_oauth_connected_after_rollback();

revoke all on function app.m030_block_oauth_connected_after_rollback() from public,anon,authenticated,service_role;
revoke all on public.gmail_oauth_authorizations,public.gmail_oauth_credentials,public.gmail_oauth_commands
from public,anon,authenticated,service_role;

commit;
