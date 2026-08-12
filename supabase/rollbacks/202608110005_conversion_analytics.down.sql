begin;

drop policy if exists analytics_events_member_read on public.analytics_events;
revoke all on function public.capture_public_analytics_event(uuid, text, uuid, bigint, text, text, text, text) from public;
drop function if exists public.capture_public_analytics_event(uuid, text, uuid, bigint, text, text, text, text);
drop table if exists public.analytics_rate_windows;
drop table if exists public.analytics_events;

commit;
