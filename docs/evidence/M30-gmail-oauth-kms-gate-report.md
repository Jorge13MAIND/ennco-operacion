# Evidencia M30. Gmail OAuth y KMS

Fecha de cierre: 2026-08-25, America/Mexico_City.

## Dictamen

`DEPLOYED_HOLD`.

- Código, migración, rollback y gates locales: `PASS`.
- Migración en Supabase productivo: `PASS`.
- Despliegue Vercel productivo: `PASS`.
- Conexión OAuth de `contacto@ennco.com.mx`: `HOLD`.
- Envío externo: `BLOCKED`.
- Kill switch global: `ON`.

No se compró infraestructura y no se envió correo. El cliente OAuth web ya existe, pero sus dos secretos actuales quedaron expuestos en la interfaz durante la configuración y se consideran comprometidos. Ninguno fue almacenado en Vercel o Supabase y no se puede usar para enlazar Gmail. La rotación destructiva queda pendiente de confirmación puntual.

## Artefactos

- `src/lib/gmail/oauth.ts`
- `src/lib/gmail/oauth-server.ts`
- `src/app/api/v1/operations/infrastructure/gmail/oauth/start/route.ts`
- `src/app/api/v1/operations/infrastructure/gmail/oauth/callback/route.ts`
- `supabase/migrations/202608250030_gmail_oauth_kms_broker.sql`
- `supabase/rollbacks/202608250030_gmail_oauth_kms_broker.down.sql`
- `supabase/tests/run-gmail-oauth-kms-broker-gate.sh`
- `docs/34-m30-gmail-oauth-kms-broker.md`
- `docs/runbooks/m30-gmail-oauth-kms.md`

## Verificación local

Comandos ejecutados:

```bash
npm test -- --run
npm run build
npm run typecheck
npm run lint
npm run verify:secrets
npm run verify:gmail-oauth-kms-db
git diff --check
bash -n supabase/tests/run-gmail-oauth-kms-broker-gate.sh
```

Resultados:

- Vitest: 64 archivos, 301 tests, `PASS`.
- Build Next.js productivo: `PASS`.
- TypeScript y ESLint: `PASS`.
- Escaneo de secretos: 638 archivos, cero hallazgos.
- Gate DB: forward, concurrency, rollback, reapply, diff y script, todos `PASS`.

Revalidación posterior a la configuración productiva del 25 de agosto de 2026:

```bash
bash supabase/tests/run-gmail-oauth-kms-broker-gate.sh
npm test -- --run src/lib/gmail/oauth.test.ts src/lib/gmail/outbound-client.test.ts src/app/api/v1/operations/infrastructure/gmail/oauth/oauth-routes.test.ts
npm run typecheck
npm run lint
node scripts/verify-no-secrets.mjs
curl -fsS https://ennco-operacion.vercel.app/api/v1/health
```

Resultados:

- Gate DB: `GMAIL_OAUTH_KMS_BROKER_FORWARD_PASS`, `CONCURRENCY_PASS`, `ROLLBACK_PASS`, `REAPPLY_PASS`, `DIFF_PASS` y `SCRIPT_PASS`.
- Vitest enfocado: 3 archivos, 16 tests, `PASS`.
- TypeScript y ESLint: `PASS`.
- Escaneo de secretos: 641 archivos, cero hallazgos.
- Salud productiva: `evidence_class=live`, `external_send_allowed=false` y `global_kill_switch=true`.

SHA256 de la migración:

```text
5e361e8182cc102c2c2d7508e8fd19212043a79598b9554a8d18de07ed047bc8
```

## Verificación Supabase productiva

Proyecto: `isnzaoifdjtwnugupidj`.

La migración se ejecutó de inicio a fin en el editor SQL autenticado y devolvió `Success. No rows returned`. Después se ejecutaron consultas independientes que confirmaron:

- `public.gmail_oauth_credentials` existe;
- `public.begin_gmail_oauth_authorization(...)` existe;
- `public.complete_gmail_oauth_authorization(...)` existe;
- las tres tablas M30 tienen RLS habilitado y forzado;
- `authenticated` no tiene acceso directo `SELECT`, `INSERT`, `UPDATE` o `DELETE`;
- `service_role` no tiene acceso directo `SELECT`, `INSERT`, `UPDATE` o `DELETE`.

El journal `supabase_migrations.schema_migrations` contiene:

```text
version: 202608250030
name: gmail_oauth_kms_broker
statement_count: 1
stored_sql_sha256: 5e361e8182cc102c2c2d7508e8fd19212043a79598b9554a8d18de07ed047bc8
```

El statement único conserva el archivo completo, por eso su SHA coincide exactamente con el artefacto local.

## Verificación Vercel productiva

- Proyecto: `ennco-operacion`.
- Deployment final: `dpl_HnXPnkocD4t4moTK9kEGWyukGVMn`.
- Alias: `https://ennco-operacion.vercel.app`.
- `ENNCO_GMAIL_OAUTH_RELEASED=false` fue configurado explícitamente en Production.
- Existen en Production, como valores sensibles y sin revelarse, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI`, `ENNCO_GMAIL_OAUTH_STATE_SECRET` y `ENNCO_GMAIL_OAUTH_COMPLETION_SECRET`.
- `GOOGLE_OAUTH_CLIENT_SECRET` no está configurado porque los dos secretos emitidos por Google se consideran comprometidos y deben rotarse.
- `/api/v1/health` respondió HTTP 200 con `external_send_allowed=false` y `global_kill_switch=true`.
- `/operacion/infraestructura` conserva autenticación y redirige a ingreso sin sesión.

## Verificación Google Cloud y configuración privada

- Proyecto Google Cloud: `august-beaker-478801-t3`.
- Gmail API: habilitada.
- Cloud KMS API: habilitada.
- Google Auth Platform: aplicación interna `ENNCO Revenue Platform`, restringida a `ennco.com.mx`.
- Cliente OAuth web: `ENNCO Operacion Production`.
- Callback exacto: `https://ennco-operacion.vercel.app/api/v1/operations/infrastructure/gmail/oauth/callback`.
- Scopes registrados: `openid`, identidad de email, `gmail.send` y `gmail.readonly`.
- El secreto de terminación M30 fue almacenado en `app.private_runtime_config` para la organización ENNCO. Una consulta independiente devolvió `configured=true` y `valid=true`, sin leer ni imprimir el valor.
- El archivo temporal usado para transferir ese secreto fue eliminado y se verificó su ausencia.
- No existe CryptoKey KMS. El proyecto no tiene una cuenta de facturación vinculada y `contacto@ennco.com.mx` no tiene autoridad de administrador de facturación.
- DKIM no se generó. Google Admin exige autenticación de administrador de ENNCO.

## Snapshot live del buzón principal

Se congeló y aplicó un snapshot fail-closed de `contacto@ennco.com.mx` mediante el RPC canónico M29. No se marcaron como verificadas señales que no existen todavía.

Artefactos:

- `data/infrastructure/ennco-primary-mailbox-public-evidence-2026-08-25.json`
- `data/infrastructure/ennco-primary-mailbox-snapshot-2026-08-25.json`

Evidencia pública observada:

- MX de Google Workspace presente;
- SPF `v=spf1 include:_spf.google.com ~all`;
- DMARC `v=DMARC1; p=none`;
- dominio creado el 26 de septiembre de 2025;
- no se observó TXT en los selectores DKIM probados `google` y `default`, lo cual no demuestra ausencia universal;
- TLS, blocklists, identidad visible, historial humano, seeds y reply sync permanecen sin verificar.

Resultado del RPC productivo:

```text
status: APPLIED
mailbox_id: d8e82282-cb63-4444-a68a-d97dc17cf91c
state: UNKNOWN
effective_release: HOLD
daily_cap: 0
domain_age_days: 333
```

El Control Room productivo pasó de `PRIMARY_MAILBOX_COUNT_NOT_ONE` a mostrar el buzón exacto con sus nueve blockers comprobables. La autorización efectiva permaneció en `HOLD`.

## Límites y próximos gates

El paquete no está listo para enlazar Gmail ni para enviar. Faltan, de forma separada:

1. ENNCO debe vincular una cuenta de facturación al proyecto Google Cloud para crear el CryptoKey KMS.
2. ENNCO debe completar la autenticación de Google Admin para generar y publicar DKIM.
3. Confirmar la deshabilitación de los dos secretos OAuth expuestos, crear uno definitivo y almacenarlo sólo en Vercel.
4. Crear el CryptoKey KMS y otorgar al runtime únicamente permisos de cifrado y descifrado.
5. Ejecutar un nuevo deployment con los secretos definitivos y comprobar el callback cerrado.
6. Consentimiento OAuth exacto de `contacto@ennco.com.mx`.
7. Seeds Gmail, Outlook y Yahoo, headers alineados y reply sync menor a cinco minutos.

Hasta cerrar esos gates, `ENNCO_GMAIL_OAUTH_RELEASED` debe permanecer en `false`, el kill switch en `true` y el programa global en `EXTEND`.
