begin;

-- M045: enlace de respuestas por hilo del proveedor.
--
-- Por que existe: la API de Gmail REESCRIBE el Message-ID de los envios y
-- emite el suyo (<CA...@mail.gmail.com>). Verificado el 4-sep-2026 leyendo el
-- mensaje enviado: nuestro <msg-uuid@dominio> nunca llega al prospecto, asi
-- que su In-Reply-To no trae el molde que extractGmailEventContext busca y el
-- sync tiraba TODA respuesta real en silencio (las dos respuestas de la
-- prueba interna del 4-sep se perdieron asi). El threadId de Gmail si es
-- estable: esta funcion resuelve el ultimo OUTBOUND nuestro del mismo hilo y
-- el sync la usa como red cuando el encabezado no resuelve.
--
-- Misma disciplina de prueba HMAC que el resto del despacho (espejo de
-- annotate_direct_lane_inbound).

create or replace function public.resolve_direct_lane_outbound(
  target_organization_id uuid, target_mailbox_id uuid, target_provider_thread_id text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; found_id uuid;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','resolve_direct_lane_outbound',target_organization_id::text,
    target_mailbox_id::text,coalesce(target_provider_thread_id,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_provider_thread_id is null or btrim(target_provider_thread_id) = '' then
    return jsonb_build_object('status','SKIPPED','message_id',null);
  end if;
  select id into found_id from public.messages
    where organization_id = target_organization_id and mailbox_id = target_mailbox_id
      and direction = 'OUTBOUND' and provider_thread_id = btrim(target_provider_thread_id)
    order by created_at desc limit 1;
  return jsonb_build_object('status', case when found_id is null then 'NOT_FOUND' else 'RESOLVED' end, 'message_id', found_id);
end $$;

revoke all on function public.resolve_direct_lane_outbound(uuid,uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_direct_lane_outbound(uuid,uuid,text,text,uuid,timestamptz,text) to anon,authenticated;

commit;
