# Prequote Release Runbook

## Objetivo

Liberar una versión de precotización sólo cuando el código, el modelo, la privacidad, la persistencia y la operación tienen evidencia compatible.

## Precondiciones

1. La versión candidata tiene hash y source manifest.
2. La aprobación de Paco del 20 de agosto de 2026 está ligada a `ENNCO-PREQ-2026-08-PACO-01` y a su fuente SHA256.
3. El aviso de privacidad tiene versión y SHA256 del contenido aprobados por ENNCO, con revisión legal documentada.
4. El proyecto Supabase es exclusivo de ENNCO.
5. Los secretos viven en vault y la configuración privada de base usa el mismo secreto HMAC.
6. `ENNCO_DEMO_MODE=false`.
7. `ENNCO_PUBLIC_SURFACE_RELEASED=false` durante el canary.
8. No hay P0 o P1 abiertos en captura, privacidad, Storage o alertas.

## Preparación del modelo

1. Usar `data/prequote/model-approved-v3.json` sin modificar su versión.
2. Ejecutar `npm run verify:prequote-model`.
3. Revisar los cuatro backtests y todas las flags de fuente.
4. Insertar el modelo en `prequote_models` como `APPROVED` sólo mediante el flujo de cuatro ojos, con `approved_by`, `approved_at`, `valid_from` y `valid_until`.
5. Adjuntar el SHA256 de `data/prequote/paco-approved-parameters-2026-08-20.json` a la evidencia de aprobación.
6. Confirmar que los proyectos de 100 kWp o más no reciben inversión automática.
7. Confirmar que el JSON compilado y la fila aprobada tienen exactamente la misma versión y hash.

## Canary aislado

1. Aplicar migraciones 001 a 005 en staging aislado.
2. Ejecutar forward, rollback y reapply.
3. Confirmar RLS, ACL de anon y ausencia de service role en la aplicación.
4. Enviar una solicitud sintética firmada.
5. Repetirla con una nonce nueva y la misma idempotency key. Debe devolver `DUPLICATE`.
6. Repetir la nonce. Debe devolver `REPLAY_REJECTED`.
7. Probar firma alterada, modelo draft, modelo vencido y rate limit.
8. Inspeccionar outbox y audit log. No deben contener PII.
9. Descargar y renderizar el PDF en desktop y móvil.
10. Ejecutar la suite E2E completa.
11. Ejecutar `npm run verify:privacy-notice` y confirmar que el hash coincide con `ENNCO_PRIVACY_NOTICE_APPROVED_SHA256`.

## Documentos

La carga permanece deshabilitada hasta que todos estos puntos tengan PASS:

1. Bucket privado real.
2. MIME y magic bytes equivalentes.
3. Límite de 10 MiB.
4. Checksum calculado por el servidor.
5. Scanner antivirus aprobado.
6. Cuarentena inaccesible al cliente.
7. Release sólo con `malware=false` y `checksum_verified=true`.
8. Retención y borrado probados.
9. Restauración sin reactivar archivos borrados.

## Gate de publicación

1. Model gate `PASS`.
2. Privacy gate `PASS`.
3. Database canary `PASS`.
4. Analytics canary `PASS`.
5. Documento gate `PASS` o upload explícitamente fuera del release y deshabilitado.
6. UAT de Paco `PASS`.
7. UAT de ENNCO `PASS`.
8. Aprobación explícita de publicación.
9. Configurar `ENNCO_PUBLIC_SURFACE_RELEASED_AT`, `ENNCO_PRIVACY_NOTICE_APPROVED_VERSION` y `ENNCO_PRIVACY_NOTICE_APPROVED_SHA256` con los valores exactos aprobados.
10. `ENNCO_PUBLIC_SURFACE_RELEASED=true` sólo después de los nueve puntos anteriores.

Si cualquier punto falla, regresar a `EXTEND`. Un estado desconocido nunca es `PASS`.
