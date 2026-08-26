# M29. Salida híbrida acelerada

Fecha del control local: 25 de agosto de 2026.

Estado global: `EXTEND`.

Estado del control local: `EVIDENCE_READY`.

Estado de salida real: `HOLD`.

## Decisión vigente

M29 sustituye la topología de cuatro buzones nuevos como condición única de lanzamiento. La nueva topología tiene dos carriles independientes:

1. `contacto@ennco.com.mx` usa Gmail API para un canary Tier 1 de máximo cinco empresas y una rampa limitada por evidencia.
2. Tres buzones en `enncoindustrial.com` y `enncoenergia.com` permanecen 42 días sin prospectos y construyen el canal escalable.

Apollo se usa para investigación y para operar la infraestructura aislada. Apollo no autoriza el carril Gmail y no es la fuente canónica de supresión, releases, leads o atribución.

Teckel administra Vercel, Supabase, Apollo y la operación por decisión de Jorge. Esto no elimina separación de ambientes, MFA, recuperación, export, restore o trazabilidad.

## Carril primario

La dirección exacta es `contacto@ennco.com.mx` con nombre visible `Francisco Cuellar`.

El dominio principal sólo queda elegible cuando existe evidencia live de:

- antigüedad mínima de 180 días;
- actividad humana previa del buzón;
- SPF, DKIM, DMARC y TLS completos;
- seeds en Gmail, Outlook y Yahoo;
- blocklist limpia;
- OAuth con permisos mínimos;
- reply sync menor o igual a 300 segundos;
- Anexo A conciliado;
- identidad sin ambigüedad;
- manifiesto exacto por cinco destinatarios.

La rampa es automática y fail closed:

| Entregas válidas | Cap diario |
|---:|---:|
| 0 a 19 | 5 |
| 20 a 49 | 10 |
| 50 a 99 | 15 |
| 100 o más | 20 |

Una queja o un rebote duro dentro de las primeras 20 entregas mata el carril. Después de 20 entregas, rebote duro de 2 por ciento o más, entrega menor a 95 por ciento, reply sync vencido, SLA positivo incumplido, supresión desconocida o deriva entre proveedor y ledger lo pausan.

## Carril aislado

Los tres buzones aprobados son:

- `francisco@enncoindustrial.com`
- `fcuellar@enncoindustrial.com`
- `francisco@enncoenergia.com`

`fcuellar@enncoenergia.com` queda diferido hasta revisar 100 entregas válidas. Ningún buzón aislado puede enviar prospectos antes de completar 42 días de warmup y todos sus gates live.

## Inventario

El mínimo de lanzamiento permanece en 75 empresas y 150 contactos verificados. La meta operativa es 150 empresas y 300 contactos, con 50 Tier 1 y 250 Tier 2. El inventario no se cuenta como lead ni como pipeline.

## Contrato de base

La migración `202608250029_hybrid_accelerated_outbound.sql` agrega:

1. Rutas de elegibilidad por buzón.
2. Observaciones acumulativas e idempotentes que no permiten ocultar quejas o rebotes.
3. Release inmutable por buzón, campaña, hashes y destinatarios exactos.
4. Un contacto por cuenta, máximo tres touches y verificación de 30 días.
5. Texto plano menor a 100 palabras, sin enlace ni adjunto en el primer touch.
6. Autorización efectiva separada de que Apollo aparezca activo.
7. Read model con mínimo 75/150 y meta 150/300.
8. RLS, AAL2, DML directo revocado, rollback fail closed y prueba concurrente.

El cliente `src/lib/gmail/outbound-client.ts` prepara el transporte `users.messages.send` para el primer contacto del carril acelerado. Sólo acepta `Francisco Cuellar <contacto@ennco.com.mx>`, texto plano menor a 100 palabras, sin ligas y con autorización live ligada a release, mensaje, manifiesto y kill switch apagado. No tiene ruta pública ni credenciales persistidas y todavía no está conectado a un broker OAuth y KMS productivo.

## Estado real al congelar

- `contacto@ennco.com.mx`: acceso conocido, pero DKIM, seeds, OAuth, historial humano, blocklists y reply sync aún no tienen evidencia live en la plataforma.
- Dominios aislados: compra y DNS no verificados.
- Buzones aislados: no provisionados ni calentando.
- Anexo A: paquete local congelado, aplicación productiva por confirmar.
- Contrato: firmado y archivado. No es blocker.
- Operador: Teckel. No existe operador suplente ENNCO y no se inventará uno.
- Destinatarios inscritos: 0.
- Mensajes reales enviados por M29: 0.
- Kill switch: debe permanecer activo hasta el release exacto.

## Evidencia local

```bash
npm run verify:hybrid-outbound-db
npm test -- --run src/lib/infrastructure/hybrid-outbound.test.ts src/lib/operations/portal.test.ts
npm run typecheck
npm run lint
```

Un PASS local demuestra el contrato y sus negativos. No demuestra DNS, inbox placement, OAuth, warmup, destinatarios ni envío real.
