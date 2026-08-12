# Decision Register

Snapshot: 2026-08-11 20:38 CST.

Estados permitidos para este registro:

- `VERIFIED`: la decision tiene autoridad y evidencia local suficiente.
- `UNKNOWN`: la decision de diseño existe, pero falta una comprobacion o condicion externa.
- `BLOCKED`: no puede ejecutarse sin un insumo, acceso o aprobacion fuera del workspace.
- `SUPERSEDED`: una decision posterior sustituyo expresamente a la anterior.

| ID | Decision | Estado | Autoridad o evidencia | Efecto operativo | Revisitada en |
|---|---|---|---|---|---|
| DEC-001 | AVA puede decidir producto, arquitectura, QA y release interno sin microaprobaciones durante esta ejecucion | VERIFIED | Delegacion vinculante del 11-ago-2026 | Permite construir, corregir y auditar localmente sin contactar terceros | Si Jorge revoca o modifica la delegacion |
| DEC-002 | Contacto externo, compras, DNS, credenciales y produccion permanecen prohibidos | VERIFIED | Delegacion vinculante y `AGENTS.md` | Todo intento externo debe devolver `HOLD` | Antes de cualquier checkpoint externo |
| DEC-003 | ENNCO usa un repositorio y una plataforma aislados | VERIFIED | Plan aprobado, ADR 0001 y repositorio actual | Prohibe tablas, bots, tokens y proyectos compartidos | M2, al crear cuentas ENNCO |
| DEC-004 | El golden path sintetico precede assistant, WhatsApp y refinamientos no criticos | VERIFIED | Plan aprobado y ADR 0002 | La primera prueba funcional cubre empresa a siguiente accion | M1 PASS |
| DEC-005 | Toda accion externa falla cerrada | VERIFIED | Plan aprobado, ADR 0003 y Campaign Governance | Sin supresion, manifest, salud o aprobacion el estado es `HOLD` | Cada release |
| DEC-006 | `ENNCO_ALLOW_EXTERNAL_SEND=false` y `ENNCO_GLOBAL_KILL_SWITCH=true` son defaults obligatorios | VERIFIED | Campaign Governance | Un ambiente incompleto no puede enviar | M6 |
| DEC-007 | GitHub, portal y PostgreSQL son las fuentes de verdad para implementacion, operacion y datos comerciales | VERIFIED | Program Charter y plan aprobado | Chat, correo y reuniones son evidencia de entrada, no registros canonicos | UAT M4 |
| DEC-008 | Un lead solo cuenta con los cinco criterios contractuales y evidencia completa | VERIFIED | Contrato fuente, clausula 6.1 | La ambiguedad produce `DOES_NOT_COUNT` | Reporte mensual |
| DEC-009 | Actividad, pipeline y revenue se reportan por separado | VERIFIED | Plan aprobado | Opens, clics, holds y reuniones no realizadas no son resultados comerciales | Cada reporte |
| DEC-010 | Francisco Cuellar, CEO, es el remitente y la voz es personal, breve y CEO a CEO | VERIFIED | Correccion directa de Jorge y transcripts | La secuencia no puede usar otra firma sin nueva version | Aprobacion de copy |
| DEC-011 | No se automatizan garantias, descuentos, precio final ni fechas comprometidas | VERIFIED | Correccion directa de Jorge y plan aprobado | El sistema transfiere estos temas a Paco | Evals del assistant |
| DEC-012 | Los casos publicos permanecen anonimos y MEST queda fuera | VERIFIED | Correccion directa de Jorge | QA debe detectar nombres propios de clientes y referencias MEST | M3 y M9 |
| DEC-013 | El Anexo A debe existir, conciliarse y congelarse antes de cualquier comunicacion | BLOCKED | Contrato, clausula 5; no existe archivo local al snapshot | Bloquea M0 PASS y todo envio | Al recibir Anexo A |
| DEC-014 | El contrato ejecutado y el certificado BoldSign deben archivarse localmente | BLOCKED | Chat afirma firma; el unico PDF local conserva placeholders | El hecho comercial puede anotarse, pero la evidencia ejecutada no esta cerrada | Al recuperar ambos archivos |
| DEC-015 | La fecha exacta de firma no se considera verificada | UNKNOWN | Handover reporta 10-ago 11:42; chat reporta "Ya esta firmado" el 11-ago 13:35 | No se fija el reloj contractual sin documento ejecutado y constancia de inicio | M0 |
| DEC-016 | El reloj de doce semanas inicia solo al cumplirse acumulativamente firma, primer pago y entregables de clausula 7 | VERIFIED | Contrato fuente, clausulas 3 y 7 | Las fechas nominales no sustituyen la constancia de inicio | Anexo E |
| DEC-017 | El primer envio ocurre como minimo 35 dias despues de autenticar por completo los dominios y solo con canary PASS | VERIFIED | Plan aprobado | La fecha nominal puede moverse; el gate manda | M6 |
| DEC-018 | Se planean dos dominios y cuatro buzones, pero no se asume disponibilidad, compra ni propiedad | UNKNOWN | Plan aprobado; no hubo consulta de registrador ni compra autorizada | BOM y roadmap deben mantenerlos como pendientes | Checkpoint de compra |
| DEC-019 | Supabase con PITR, Vercel, Gmail API, KMS, Resend, Sentry y Checkly son defaults, no contratos aprobados | UNKNOWN | BOM local | Ningun SLO dependiente se declara cumplido antes de aprobar cuenta, region, DPA y costo | M2 y M4 |
| DEC-020 | RPO de 15 minutos solo aplica con PITR y backup independiente de Storage | UNKNOWN | NFR/SLO y BOM | Sin proveedor aprobado se documenta un RPO degradado | Restore drill M2 |
| DEC-021 | Las credenciales visibles en chats no se leen, copian ni reutilizan durante esta ejecucion | BLOCKED | Delegacion y Risk Register | Rotacion y vault quedan como checkpoint humano antes de produccion | M2 externo |
| DEC-022 | El modelo publico de precotizacion permanece deshabilitado hasta tener fuentes vigentes y validacion de Paco | BLOCKED | Risk Register y plan aprobado | Se permite fixture sintetico, no precio comercial publicado | M3 checkpoint |
| DEC-023 | Staging puede existir a 0% solo si es aislado, no compartido y sin trafico externo | VERIFIED | Delegacion vinculante | Permite pruebas internas sin autorizar publicacion | M1 y M5 |
| DEC-024 | El assistant y WhatsApp Cloud API no bloquean el primer correo | VERIFIED | Orden de desarrollo aprobado | Se construyen despues del nucleo comercial | M4 en adelante |
| DEC-025 | El Control Room es la vista operativa del cliente; GitHub sigue siendo la evidencia tecnica | VERIFIED | Plan aprobado | Evita tableros duplicados y estados manuales contradictorios | UAT M4 |
| DEC-026 | No se garantiza una venta; se garantizan controles, evidencia y medicion honesta | VERIFIED | Contrato y plan aprobado | La meta de leads se reporta con denominadores y limites | Reporte mensual |
| DEC-027 | El modelo industrial se publica como rango extrapolado mientras no exista histórico entregado de 100 kWp o más | VERIFIED | Auditoría de 20 proyectos y cuatro propuestas | Prohíbe presentar la banda como precio final o calibración industrial observada | Aprobación de modelo M3 |
| DEC-028 | El aviso `DRAFT-2026-08-11` no habilita producción | VERIFIED | Runtime fail closed y gate legal | `ENNCO_PUBLIC_SURFACE_RELEASED` no puede activarse sin aviso aprobado | Revisión legal M3 |
| DEC-029 | La analítica pública usa allowlist y rechaza PII | VERIFIED | Migración 005 y gate adversarial | No se aceptan propiedades libres, correo, nombre, teléfono, empresa ni UTM libre | Canary M3 |
| DEC-030 | Gmail push entrega un cursor y nunca se trata como mensaje completo | VERIFIED | Documentación oficial Gmail y arquitectura M4 | El worker usa history.list, pagina y hace full sync ante 404 | Canary M4 |
| DEC-031 | La respuesta positiva exige revisión humana y no cuenta como lead contractual | VERIFIED | Migración 006 y gate adversarial | La revisión crea CAPTURED; otra transición exige cinco criterios y evidencia | UAT M4 |
| DEC-032 | Los exports live son privados, llevan checksum y dejan audit run | VERIFIED | API y migración 006 | Un CSV sintético siempre está vacío y etiquetado | UAT M4 |
| DEC-033 | Gmail, Pub/Sub y mutaciones operativas permanecen cerrados en demo | VERIFIED | Runtime y pruebas E2E M4 | La interfaz puede probarse sin crear datos ni efectos externos | Staging M4 |
| DEC-034 | Un canary acelerado puede aprobar el harness local pero nunca el release | VERIFIED | Delegación AVA, plan aprobado y migration 007 | Evidencia sintética fuerza EXTEND; PASS exige 14 días live en staging | M5 |
| DEC-035 | El assistant inicial es determinista y sólo responde intenciones documentadas | VERIFIED | Transcripts, límites vinculantes y eval suite | Unknown, comercial, legal y técnico escalan; prompt injection se rechaza | M5 |
| DEC-036 | Los 24 mensajes permanecen DRAFT_REVIEW_REQUIRED y el manifest en HOLD | VERIFIED | Campaign package M5 | Ningún copy, destinatario, buzón o volumen queda autorizado por existir en código | M5 |
| DEC-037 | Las referencias anónimas no son casos de éxito hasta verificar outcome y permiso | VERIFIED | Histórico, propuestas y corrección de Jorge | Publicación bloqueada y outcome false | M5 |
| DEC-038 | M6 usa 30 gates live exactos y ningún `PASS_LOCAL` habilita correo | VERIFIED | Migración 008 y paquete de readiness | Una prueba local puede validar el control, pero release permanece `EXTEND` | M6 |
| DEC-039 | El primer lote contiene exactamente cinco cuentas y congela destinatario buzón secuencia y hashes | VERIFIED | Migración 008 y gate PostgreSQL | Cualquier deriva posterior bloquea la cola | M6 |
| DEC-040 | La aprobación explícita de primer envío es append-only y debe coincidir con actor campaña y hash | VERIFIED | Migración 008 y prueba adversarial | Una autorización genérica o editada no cuenta | M6 |
| DEC-041 | Falta de datos de Postmaster se conserva como `UNKNOWN` | VERIFIED | Guías oficiales Gmail y diseño fail closed | Un dashboard vacío nunca se convierte en señal verde | M6 |
| DEC-042 | Cada ola exige 24 horas live y no puede superar 25 destinatarios ni duplicar el volumen valido previo | VERIFIED | Migracion 009 y gate PostgreSQL | Mala conversion nunca se compensa dañando reputacion | M7 |
| DEC-043 | Queja, doble entrega, violacion de supresion o P0 matan la ola | VERIFIED | Contrato de salud M7 | Un riesgo critico no puede degradarse a simple extension | M7 |
| DEC-044 | T0 nace exactamente en 100 primeras entregas validas y es append-only | VERIFIED | Plan aprobado y migracion 009 | Antes de T0 cualquier forecast permanece escenario | M7 |
| DEC-045 | Una oportunidad cuenta en T0 sólo desde `QUALIFIED` y con los siete campos estrictos | VERIFIED | Plan aprobado y prueba de transiciones | Actividad y reuniones no inflan pipeline | M7 |
| DEC-046 | El mes contractual requiere evidencia live `OPERATING` para cada día calendario | VERIFIED | Plan aprobado y migración 010 | Un día faltante o desconocido impide cerrar el mes | M8 |
| DEC-047 | Leads de email y precotización suman a la meta pero conservan denominadores separados | VERIFIED | Definición contractual y modelo 010 | La captación no infla la conversión outbound | M8 |
| DEC-048 | Un reporte se emite sólo con aprobación de Jorge ligada a ID y hash | VERIFIED | Migración 010 y gate adversarial | Evidencia lista no equivale a reporte emitido | M8 |
| DEC-049 | La recuperación sigue diagnóstico fijo y permite una sola variable activa | VERIFIED | Plan de recuperación y migración 010 | Volumen no existe como variable experimental | M8 |

## Jerarquia de evidencia

Cuando dos fuentes se contradicen, se aplica este orden:

1. Documento ejecutado y anexos firmados.
2. Instruccion directa posterior de Jorge o delegacion vinculante.
3. Contrato fuente y plan aprobado.
4. Transcripts fechados.
5. Chats de WhatsApp.
6. Handover historico.

Una fuente de menor nivel nunca convierte un dato contradictorio en `VERIFIED`.

## Reglas de mantenimiento

- Cada cambio agrega una fila o marca una decision como `SUPERSEDED`; no se borra historia.
- Una decision `UNKNOWN` no habilita gasto, produccion ni contacto.
- Una decision `BLOCKED` debe incluir el artefacto exacto que la desbloquea.
- El registro se revisa en cada gate y despues de cualquier cambio material de arquitectura, alcance o campaña.
