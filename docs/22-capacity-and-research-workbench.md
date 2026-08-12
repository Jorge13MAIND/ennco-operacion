# Capacidad operativa y Research Workbench

Fecha de corte: 2026-08-12.

## Decisión de gate

- Capacidad mensual local: `PASS` en PostgreSQL desechable y aplicación local.
- Research contracts, HTTP, portal y lote de importación: `PASS` local.
- Research database M019: `PASS` en PostgreSQL desechable con forward, concurrencia, rollback fail closed y reapply.
- Inventario real: `EXTEND` hasta ejecutar la carga autorizada de las 27 semillas, resolver cuarentena e investigar hasta 75 empresas y 150 contactos.
- Outreach: `HOLD`. Estos módulos no autorizan destinatarios, mensajes ni campañas.

## Capacidad mensual

La capacidad es una restricción operativa, no una métrica comercial. Sólo una oportunidad `CLOSED_WON` con fecha explícita reserva mes. Un lead, reunión, propuesta o proyecto sin fecha no consume un espacio válido.

La política inicial es:

- Límite: dos proyectos industriales por mes.
- Alerta: desde el primer proyecto.
- Lleno: desde el segundo.
- Exceso: se conserva y se alerta. No se oculta.
- Configuración ausente: `UNKNOWN`.
- Proyecto ganado sin fecha: `UNKNOWN` hasta programarlo.

Cada cambio conserva comando idempotente, versión de configuración, razón, actor, task, outbox y audit log. El portal degrada sólo el módulo a `UNKNOWN` si no puede leer la evaluación o el inventario de reservas.

## Research Workbench

El Workbench convierte investigación en evidencia revisable. No convierte empresas en leads ni inventario en pipeline.

Objetivo del gate:

- 75 cuentas verificadas.
- 150 contactos verificados.
- Guanajuato y Querétaro primero.
- CEO, dirección de planta, mantenimiento y compras.
- Dos contactos por cuenta cuando sea posible.
- Fuente, URL, fecha, confianza, checksum, investigador y revisión.
- Cero duplicados o contradicciones abiertos dentro del snapshot.
- Cero cuarentenas dentro del snapshot.
- Anexo A y supresión reconciliados antes de cualquier uso comercial.

Aunque el gate de investigación llegue a `PASS`, la salida permanece:

```text
outreach_state = RESEARCH_ONLY_HOLD
outreach_eligible_records = 0
```

## Verdad actual

- 27 semillas normalizadas.
- 21 investigables.
- 6 en cuarentena.
- 11 de 27 con URL fuente.
- 0 contactos verificados.
- 0 leads.
- 0 oportunidades derivadas del inventario.
- 0 destinatarios.
- 0 envíos.

El lote canónico se genera desde fuentes repo-relative con `npm run build:research-seed` y se verifica con `npm run verify:research-seed`. Es un artefacto restringido de fuente real. Construirlo no ejecuta el endpoint ni modifica una base externa.

## Gates externos intactos

Permanecen fuera del alcance autónomo:

- Anexo A.
- Contrato ejecutado y certificado BoldSign.
- Compras, DNS, credenciales y proveedores.
- Staging compartido o producción.
- Contacto con ENNCO, prospectos o terceros.
- Primer email y cualquier campaña real.
