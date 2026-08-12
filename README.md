# ENNCO Revenue Platform

Sistema comercial E2E de ENNCO. Este repositorio contiene la experiencia pública, el portal operativo, los contratos de datos, las migraciones y los controles de liberación.

## Estado

- M0: paquete interno completo y auditado. Gate global `EXTEND` por insumos externos faltantes.
- M1: golden path local `PASS` con datos sintéticos y cero efectos externos.
- Producción, DNS, compras y contacto externo: bloqueados hasta aprobación explícita.

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npm run dev
```

`ENNCO_DEMO_MODE=true` permite datos sintéticos exclusivamente en desarrollo. Producción falla si no existe un proyecto Supabase dedicado.

## Verificación

```bash
npm run verify:m0m1
```

Este comando valida:

- Cobertura RTM de 47 de 47 puntos del checklist.
- Integridad de los dos XLSX y 28 controles de normalización.
- Migración e invariantes en PostgreSQL desechable.
- Supresión, idempotencia, audit log, outbox, retry, dead letter y kill switches.
- Lint, tipos, 13 pruebas unitarias y build de producción.
- 30 pruebas E2E en cinco perfiles de viewport.

## Operación local

1. Ejecuta `npm install`.
2. Copia `.env.example` como `.env.local`.
3. Confirma que `ENNCO_ALLOW_EXTERNAL_SEND=false` y `ENNCO_GLOBAL_KILL_SWITCH=true`.
4. Ejecuta `npm run dev`.
5. Abre `http://localhost:3000/operacion`.
6. Ejecuta el golden path. Debe mostrar ocho etapas, cero efectos externos y estado `COMPLETED`.
7. Repite con la misma llave. Debe mostrar `DUPLICATE`.

El endpoint sintético devuelve 404 en producción. El assistant devuelve 503 hasta su release gate. La precotización usa exclusivamente un modelo draft y datos sintéticos.

## Bloqueos humanos visibles

- Anexo A recibido, conciliado y hasheado.
- PDF ejecutado del contrato y certificado BoldSign archivados.
- Evidencia de primer pago y constancia de inicio acumulativa.
- Aprobación de compras, dominios, DNS, credenciales, producción y primer envío.
- Validación técnica de Paco para cualquier modelo de precotización.

Ninguno bloquea el trabajo interno seguro. Todos bloquean la acción externa que les corresponde.

## Fuentes de verdad

- GitHub: implementación y evidencia técnica.
- Portal ENNCO: roadmap, riesgos, decisiones y aceptación.
- PostgreSQL: verdad comercial y atribución.

No se reportan contactos, aperturas, invitaciones ni automatizaciones como pipeline o revenue.
