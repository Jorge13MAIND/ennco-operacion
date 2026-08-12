# Runbook M2: backup y restore lógico local

## Alcance

Este drill valida que un conjunto lógico de tablas ENNCO y un almacén de objetos sintéticos pueden respaldarse y restaurarse en destinos locales distintos conservando conteos, contenido, checksums e invariantes.

No usa Supabase, Vercel, red externa, credenciales reales, datos personales ni proveedores. No modifica la aplicación ni las migraciones.

## Prerrequisitos

- macOS con PostgreSQL 16 en `/opt/homebrew/bin`.
- `tar`, `shasum`, `mktemp`, `awk` y `cmp`.
- Permiso de escritura en `evidence/m2-restore/`.

## Comando

```bash
bash scripts/m2-local-backup-restore-drill.sh \
  --repo /Users/Jorge/dev/ennco-revenue-platform \
  --evidence-dir /Users/Jorge/dev/ennco-revenue-platform/evidence/m2-restore

bash scripts/m2-verify-restore-evidence.sh \
  --repo /Users/Jorge/dev/ennco-revenue-platform \
  --evidence-dir /Users/Jorge/dev/ennco-revenue-platform/evidence/m2-restore
```

## Flujo

1. Crea un directorio con `mktemp`.
2. Genera dos objetos sintéticos sin PII.
3. Inicializa PostgreSQL desechable.
4. Deshabilita listeners TCP y usa sólo un socket Unix temporal.
5. Crea una base fuente y carga esquema y fixtures sintéticos.
6. Prueba que el audit log rechace actualizaciones.
7. Genera un dump lógico custom con `pg_dump` y un tar de objetos.
8. Restaura en una base y un directorio de objetos distintos.
9. Compara conteos y SHA256 por tabla.
10. Verifica invariantes comerciales, dry run, supresión, idempotencia, outbox y auditoría.
11. Compara los objetos restaurados contra el filesystem y el manifiesto de la base.
12. Detiene y elimina únicamente el clúster temporal validado.

## Evidencia esperada

- `summary.json`: decisión PASS o EXTEND y límites explícitos.
- `database-counts.tsv`: conteos fuente y restore.
- `database-checksums.tsv`: SHA256 del contenido canónico por tabla.
- `invariants-source.tsv` e `invariants-restored.tsv`.
- `object-checksums-source.sha256` y `object-checksums-restored.sha256`.
- `object-database-manifest.tsv`.
- `backup-artifacts.sha256`.
- `artifacts/ennco-m2-logical.dump`.
- `artifacts/ennco-m2-objects.tar.gz`.
- `commands.log`.
- `independent-verification.tsv`: revisión independiente y control negativo de corrupción.

## Criterio PASS

- Dump y archivo de objetos creados.
- Restore en destinos separados.
- Todos los conteos coinciden.
- Todos los SHA256 de tablas coinciden.
- Todos los objetos coinciden.
- El manifiesto de objetos coincide con el filesystem.
- Invariantes fuente y restore son idénticos y verdaderos.
- Audit log rechaza mutación antes y después del restore.
- Cero contacto o mutación externa.

Si cualquier comparación falla, el script termina con código distinto de cero y genera `summary.json` con estado `EXTEND`.

## Seguridad

- Los emails usan exclusivamente `example.invalid`.
- Todos los nombres están marcados como sintéticos.
- Los mensajes están en `dry_run=true` y no tienen identificador de proveedor ni fecha de envío.
- No copies datos reales dentro de los fixtures.
- No ejecutes este script apuntando a una base existente.
