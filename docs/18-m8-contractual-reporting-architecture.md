# M8 Contractual Reporting Architecture

## Veredicto

- Implementacion local M8: `PASS`.
- Gate global M8: `EXTEND`.
- Mes contractual live: `NOT_STARTED`.
- Reportes contractuales reales: `0`.
- Experimentos reales: `0`.
- Leads contractuales reales: `0`.
- Efectos externos: `0`.

M8 queda preparado para medir y emitir el primer mes completo. No existe campaña operativa, mes completo, reporte emitido ni resultado comercial que reportar.

## Reloj del mes completo

El reporte sólo se genera si:

1. El periodo inicia el día uno.
2. Termina exactamente al iniciar el mes siguiente.
3. Todos los días del periodo tienen evidencia live `OPERATING`.
4. Los tres primeros días hábiles posteriores existen en el calendario MX versionado.
5. El periodo ya terminó.
6. El creador es `teckel_admin` activo.

Un día `HOLD`, `BLOCKED`, `UNKNOWN`, sintetico o faltante impide declarar mes completo.

## Denominadores y canales

El snapshot conserva por separado:

- Mensajes entregados.
- Respuestas sustantivas.
- Respuestas positivas.
- Leads estrictos originados en email.
- Leads estrictos originados en precotización.
- Reuniones realizadas.
- Oportunidades calificadas.
- Propuestas entregadas.
- Cierres ganados.
- Primeros pagos.
- Incumplimientos del SLA de respuesta.

La tasa de email usa sólo leads de email sobre mensajes entregados. Un lead de precotización suma a la meta contractual pero nunca infla la tasa de respuesta del correo.

## Evidencia estricta

Cada lead contado conserva los cinco criterios contractuales:

- Industrial mayor a 100 kWp.
- Fuera del Anexo A.
- Rol objetivo verificado.
- Interés explícito o gasto mensual mayor a 20,000 MXN.
- Al menos un registro de evidencia.

El reporte guarda una fila por mensaje, respuesta, lead, reunión, evento de etapa, propuesta, pago y brecha de SLA que entra al total. El snapshot y la fuente llevan SHA256.

## Emision

El reporte es append-only. Emitirlo requiere una aprobación append-only de Jorge que coincida con:

- Organización.
- ID del reporte.
- Hash del snapshot.
- Actor `teckel_admin`.

La emisión es idempotente. Una fuente distinta para el mismo mes produce `MONTHLY_REPORT_EXISTING_EVIDENCE_DRIFT`.

## Recuperacion comercial

Si la meta de diez leads no se alcanza, el orden es obligatorio:

1. Verificar denominadores.
2. Verificar deliverability.
3. Verificar calidad de contactos.
4. Verificar SLA humano de ENNCO.
5. Identificar el segmento con mejor señal.
6. Proponer un experimento de una variable.

El experimento exige un reporte emitido, muestra de 5 a 100, baseline hasheado y aprobación exacta. Sólo puede existir uno en `READY` o `RUNNING` por campaña. No existe variable `VOLUME`, por lo que subir volumen no es un atajo disponible.

## Persistencia

La migración `202608120010_contractual_monthly_reporting.sql` agrega:

- `commercial_stage_events`.
- `campaign_operation_days`.
- `reporting_calendar_days`.
- `contractual_monthly_reports`.
- `contractual_report_items`.
- `contractual_report_issuances`.
- `recovery_experiments`.
- RLS, audit allowlist, service-only, rollback y reapply.

## Bloqueos

- M6 y M7 en `EXTEND`.
- Cero días operativos live.
- Calendario operativo real sin cargar.
- Cero entregas y T0 inexistente.
- Primer mes completo no iniciado.
- Aprobación e emisión no aplicables todavía.

Hasta resolverlos, el Control Room muestra M8 `BLOCKED`, gate `EXTEND` y reporte `No iniciado`.
