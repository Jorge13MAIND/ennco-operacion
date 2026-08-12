# Reglas del repositorio ENNCO

- Español de México para copy y documentación de cliente.
- No desplegar, comprar, modificar DNS ni contactar prospectos sin aprobación explícita.
- Producción debe fallar cerrado si faltan Supabase dedicado, supresiones, campaign manifest o kill switch.
- No guardar secretos ni datos personales en logs, fixtures o commits.
- No reutilizar tablas, bots, tokens o proyectos de otros clientes.
- Toda mutación externa requiere idempotency key y audit log.
- Un lead, reunión u oportunidad sólo cuenta con evidencia y criterios completos.
- Antes de declarar listo: lint, typecheck, unitarias, build, E2E, visual y evidencia.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
