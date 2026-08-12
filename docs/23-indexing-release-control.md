# Control de indexación y rastreadores

Snapshot: 12 de agosto de 2026, America/Mexico_City.

## Dictamen

Control local: `PASS`.

REQ-001 completo: `IN_PROGRESS`.

Staging, dominio y publicación: `HOLD`.

Este control corrige la parte técnica de rastreo, canonical y sitemap. No aprueba el mensaje público, el aviso legal, DNS, CDN, despliegue, Search Console ni publicación.

## Rutas

| Ruta | HOLD | Release explícito |
|---|---|---|
| `/diagnostico` | `noindex, nofollow` | `index, follow` |
| `/privacidad` | `noindex, nofollow` | `index, follow` |
| `/` | `noindex, nofollow, noarchive` | Siempre igual |
| `/ingreso/*` | Header privado | Siempre privado |
| `/operacion/*` | Header privado | Siempre privado |
| `/api/*` y PDFs | Header privado | Siempre privado |

El sitemap sólo puede incluir `/diagnostico` y `/privacidad`. La raíz contiene información interna del sistema y por eso no es una página pública indexable.

## Gate de release

La indexación sólo se abre cuando se cumplen simultáneamente:

1. Ambiente `production`.
2. Modo demo desactivado.
3. `ENNCO_PUBLIC_SURFACE_RELEASED=true` exacto.
4. Origen exacto `https://diagnostico.ennco.com.mx`.
5. Fecha ISO de release presente, con máximo cinco minutos de tolerancia futura por desfase de reloj.
6. Aviso de privacidad aprobado.
7. Versión aprobada igual a `2026-08-11-v1`.
8. SHA256 aprobado igual al snapshot canónico del contenido visible: `d4a24f23350d8a3522f75a169938afe7bcd868c9c812b46aadcbc52681fc718e`.

Una variable incompleta, un host distinto, una URL con path, un timestamp futuro, una versión stale o un hash distinto fallan cerrado. El build vuelve a calcular el SHA256 del contenido canónico y aborta si alguien cambia el aviso sin actualizar el snapshot aprobado.

## Revocación

`/privacidad`, `/robots.txt` y `/sitemap.xml` son dinámicos y no se congelan en build. Se probó este recorrido:

1. Construir un artefacto con todos los flags sintéticos de release.
2. Iniciar ese mismo artefacto con `ENNCO_PUBLIC_SURFACE_RELEASED=false`.
3. Confirmar privacidad `noindex, nofollow`.
4. Confirmar `robots.txt` con `Disallow: /`.
5. Confirmar sitemap sin URLs.

Así, regresar a HOLD no depende de generar otro build. La publicación real seguirá requiriendo un release controlado y aprobación explícita.

## Evidencia local

- `src/lib/seo/indexing.ts`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- `next.config.ts`
- `src/lib/runtime/config.ts`
- `src/lib/privacy/notice.ts`
- `src/lib/seo/indexing.test.ts`
- `tests/e2e/indexing.spec.ts`

Verificaciones ejecutadas durante la implementación:

- Unitarias de SEO, runtime, precotización y PDFs: PASS.
- Typecheck: PASS.
- Lint: PASS.
- Build de release sintético: PASS.
- Rutas privadas con `X-Robots-Tag`: PASS.
- Release a HOLD sobre el mismo artefacto: PASS.
- Revisión independiente: PASS local, sin P0 o P1 local reproducible.

## Pendientes para cerrar REQ-001

- Aprobación del mensaje y copy público.
- Aprobación legal de la versión exacta del aviso.
- Staging aislado autorizado.
- Verificación de headers en CDN.
- Verificación read-only de DNS y dominio.
- Crawl real y Search Console, si existe o se aprueba crearla.
- Aprobación explícita antes de publicar.

Hasta entonces, `ENNCO_PUBLIC_SURFACE_RELEASED` debe permanecer `false`.
