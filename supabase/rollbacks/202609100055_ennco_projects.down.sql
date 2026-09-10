begin;
-- Ejecutar sólo después de respaldar expedientes. Revierte M055; no toca CRM.
drop policy if exists ennco_project_documents_read on storage.objects;
drop policy if exists ennco_project_documents_insert on storage.objects;
do $$ declare r record; begin
  for r in select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app' and p.proname like 'ennco_project_%') or (n.nspname='public' and p.proname like 'ennco_projects_%') loop
    execute format('drop function if exists %s cascade',r.signature);
  end loop;
end $$;
drop table if exists public.ennco_project_documents;
drop table if exists public.ennco_project_records;
drop table if exists public.ennco_project_catalogs;
drop table if exists public.ennco_project_members;
drop table if exists public.ennco_projects;
drop table if exists app.ennco_project_audit;
drop table if exists app.ennco_project_commands;
drop table if exists app.ennco_project_counters;
drop table if exists app.ennco_project_signing_secret;
-- Los objetos privados se conservan para recuperación; nunca eliminamos archivos.
delete from storage.buckets where id='ennco-project-documents' and not exists(select 1 from storage.objects where bucket_id='ennco-project-documents');
commit;
