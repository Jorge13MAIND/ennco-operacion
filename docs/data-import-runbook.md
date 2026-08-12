# Runbook de importación de fuentes ENNCO

## Propósito

Congelar y normalizar los dos workbooks de arranque sin convertir investigación en contactos, leads o pipeline. La fuente binaria permanece intacta y cada dataset derivado puede rastrearse hasta archivo, hoja, rango, fila y SHA256.

## Dependencias

- Node y `node_modules` entregados por `codex_app__load_workspace_dependencies`.
- `@oai/artifact-tool` 2.8.6 o posterior.
- Acceso de lectura a las dos copias raw versionadas dentro del repositorio.
- Acceso de escritura sólo a `scripts/`, `data/imports/`, `docs/` y `evidence/data-import/`.

No instales otra librería de spreadsheets ni agregues `artifact-tool` al `package.json` de la aplicación.

## Ejecución

Usa el Node y el `node_modules` devueltos por el cargador del workspace. El importador no lee `Downloads` ni ninguna ruta original:

```bash
IMPORT_RUNTIME_DIR="$(mktemp -d /tmp/ennco-import-runtime.XXXXXX)"
ln -s "<loader_node_modules>" "$IMPORT_RUNTIME_DIR/node_modules"
ENNCO_IMPORT_REPO="$(pwd -P)"
"<loader_node>" scripts/import-ennco-sources.mjs \
  --repo "$ENNCO_IMPORT_REPO" \
  --artifact-tool-root "$IMPORT_RUNTIME_DIR/node_modules/@oai/artifact-tool"
"<loader_node>" scripts/verify-data-imports.mjs \
  --repo "$ENNCO_IMPORT_REPO" \
  --write-evidence
```

Las rutas originales aparecen sólo en `original_source_path_metadata`. No son abiertas, verificadas ni necesarias para reproducir la importación.

## Salidas canónicas

- `data/imports/raw/`: copia exacta del XLSX y extracción de valores y fórmulas bajo el hash de la fuente.
- `data/imports/normalized/`: JSON canónico y CSV de intercambio.
- `data/imports/quarantine/`: filas que no pueden usarse operativamente sin revisión humana.
- `data/imports/manifest.json`: hashes, reglas, rutas, conteos y reconciliaciones.
- `data/imports/qa/`: fixtures negativos de seguridad CSV en JSON raw y CSV neutralizado.
- `data/imports/evidence/`: verificación determinista y checksums del paquete vigente.
- `docs/data-import-qa.md`: reporte humano.

## Reglas operativas

- No edites datos raw.
- Un cambio en un workbook produce un nuevo directorio SHA256, no reemplaza silenciosamente la fuente anterior.
- La normalización de capacidad conserva el valor fuente como Wp y deriva kWp dividiendo entre 1,000.
- Los outliers históricos se conservan, pero no calibran el precotizador hasta validación.
- Todos los registros del directorio son `RESEARCH_SEED` y `outreach_eligible=false`.
- Las filas en cuarentena requieren resolución y una nueva importación.
- Antes de habilitar outreach, concilia contra el Anexo A y verifica contactos por separado.
- En CSV, cualquier celda que empiece con `=`, `+`, `-` o `@` debe llevar un apóstrofo inicial. El JSON conserva el valor raw para auditoría.

## Prueba de idempotencia

Ejecuta el importador dos veces y compara el árbol autorizado después de cada corrida:

```bash
ENNCO_IMPORT_REPO="$(pwd -P)"
IMPORT_HASH_A="$(mktemp /tmp/ennco-import-hash-a.XXXXXX)"
IMPORT_HASH_B="$(mktemp /tmp/ennco-import-hash-b.XXXXXX)"
find data/imports -type f ! -path '*/evidence/checksums.sha256' -print0 | sort -z | xargs -0 shasum -a 256 > "$IMPORT_HASH_A"
"<loader_node>" scripts/import-ennco-sources.mjs --repo "$ENNCO_IMPORT_REPO" --artifact-tool-root "$IMPORT_RUNTIME_DIR/node_modules/@oai/artifact-tool"
find data/imports -type f ! -path '*/evidence/checksums.sha256' -print0 | sort -z | xargs -0 shasum -a 256 > "$IMPORT_HASH_B"
diff -u "$IMPORT_HASH_A" "$IMPORT_HASH_B"
```

Salida esperada: `diff` vacío. Un cambio implica drift y bloquea el gate.

## Criterio de aceptación

La importación obtiene `PASS` sólo cuando el verificador confirma hashes, rutas repo-relative, conteos, ventas, unidades, IDs, cuarentena, reimportación CSV, negativos de fórmula y ausencia de elegibilidad comercial. Una fuente raw modificada después del congelamiento hace fallar la verificación y requiere nueva versión.
