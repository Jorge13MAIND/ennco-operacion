# M1 Gate Report

Snapshot: 11 de agosto de 2026, America/Mexico_City.

## Veredicto

`PASS` para M1 local sintético.

Este veredicto no autoriza staging compartido, infraestructura externa, producción, compras, DNS, credenciales ni contacto. El programa enterprise de doce semanas no está terminado.

## Golden path probado

1. `COMPANY_REGISTERED`
2. `SUPPRESSION_PASSED`
3. `DRY_RUN_MESSAGE_CREATED`
4. `REPLY_INGESTED`
5. `STRICT_LEAD_CREATED`
6. `ALERT_ENQUEUED`
7. `PORTAL_PROJECTED`
8. `NEXT_ACTION_CREATED`

Cada ejecución devuelve IDs auditables y `evidence_class=synthetic_demo`. La respuesta declara `external_side_effects=0`. El replay con la misma llave devuelve `DUPLICATE`. El escenario suprimido termina en `SUPPRESSION_BLOCKED` antes de crear mensaje.

## Gate de datos

- 20 proyectos históricos preservados y normalizados.
- $8,411,668.31 MXN en el universo del archivo histórico.
- 277,895 Wp normalizados como 277.895 kWp, conservando valores y fórmulas raw.
- 27 empresas como `RESEARCH_SEED`.
- Seis registros en cuarentena.
- Cero contactos, leads, oportunidades, pipeline o filas elegibles para outreach.
- `npm run verify:data`: 28 de 28 controles `PASS`.

## Gate PostgreSQL

La migración completa se ejecutó en PostgreSQL 16.13 desechable. La suite adversarial confirmó:

- Supresión por empresa, correo y dominio.
- Supresión fail-closed sin crear mensaje.
- Replay idempotente sin duplicar message u outbox.
- Reuso de llave con payload distinto rechazado.
- Kill switch global y por mailbox.
- Autenticación, secuencia, aprobación, SPF, DKIM, DMARC y TLS como gates.
- RLS por organización y rechazo de referencias entre tenants.
- Audit log append-only y sin inserción manual de usuarios.
- Claim concurrente con `SKIP LOCKED`, lease recovery, backoff y dead letter.

Resultados exactos:

```text
CORE_DATABASE_GATE_PASS
SEED_APPLY_PASS
```

Limitación: el runtime completo de Supabase PG17, Auth y Storage queda para M2 porque el equipo local no tiene Docker o Podman. No invalida el gate PostgreSQL, pero sí bloquea declarar integración Supabase completa.

## Gate de aplicación

`npm run verify`:

- ESLint sin warnings.
- TypeScript sin errores.
- 13 de 13 pruebas unitarias `PASS`.
- Build Next.js de producción `PASS`.

`npm run test:e2e`:

- 30 de 30 casos `PASS`.
- Cinco perfiles: desktop wide, desktop standard, tablet, iPhone y Android.
- Home, diagnóstico sintético, verdad comercial, golden path, supresión y assistant fail-closed.

WebKit no puede ejecutarse en este macOS congelado por incompatibilidad de protocolo `PushAPIEnabled`. Safari real o CI actualizado permanece como gate previo a cualquier release público.

## Interfaz verificada

- `docs/evidence/M1-control-room-desktop.png`
- `docs/evidence/M1-control-room-mobile.png`
- `docs/evidence/M1-diagnostic-desktop.png`

La revisión visual encontró una tabla horizontal ilegible en móvil. Se corrigió a tarjetas etiquetadas antes del corte.

## Comando canónico

```bash
npm run verify:m0m1
```

## Resultado comercial

Actividad real: cero.

Leads contractuales: cero.

Pipeline estricto: cero.

Revenue atribuido: cero.

No se contactó a nadie y no hubo efectos externos.
