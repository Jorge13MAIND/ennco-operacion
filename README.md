# ENNCO Revenue Platform

Sistema comercial E2E de ENNCO. Este repositorio contiene la experiencia pública, el portal operativo, los contratos de datos, las migraciones y los controles de liberación.

## Estado

- M0: paquete interno completo y auditado. Gate global `EXTEND` por insumos externos faltantes.
- M1: golden path local `PASS` con datos sintéticos y cero efectos externos.
- M2: seguridad, Storage, audit allowlist, retención y restore local en `PASS`. Gate global `EXTEND` hasta validar proveedor, legal, secretos, antivirus, PITR y RTO.
- M3: captación, precotizador, PDF, persistencia y analítica local en `PASS`. Gate global `EXTEND` hasta aprobar modelo, aviso, antivirus y Supabase real.
- M4: portal operativo, Gmail push, respuestas, calificación, pipeline y exportaciones locales en `PASS`. Gate global `EXTEND` hasta provisionar proveedores y ejecutar UAT ENNCO.
- Producción, DNS, compras y contacto externo: bloqueados hasta aprobación explícita.

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npm run dev
```

`ENNCO_DEMO_MODE=true` permite datos sintéticos exclusivamente fuera de producción. Producción falla si no existe un proyecto Supabase dedicado, organización, MFA y configuración completa.

## Verificación

```bash
npm run verify:m0m1
npm run verify:m2
npm run verify:m3
npm run verify:m4
```

Este comando valida:

- Cobertura RTM de 47 de 47 puntos del checklist.
- Integridad de los dos XLSX y 28 controles de normalización.
- Migración e invariantes en PostgreSQL desechable.
- Supresión, idempotencia, audit log, outbox, retry, dead letter y kill switches.
- Lint, tipos, unitarias y build de producción.
- E2E en cinco perfiles de viewport.

`verify:m2` agrega:

- Escaneo local de secretos y auditoría de dependencias.
- Storage privado, aislamiento por organización, cuarentena y rollback.
- Audit log con allowlist y pruebas centinela sin PII.
- Legal holds, doble aprobación, borrado transaccional y tombstones sin PII.
- Backup lógico y restore separado de base y objetos sintéticos.
- Evidencia explícita de que PITR, RPO de 15 minutos y RTO de cuatro horas aún no están probados.

`verify:m3` agrega:

- Backtest de cuatro propuestas anónimas y checksum de fuentes locales.
- Captura HMAC, consentimiento versionado, idempotencia, replay y rate limit.
- Analítica allowlist sin nombre, correo, teléfono, empresa ni propiedades arbitrarias.
- PDF temporal privado y QA de landing, privacidad y resultado.

`verify:m4` agrega:

- Webhook Gmail con OIDC, HMAC, replay e idempotencia.
- Sync de history paginado con full sync obligatorio ante cursor vencido.
- Respuesta, auto reply, hard bounce, baja y evento ambiguo.
- Revisión humana antes de crear un lead por respuesta positiva.
- Calificación contractual, reuniones y transiciones de pipeline con gates de base.
- CSV privado con neutralización de fórmulas, checksum y audit run.
- Portal responsive con módulos de operación y separación explícita de simulación y verdad comercial.

## Operación local

1. Ejecuta `npm install`.
2. Copia `.env.example` como `.env.local`.
3. Confirma que `ENNCO_ALLOW_EXTERNAL_SEND=false` y `ENNCO_GLOBAL_KILL_SWITCH=true`.
4. Ejecuta `npm run dev`.
5. Abre `http://localhost:3000/operacion`.
6. Ejecuta el golden path. Debe mostrar ocho etapas, cero efectos externos y estado `COMPLETED`.
7. Repite con la misma llave. Debe mostrar `DUPLICATE`.

El endpoint sintético devuelve 404 en producción. El assistant devuelve 503 hasta su release gate. La precotización usa exclusivamente un modelo draft y datos sintéticos. La superficie pública y el aviso legal permanecen en `HOLD`.

## Acceso y documentos

- `/operacion` usa demo local sólo cuando `ENNCO_DEMO_MODE=true` y el ambiente no es producción.
- Fuera del demo, la sesión se valida con claims firmados, membresía de organización y MFA AAL2.
- La aplicación web no necesita ni expone una llave `service_role`.
- El diseño de documentos usa cuarentena, path opaco y checksum. La carga pública permanece deshabilitada hasta conectar un scanner autorizado y Storage real.

## Bloqueos humanos visibles

- Anexo A recibido, conciliado y hasheado.
- PDF ejecutado del contrato y certificado BoldSign archivados.
- Evidencia de primer pago y constancia de inicio acumulativa.
- Aprobación de compras, dominios, DNS, credenciales, producción y primer envío.
- Validación técnica de Paco para cualquier modelo de precotización.
- Revisión legal del aviso de privacidad y aprobación de su versión final.

Ninguno bloquea el trabajo interno seguro. Todos bloquean la acción externa que les corresponde.

## Fuentes de verdad

- GitHub: implementación y evidencia técnica.
- Portal ENNCO: roadmap, riesgos, decisiones y aceptación.
- PostgreSQL: verdad comercial y atribución.

No se reportan contactos, aperturas, invitaciones ni automatizaciones como pipeline o revenue.
