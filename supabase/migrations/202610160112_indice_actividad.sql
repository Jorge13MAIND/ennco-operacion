-- 112 · Índice para la pantalla Actividad (16-oct-2026). app.direct_lane_activity_json busca, por cada
-- correo del periodo, el último SETTLE de public.direct_lane_ticks (columna last_error). Sin índice por
-- message_id, cada búsqueda recorría los ~48 mil ticks de la organización: la semana tardaba 14 s, pasaba
-- el statement_timeout de 8 s del rol authenticated y la pantalla caía. Con el índice tarda menos de 0.1 s.
-- Solo rendimiento: no cambia datos ni funciones.

begin;

create index if not exists direct_lane_ticks_settle_message_idx
  on public.direct_lane_ticks (organization_id, message_id, created_at desc)
  where tick_kind = 'SETTLE' and message_id is not null;

commit;
