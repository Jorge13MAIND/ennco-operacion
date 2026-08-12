begin;

revoke execute on function public.apply_one_click_unsubscribe(uuid, uuid, uuid, text, uuid, bigint, text, text) from anon;
drop function if exists public.apply_one_click_unsubscribe(uuid, uuid, uuid, text, uuid, bigint, text, text);
drop table if exists public.unsubscribe_requests;
alter table app.private_runtime_config drop column if exists unsubscribe_ingest_secret;

commit;
