# M24. Propiedad y control de infraestructura comercial

Fecha de congelamiento local: 20 de agosto de 2026.

Estado global: `EXTEND`.

Estado del control local: `EVIDENCE_READY`.

> Nota vigente desde M29: la topología de cuatro buzones nuevos descrita en este documento quedó `SUPERSEDED` por el plan híbrido. El contrato actual está en `docs/33-m29-hybrid-accelerated-outbound.md`. M24 se conserva como evidencia histórica y como control del proveedor, pero ya no autoriza outbound.

Estado de procurement Apollo: `IN_PROGRESS_EXTERNAL`. Paco está realizando la contratación directamente. El sistema no interviene en el checkout y no considera la cuenta conectada hasta validar la API.

## Decisión implementada

El baseline operativo es una cuenta Apollo Professional mensual, con un asiento, titularidad de ENNCO y Francisco Cuellar como identidad del usuario. Teckel será operador autorizado. No se compartirán contraseñas y no se renombrará el perfil de Teckel.

La decisión no autoriza compra, checkout, DNS, OAuth, conexión de buzones ni envío. Esos actos conservan `BLOCKED_EXTERNAL` hasta recibir la autorización y acceso exactos.

## Verificación vigente de Apollo

- Los términos de Apollo, actualizados el 10 de agosto de 2026, autorizan usuarios empleados o proveedores expresamente autorizados, pero la licencia estándar es para los fines comerciales internos del titular y restringe el acceso en nombre de otra entidad. Esto favorece que ENNCO sea el titular y Teckel su proveedor autorizado. Fuente: [Apollo Terms](https://www.apollo.io/terms).
- Apollo usa el nombre del perfil como nombre visible en todos los buzones y no admite una identidad distinta por buzón. Fuente: [Profile Settings](https://knowledge.apollo.io/hc/en-us/articles/34010120281613-Configure-Your-Profile-Settings-in-Apollo).
- Basic admite un buzón por usuario. Professional admite buzones Google Workspace y Microsoft 365 ilimitados por usuario. Fuente: [Mailbox Limits](https://knowledge.apollo.io/hc/en-us/articles/4409127806093-Link-Your-Mailbox-to-Apollo).
- Apollo recomienda al menos seis semanas de warmup, equivalentes a 42 días. Fuente: [Domain and Mailbox Warmup](https://knowledge.apollo.io/hc/en-us/articles/33476090833549-Generate-a-Domain-and-Mailbox-to-Reach-Prospects).
- Los activos comprados dentro de Apollo consumen créditos y pueden quedar inactivos si cambian el plan o los créditos. Por eso los dominios y Google Workspace se comprarán por separado.

El precio mensual exacto no se declara verificado hasta observarlo en el checkout de la cuenta ENNCO. El presupuesto conserva MXN 1,782 como supuesto a tipo de cambio de MXN 18 por USD.

## Adaptador API listo antes de recibir la llave

La plataforma incluye un preflight de solo lectura basado en los endpoints oficiales de Apollo:

- `GET /api/v1/users/api_profile?include_credit_usage=true` para identificar al administrador efectivo y observar créditos.
- `GET /api/v1/email_accounts` para leer buzones, sincronización, warming y límites.
- `POST /api/v1/contacts/search` exclusivamente como búsqueda de registros ya guardados por correo exacto. Es una consulta de cero créditos y no crea contactos.

La llave se envía únicamente en el header `x-api-key`. El adaptador limita el origen a `https://api.apollo.io`, aplica timeout, tamaño máximo de respuesta, errores sanitizados y una lista cerrada de operaciones. No implementa crear contactos, inscribir, activar, pausar, remover ni enviar.

El preflight genera una evidencia sanitizada con hashes de usuario, workspace y buzones. No persiste la llave, nombres, correos ni cuerpos crudos de Apollo. Aun cuando la conexión sea válida, el resultado mantiene `external_send_allowed=false` y `activation_state=HOLD`.

Comandos:

```bash
npm run verify:apollo-api-contract
npm run capture:apollo-api-readiness
```

El segundo comando sólo se ejecuta cuando la llave está disponible en el entorno controlado. Si faltan dominios o buzones, valida la cuenta y devuelve el bloqueo exacto sin fallar abierto.

## Controles implementados

La migración `202608200024_provider_infrastructure_control.sql` agrega:

1. Registro tenant-safe de cuentas de proveedor.
2. Presupuesto mensual y cap de créditos.
3. Dominios de outreach comprados por registrador independiente.
4. Cuatro buzones ligados a cuenta y dominio del mismo tenant.
5. Estado de OAuth, SPF, DKIM, DMARC, TLS, Postmaster, seeds, reply sync, baja y warmup.
6. Límite diario de dos al inicio y máximo diez.
7. Quince gates de activación con evidencia `synthetic_demo` o `live`.
8. Read model autenticado con AAL2 y RLS.
9. Trigger que bloquea cualquier mensaje real si el release no es `READY_FOR_CANARY`.
10. Rollback fail closed que preserva el ledger y sigue bloqueando outbound.
11. RPC atómica AAL2 para aplicar snapshots observados de cuenta, presupuesto, dominios, buzones y gates, con replay e idempotency drift.
12. Gate `OPERATOR_COVERAGE` alineado al modo aprobado `SINGLE_TECKEL_OPERATOR`, sin inventar un suplente inexistente.

M25 agrega el enlace transaccional del Anexo A:

- Manifiesto exacto con hash `8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1`.
- Tres empresas, doce alias y seis dominios, sin almacenar nombres o dominios crudos en el ledger de supresión.
- Matching por nombre, alias y dominio con HMAC tenant-scoped.
- Conversión atómica de cualquier enrollment coincidente a `SUPPRESSED`.
- Gate `ANEXO_A_BOUND` imposible de marcar live sin el manifiesto real.
- Endpoint autenticado que aplica únicamente el snapshot congelado del servidor.

## Contrato de salida

`READY_FOR_CANARY` requiere simultáneamente:

- Apollo Professional mensual, un asiento, owner ENNCO.
- MFA y recuperación verificados.
- Dos dominios independientes, ENNCO-owned y con autenticación completa.
- Cuatro buzones con identidad `Francisco Cuellar`.
- 42 días completos por cada buzón.
- Salud observada en las últimas 24 horas.
- Seeds Gmail, Outlook y Yahoo.
- Reply sync, `List-Unsubscribe` y one-click unsubscribe.
- Cap de hasta 500 créditos, cero teléfonos y cero gasto Apollo en dominios o buzones.
- Quince gates en PASS y los quince con evidencia live.

Un valor faltante, malformado, cruzado de tenant o sintético devuelve `UNKNOWN` o `HOLD`.

## Evidencia local

Comandos:

```bash
npm run verify:m24-provider-baseline
npm run verify:apollo-api-contract
npm run verify:provider-infrastructure-db
npm run verify:annex-a-db
npm test -- --run src/lib/infrastructure/provider.test.ts src/lib/operations/portal.test.ts
npm run typecheck
npm run lint
```

Los gates de base prueban forward, RLS, AAL1, tenant isolation, dominio generado por Apollo, presupuesto, 41 contra 42 días, dry run, nombre, alias, dominio, HMAC, binding del Anexo A, bloqueo de envío real, rollback, reapply y schema diff.

## Estado real de entradas

- Anexo A: PASS local, 3 empresas, 12 alias, 6 dominios. Contrato de importación transaccional PASS local. Aplicación en Supabase ENNCO pendiente.
- Aviso de privacidad: paquete exacto PASS, aprobación legal pendiente.
- Contrato: firmado y archivado por confirmación definitiva de Jorge. No se vuelve a solicitar ni se conserva como bloqueo.
- Operación: Teckel es el operador único. No habrá operador suplente ENNCO.
- Vercel y Supabase: cuentas administradas por Teckel por decisión de Jorge. Aislamiento, export, restore y runbooks siguen siendo obligatorios.
- Apollo: contratación externa en curso por Paco. API, plan, identidad, créditos y buzones todavía no verificados por la plataforma.
- Dominios, Workspace, Google Cloud, Resend, Sentry y Checkly: no conectados durante este hito.
- Destinatarios reales: 0.
- Envíos reales: 0.

## Próximo gate

El siguiente gate inicia cuando Paco entregue una llave Apollo con scopes mínimos de lectura. La plataforma validará usuario efectivo, cuenta, créditos y buzones antes de registrar el snapshot. Después siguen dominios, Workspace, OAuth, DNS, evidencia en el portal y warmup. La primera fecha elegible se calcula desde la autenticación completa del último buzón elegible, no desde la compra.

## Corte productivo 20 de agosto de 2026

- Supabase ENNCO tiene aplicadas y alineadas las migraciones M001 a M028.
- M028 reemplazó el requisito ficticio de operador suplente por `OPERATOR_COVERAGE`, compatible con Teckel como operador único.
- El adaptador Apollo de sólo lectura, su contrato estricto y el endpoint autenticado de snapshot están desplegados.
- Vercel deployment `dpl_6FmGvjXP2ETpKirbLAsRZzLi5or5` quedó en estado `READY` y fue asociado a `https://ennco-operacion.vercel.app`.
- La salud posterior al despliegue confirmó `external_send_allowed=false` y `global_kill_switch=true`.
- La API Apollo todavía no está configurada y no se registró ninguna llave en el repositorio, evidencia o despliegue.
- No existen mutaciones Apollo implementadas. El sistema no puede crear contactos, inscribirlos, modificar secuencias ni enviar desde Apollo.
