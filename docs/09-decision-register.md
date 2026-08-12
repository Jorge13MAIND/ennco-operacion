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
