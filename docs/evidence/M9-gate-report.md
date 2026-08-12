# M9 Gate Report

Fecha de corte: 2026-08-12, `America/Mexico_City`.

## Veredicto

- Integridad de la captura provisional: `PASS`.
- Estado del paquete: `PROVISIONAL_NOT_FINAL`.
- Milestone local M9: `EXTEND` hasta ejecutar el freeze desde un commit limpio que contenga estos controles.
- Gate global M9: `EXTEND`.
- Evidence class: `synthetic_demo`.
- Efectos externos: `0`.
- UAT, capacitación, transferencia de accesos y aceptación final ENNCO: `0`.

Esta evidencia no es el artefacto final y no debe etiquetarse, compartirse ni usarse como prueba de entrega. Su propósito es demostrar que el empaquetador y el verificador ya fallan cerrado.

## Captura provisional

- Commit fuente: `02f08ed53fc7cb07ce7414ba78a64935c76353e6`.
- Tree SHA: `63617cb63334b0c34f6b98b10a105308841006b1`.
- Manifest SHA256: `c62fd08bea71a58b6304fe04c7e2aec1367373cf73139f96846f2f3db977767d`.
- Source archive SHA256: `2b0c4469d0e8de2d539f4f7a2e0ea049da439e14d9637512c1441d05a48a52bb`.
- Audit bundle SHA256: `ed9087094d590768efc84df6baa274ddf2162164fa7bd539bdc603ba2df92012`.
- Worktree limpio al capturar: no.
- Control de empaquetado incluido en el commit fuente: no, la versión del worktree no coincide con la del commit.

Por estas dos últimas condiciones, `final_artifact=false` y los seis criterios locales permanecen en `EXTEND`, aunque los controles internos del paquete pasen.

## Source archive

`evidence/m9-handoff/artifacts/ennco-revenue-platform-source.tar` se construye mediante una allowlist explícita desde un commit exacto. No se archiva el worktree.

Contenido exacto de esta captura:

- 170 archivos.
- 243 entradas de tar, incluyendo directorios.
- Código de aplicación allowlisted.
- Configuración root exacta.
- Tests E2E y gates SQL.
- Migraciones y rollbacks.
- Runbooks operativos.
- Tres configuraciones o fixtures de runtime allowlisted después del filtro content-based de identidad.

Cada archivo aparece en el manifest externo con ruta, tamaño y SHA256. El verificador extrae el tar en un directorio temporal, rechaza rutas inseguras, duplicados y symlinks, y compara el inventario real contra la allowlist y el manifest.

## Exclusiones restricted

El source archive no contiene:

- `data/imports/**`, 12 archivos rastreados en el commit provisional.
- `evidence/data-import/**`, 2 archivos.
- `data/prequote/**`, 3 archivos con calibración derivada de propuestas históricas.
- `src/lib/domain/prequote*`, 2 archivos que incorporan supuestos derivados de esa calibración.
- `data/content/**`, 1 archivo de evidencia histórica derivada.
- `docs/evidence/M9*`, 7 archivos.
- `evidence/m9-handoff/**`, 4 archivos.
- Ningún otro archivo bajo `evidence/**`.
- 16 archivos allowlisted con identificadores personales u operativos conocidos. Cada path y marker ID aparece en el manifest.

El manifest también lista los demás paths excluidos. El paquete es deliberadamente incompleto para build porque los insumos y el código de precotización derivados de evidencia real quedan fuera. Se trata de un paquete de revisión de fuente con privacidad acotada, no de un bundle productivo desplegable.

## Audit bundle separado

`evidence/m9-handoff/artifacts/m9-audit-bundle.tar` es un tar determinista distinto del source archive. Contiene exactamente cuatro archivos:

- `audit/source-archive-inventory.json`.
- `audit/source-archive-secret-scan.json`.
- `exports/companies-contacts-synthetic.csv`.
- `exports/pipeline-attribution-synthetic.csv`.

No contiene el manifest externo, este reporte, el JSON de verificación ni otro artefacto M9. Por ello no existe evidencia autorreferencial ni una copia stale dentro de los tars.

## Privacidad y secretos

La afirmación verificable es limitada:

- Rutas restricted dentro del source archive: `0`.
- Marcadores conocidos de datos históricos o importados: `0`.
- Hallazgos del scanner de secretos: `0`.
- Identificadores personales u operativos conocidos: `0`.
- Archivos regulares inspeccionados: 170 de 170.

No se afirma ausencia universal de PII. Un scanner de patrones no puede probarla. Cualquier transferencia live sigue requiriendo revisión humana de privacidad y un canal restricted separado para los datos excluidos.

## Verificación ejecutable

```bash
npm run test:m9-package
npm run capture:m9-provisional
npm run verify:m9-readiness
shasum -a 256 -c docs/evidence/M9-checksums.sha256
```

Resultados:

- Negativos fail-closed: 7 de 7 `PASS`.
- Verificación provisional: 38 de 38 `PASS`.
- Source archive reproducido byte a byte desde el commit: `PASS`.
- Audit bundle reproducido byte a byte: `PASS`.
- Checksums externos: 6 de 6 `PASS`.
- Empresas y contactos sintéticos exportan y reimportan: `PASS`.
- Empresa sintética sin contacto se preserva: `PASS`.
- Pipeline sintético reimporta con `NOT_REAL`: `PASS`.
- Restore productivo, RPO 15 minutos y RTO 4 horas: no probados.

Los negativos comprueban rechazo de ruta restricted, referencia M9 dentro del tar, path desconocido, secreto con prefijo reconocido, identidad conocida y determinismo del audit tar.

## Scope del checksum externo

`docs/evidence/M9-checksums.sha256` cubre únicamente:

1. Source archive.
2. Audit bundle.
3. Los dos CSV sintéticos externos.
4. Manifest externo.
5. Verificación JSON.

El gate report, QA review y capturas visuales no están dentro de ese checksum para evitar ciclos o evidencia stale dentro del paquete.

## Orden exacto del freeze final

1. Terminar y revisar todos los cambios de código, manifest, riesgos y controles M9.
2. Correr los gates acumulativos que el responsable de release determine.
3. Commit de código y controles. Este commit será `SOURCE_COMMIT`.
4. Confirmar `git status --porcelain` vacío.
5. Ejecutar `npm run capture:m9-final`. El comando debe abortar si el worktree no está limpio, si `HEAD` no es el commit fuente o si el control actual no coincide con el almacenado en ese commit.
6. Ejecutar `npm run verify:m9-readiness` y el checksum externo sin reempaquetar.
7. Revisar manualmente manifest, inventarios, exclusiones y privacidad.
8. Commit separado de los artefactos externos de evidencia. Este será el commit de evidencia, no el commit fuente.
9. Crear el tag M9 sobre el commit de evidencia sólo después del `PASS` humano.

No se debe regenerar el paquete después del paso 8. Cualquier cambio obliga a regresar al paso 1 con un nuevo commit fuente.

## Bloqueos live

- No existe propiedad de source control verificada por ENNCO.
- No existe transferencia de accesos de producción.
- No existe restore en infraestructura administrada.
- No existe auditoría live de seguridad o privacidad.
- No existe UAT con operador ENNCO.
- No existe capacitación con operador y suplente.
- No existe walkthrough real de runbooks.
- No existe aceptación final.
- Permanecen riesgos P0 y P1 abiertos.

Ningún PASS provisional permite declarar M9 final, producción lista o programa enterprise terminado.
