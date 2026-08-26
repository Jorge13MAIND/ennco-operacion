# M5 Shadow Canary Architecture

## Veredicto

- Harness local acelerado: `PASS`.
- Gate de release: `EXTEND`.
- Efectos externos: `0`.
- Tiempo real observado: `0` días.
- Tiempo simulado: `14` días consecutivos.

El harness demuestra que los contratos y controles responden correctamente a escenarios sintéticos. No demuestra estabilidad operativa durante 14 días reales. Una simulación nunca puede escribir `PASS` como decisión de release.

## Paquete de campaña

El paquete vive en:

- `data/campaigns/sequence-draft-v1.json`.
- `data/campaigns/campaign-manifest-draft-v1.json`.
- `data/campaigns/response-playbook-v1.json`.
- `data/content/anonymous-reference-cards-v1.json`.

Estado: `DRAFT_REVIEW_REQUIRED` y `HOLD`.

La secuencia contiene ocho contactos en días `0, 3, 7, 14, 28, 42, 60, 75`. Cada contacto tiene variantes para dirección, mantenimiento y compras. Son 24 mensajes, todos de menos de 100 palabras y con una sola CTA.

El primer contacto exige una señal observada y su fuente. Si la señal no existe o no está verificada, la cuenta no entra al lote. El paquete tiene cero destinatarios y ningún buzón o dominio real.

## Manifiesto inmutable

El release congela:

1. Remitente, dominio y buzón.
2. Destinatarios.
3. Hash de secuencia.
4. CTA y tracking.
5. Horario, volumen y cadencia.
6. Snapshot de supresión.
7. Stop rules.
8. Kill switches.
9. Aprobaciones.

Una diferencia entre runtime y manifiesto devuelve `HOLD`. El manifiesto actual conserva kill switches activos, envío externo deshabilitado, cero destinatarios y snapshot local del Anexo A. Falta binding e importación en la base aislada.

## Assistant acotado

La política vive en `src/lib/assistant/policy.ts` y se prueba con `data/assistant/eval-cases-v1.json`.

Puede responder únicamente:

- Servicios documentados.
- Insumos iniciales.
- Proceso comercial y técnico.
- Áreas que participan.

Transfiere a Paco o al equipo técnico:

- Garantías y condiciones comerciales.
- Descuentos y precio final.
- Fechas comprometidas.
- Beneficios fiscales.
- Viabilidad y dimensionamiento final.
- Preguntas sin evidencia suficiente.

Rechaza instrucciones para revelar prompts, secretos o cambiar reglas. La suite contiene 22 casos y ejecuta dos corridas completas idénticas. El endpoint permanece cerrado con `ENNCO_ASSISTANT_RELEASED=false`.

## Harness acelerado

El harness cubre:

1. Golden path dry run.
2. Supresión fail closed.
3. Duplicado idempotente.
4. Respuesta que detiene secuencia.
5. Hard bounce con supresión exacta.
6. Baja con supresión exacta.
7. Timeout y retry.
8. Retry agotado a dead letter.
9. Falla de alerta sin pérdida de lead.
10. Kill switch global.
11. Drift del hash del manifiesto.
12. Restore parcial y reconciliación.
13. Estado desconocido que falla cerrado.
14. Carga de 1,100 intentos sobre 1,000 llaves.

Cada día sintético tiene checksum y enlaza el hash del día anterior. El artefacto final declara `time_accelerated_simulation`, `realElapsedDays=0` y `releaseDecision=EXTEND`.

## Persistencia de canary

La migración `202608110007_shadow_canary.sql` crea:

- `shadow_canary_runs`.
- `shadow_canary_days`.
- `shadow_canary_observations`.

Los operadores pueden leer mediante RLS, pero no insertar, editar, finalizar o forjar decisiones. Sólo el rol técnico puede registrar y finalizar un run. El audit log conserva únicamente campos allowlist y hashes, sin mensajes, correos, destinatarios o texto libre.

El evaluador devuelve:

- `KILL` ante P0, efecto externo no autorizado o drift de manifiesto.
- `EXTEND` ante P1, falla, desconocido, reconciliación incompleta, hueco de fecha o menos de 14 días.
- `PASS` sólo para evidencia `live`, ambiente staging, 14 fechas consecutivas, manifiesto idéntico, observaciones completas y cero fallas.

## Bloqueos de release

- 14 días reales no observados.
- Staging administrado no provisionado.
- Proveedores reales no conectados.
- Binding e importación transaccional del Anexo A no ejecutados.
- Dominios y buzones no comprados.
- DNS y reputación no iniciados.
- Copy sin aprobación de Francisco.
- Revisión comercial de Paco aprobada; no autoriza por sí sola el release.
- Aprobación explícita de Jorge ausente.

Ninguno bloquea pruebas locales. Todos bloquean el primer envío.
