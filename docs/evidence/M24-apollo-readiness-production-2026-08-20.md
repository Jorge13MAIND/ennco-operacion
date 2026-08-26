# Evidencia M24. Preparación Apollo y corte productivo

Fecha: 20 de agosto de 2026  
Estado global: `EXTEND`  
Efectos externos Apollo: 0  
Destinatarios reales: 0  
Envíos reales: 0

## Resultado

La plataforma quedó preparada para recibir una API key de Apollo sin que su ausencia bloquee el resto del sistema. La integración disponible es exclusivamente de lectura y conserva el estado comercial en `HOLD`.

## Verificación local

- `npm run verify:m24`: PASS.
- Vitest: 59 archivos, 274 pruebas, 0 fallas.
- TypeScript: PASS.
- ESLint: PASS.
- Next.js production build: PASS.
- Superficie API: 26 rutas implementadas, 2 contratos diferidos, 28 totales.
- Contrato Apollo sintético: PASS y fail closed.
- Negativo sin `APOLLO_API_KEY`: PASS, exit 2 y cero evidencia escrita.
- Secret scan: 605 archivos, 0 hallazgos.

## Base administrada

- Proyecto Supabase: `isnzaoifdjtwnugupidj`.
- Migraciones remotas verificadas: M001 a M028 alineadas.
- Dry run M028: una sola migración pendiente.
- Aplicación M028: PASS.

## Despliegue

- Proyecto: `ennco-operacion`.
- Deployment: `dpl_6FmGvjXP2ETpKirbLAsRZzLi5or5`.
- Target: production.
- Estado: READY.
- Alias: `https://ennco-operacion.vercel.app`.
- Endpoint nuevo: `POST /api/v1/operations/infrastructure/provider/snapshot`.
- Negativo sin sesión/origen: HTTP 403, sin mutación.
- Portal sin sesión: HTTP 307 a `/ingreso?reason=auth`.

## Estado de seguridad posterior al despliegue

```json
{
  "status": "ok",
  "environment": "production",
  "evidence_class": "live",
  "external_send_allowed": false,
  "global_kill_switch": true
}
```

## Bloqueos honestos

- Compra Apollo aún en curso por Paco.
- API key todavía no cargada como secreto.
- Usuario efectivo, plan, créditos y buzones no verificados contra Apollo real.
- Dos dominios y cuatro buzones todavía no observados por la plataforma.
- Warmup real: 0 de 42 días observados.
- No existe aprobación ni manifiesto para envío real.
