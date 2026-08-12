# Runbook de importación de fuentes ENNCO

## Propósito

Congelar y normalizar los dos workbooks de arranque sin convertir investigación en contactos, leads o pipeline. La fuente binaria permanece intacta y cada dataset derivado puede rastrearse hasta archivo, hoja, rango, fila y SHA256.

## Dependencias

- Node y `node_modules` entregados por `codex_app__load_workspace_dependencies`.
- `@oai/artifact-tool` 2.8.6 o posterior.
- Acceso de lectura a los dos archivos fuente.
- Acceso de escritura sólo a `scripts/`, `data/imports/`, `docs/` y `evidence/data-import/`.

No instales otra librería de spreadsheets ni agregues `artifact-tool` al `package.json` de la aplicación.

## Ejecución

Usa un directorio temporal y enlaza el `node_modules` devuelto por el cargador del workspace:

```bash
IMPORT_RUNTIME_DIR="$(mktemp -d /tmp/ennco-import-runtime.XXXXXX)"
ln -s "<loader_node_modules>" "$IMPORT_RUNTIME_DIR/node_modules"
cp scripts/import-ennco-sources.mjs "$IMPORT_RUNTIME_DIR/import-ennco-sources.mjs"
"<loader_node>" "$IMPORT_RUNTIME_DIR/import-ennco-sources.mjs" --repo /Users/Jorge/dev/ennco-revenue-platform
"<loader_node>" scripts/verify-data-imports.mjs --repo /Users/Jorge/dev/ennco-revenue-platform
```

## Salidas canónicas

- `data/imports/raw/`: copia exacta del XLSX y extracción de valores y fórmulas bajo el hash de la fuente.
- `data/imports/normalized/`: JSON canónico y CSV de intercambio.
- `data/imports/quarantine/`: filas que no pueden usarse operativamente sin revisión humana.
- `data/imports/manifest.json`: hashes, reglas, rutas, conteos y reconciliaciones.
- `docs/data-import-qa.md`: reporte humano.
- `evidence/data-import/verification.json`: checks ejecutables.
- `evidence/data-import/checksums.sha256`: checksums de todo el paquete.

## Reglas operativas

- No edites datos raw.
- Un cambio en un workbook produce un nuevo directorio SHA256, no reemplaza silenciosamente la fuente anterior.
- La normalización de capacidad conserva el valor fuente como Wp y deriva kWp dividiendo entre 1,000.
- Los outliers históricos se conservan, pero no calibran el precotizador hasta validación.
- Todos los registros del directorio son `RESEARCH_SEED` y `outreach_eligible=false`.
- Las filas en cuarentena requieren resolución y una nueva importación.
- Antes de habilitar outreach, concilia contra el Anexo A y verifica contactos por separado.

## Criterio de aceptación

La importación obtiene `PASS` sólo cuando el verificador confirma hashes, conteos, ventas, unidades, IDs, cuarentena y ausencia de elegibilidad comercial. Una fuente modificada después del congelamiento hace fallar la verificación y requiere nueva versión.
