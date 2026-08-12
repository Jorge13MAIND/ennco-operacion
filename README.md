# ENNCO Revenue Platform

Sistema comercial E2E de ENNCO. Este repositorio contiene la experiencia pública, el portal operativo, los contratos de datos, las migraciones y los controles de liberación.

## Estado

- M0: paquete interno auditado y `EVIDENCE_READY`. Gate global `EXTEND` por insumos externos faltantes. No es cierre contractual.
- M1: golden path local `PASS` con datos sintéticos y cero efectos externos.
- M2: seguridad, Storage, audit allowlist, retención y restore local en `PASS`. Gate global `EXTEND` hasta validar proveedor, legal, secretos, antivirus, PITR y RTO.
- M3: captación, precotizador, PDF, persistencia y analítica local en `PASS`. Gate global `EXTEND` hasta aprobar modelo, aviso, antivirus y Supabase real.
- M4: portal operativo, Gmail push, respuestas, calificación, pipeline y exportaciones locales en `PASS`. Gate global `EXTEND` hasta provisionar proveedores y ejecutar UAT ENNCO.
- M5: secuencia, manifest, assistant acotado y shadow canary acelerado local en `PASS`. Gate global `EXTEND` porque han transcurrido cero de 14 días reales.
- M6: paquete de primer envío, 30 gates, lote inmutable y bloqueo SQL local en `PASS`. Gate global `EXTEND`, campaña `HOLD`, cero destinatarios y cero envíos.
- M7: escalamiento controlado, salud por ola y contrato T0 local en `PASS`. Gate global `EXTEND`, cero olas reales y cero de 100 entregas válidas.
- M8: reporte contractual, denominadores por canal y recuperación de una variable local en `PASS`. Gate global `EXTEND`, mes contractual no iniciado y cero reportes reales.
- M9: hardening, segundo restore, exports, handoff y aceptación local en `EVIDENCE_READY`. Gate global `EXTEND`, cero UAT, capacitaciones, transferencias y aceptaciones reales.
- Checkpoint de hardening actual: evidencia comercial relacional, supresión privada, bajas one-click, operación canónica, atribución automática y comisión transaccional pasan en PostgreSQL desechable. Sigue pendiente el canary en Supabase aislado y todos los gates live.
- Capacidad operativa: política versionada de dos proyectos industriales por mes, reserva exclusiva de CLOSED_WON, alertas y estado UNKNOWN ante cierres sin fecha pasan forward, concurrencia, rollback y reapply en PostgreSQL desechable.
- Research Workbench: contratos, nueve endpoints, portal y base M019 pasan localmente. M019 revoca DML directo, exige AAL2, evidencia ligada al sujeto, revisión de dos personas, deduplicación, supresión e inventario 75/150 siempre en `RESEARCH_ONLY_HOLD`. El lote determinista concilia 27 semillas, 21 investigables y 6 en cuarentena, pero no se ha ejecutado contra una base externa. Hay cero contactos, cero elegibles y cero outreach.
- Indexación pública: sólo diagnóstico y privacidad pueden abrirse mediante release explícito. Raíz, portal, auth, APIs y PDFs permanecen privados. La aprobación legal exige versión y SHA256 exactos del contenido canónico, y el mismo artefacto puede volver inmediatamente a HOLD.
- Producción, DNS, compras y contacto externo: bloqueados hasta aprobación explícita.

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npm run dev
```

`ENNCO_DEMO_MODE=true` permite datos sintéticos exclusivamente fuera de producción. Producción falla si no existe un proyecto Supabase dedicado, organización, MFA y configuración completa.

La superficie pública permanece cerrada por default. Antes de cualquier publicación se requieren `ENNCO_PUBLIC_SURFACE_RELEASED_AT`, la versión aprobada del aviso y su SHA256 exacto. `npm run verify:privacy-notice` recalcula el snapshot legal usado por la página.

## Verificación

```bash
npm run verify:m0m1
npm run verify:m2
npm run verify:m3
npm run verify:m4
npm run verify:m5
npm run verify:m6
npm run verify:m7
npm run verify:m8
npm run verify:m9
```

Este comando valida:

- Cobertura RTM de 47 de 47 puntos del checklist.
- Integridad de los dos XLSX y 45 controles de normalización y portabilidad.
- Migración e invariantes en PostgreSQL desechable.
- Supresión, idempotencia, audit log, outbox, retry, dead letter y kill switches.
- Lint, tipos, unitarias y build de producción.
- E2E en cinco perfiles de viewport.

`verify:m2` agrega:

- Escaneo local de secretos y auditoría de dependencias.
- Storage privado, aislamiento por organización, cuarentena y rollback.
- Audit log con allowlist y pruebas centinela sin PII.
- Legal holds, doble aprobación, borrado transaccional y tombstones sin PII.
- M021 local: política versionada, borrado integral, propagación fail closed, restore parcial, replay, rollback y reapply.
- Backup lógico y restore separado de base y objetos sintéticos.
- Evidencia explícita de que PITR, scheduler, proveedores reales, RPO de 15 minutos y RTO de cuatro horas aún no están probados.

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

`verify:m5` agrega:

- Ocho contactos y 24 variantes CEO a CEO con hash, stop rules y cero destinatarios.
- Response playbook y referencias anónimas sin llamarlas casos de éxito.
- Assistant determinista con 22 evals en dos corridas completas.
- Canary acelerado de 14 escenarios con hash chain y cero efectos externos.
- Gate SQL que impide convertir evidencia sintética en `PASS`.
- Forward, rollback y reapply de la persistencia del canary.

`verify:m6` agrega:

- Paquete de readiness con 30 gates exactos y cero evidencia live inventada.
- Ledger de dominios que conserva disponibilidad, propiedad y DNS como desconocidos.
- Cinco destinatarios `.invalid` para render y pruebas sin efectos externos.
- Lote máximo de cinco cuentas con destinatario, buzón, secuencia y hashes congelados.
- Aprobación append-only enlazada al hash del manifiesto.
- Revalidación de supresión, DNS, reputación, canary, copy, horario y runtime antes de cola.
- Bloqueo de `QUEUED`, `SENDING`, `SENT` y `DELIVERED` por fuera del gate.
- Forward, rollback y reapply del gate de primer envío.

`verify:m7` agrega:

- Olas máximas de 25 destinatarios y observación live mínima de 24 horas.
- Decisión `PASS`, `EXTEND` o `KILL` con quejas, duplicados, supresión y P0.
- Fuente única de liberación por enrollment.
- T0 exacto sobre las primeras 100 entregas válidas.
- Funnel estricto que no convierte reuniones o actividad en pipeline.

`verify:m8` agrega:

- Mes calendario completo con evidencia diaria live.
- Calendario MX versionado y fecha del tercer día hábil.
- Reporte append-only con items, denominadores y hash.
- Email y precotización separados por canal.
- Aprobación exacta de emisión.
- Recuperación en orden fijo y una sola variable activa, sin volumen.

`verify:m9` agrega:

- Paquete fuente reproducible desde un commit exacto y manifest SHA256.
- Export y reimport sintético que conserva empresas sin contacto.
- Segunda restauración local independiente con verificación 11 de 11.
- Seis criterios locales y diez criterios live separados.
- Inventario de accesos, proveedores, runbooks, capacitación y checklist final.
- Aceptación append-only exclusiva de un `ennco_admin` autenticado.
- Rechazo de autoaceptación, cross-tenant, statement drift y P0/P1 abiertos.
- Evidencia contractual ligada a registros append-only y tenant-safe.
- Bajas one-click firmadas, supresión HMAC sin correo crudo y fail closed.
- Oportunidad, reunión, pago, atribución y comisión mediante RPCs canónicos idempotentes.
- Capacidad mensual separada de leads y pipeline, con ledger idempotente y alertas accionables.
- Investigación canónica con evidencia por campo, cuatro ojos, deduplicación, snapshot 75/150 y autorización comercial permanentemente separada.
- Gate de alcance que mantiene fuera cualquier código, datos o automatización del sistema expresamente excluido.
- CodeQL, ZAP passive baseline, SBOM CycloneDX, accesibilidad automatizada y smoke de performance configurados o ejecutados según su evidencia local.

Un `PASS` local valida implementación y controles. No equivale a producción, resultado comercial, UAT, capacitación o aceptación ENNCO.

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
- Propiedad ENNCO de repositorio y proveedores, con accesos recertificados.
- Restore, auditoría, export y reimport en infraestructura administrada.
- UAT, capacitación del operador y suplente, walkthrough y aceptación final.

Ninguno bloquea el trabajo interno seguro. Todos bloquean la acción externa que les corresponde.

## Fuentes de verdad

- GitHub: implementación y evidencia técnica.
- Portal ENNCO: roadmap, riesgos, decisiones y aceptación.
- PostgreSQL: verdad comercial y atribución.

No se reportan contactos, aperturas, invitaciones ni automatizaciones como pipeline o revenue.
