# M9 Gate Report

Fecha de corte: 2026-08-12, `America/Mexico_City`.

## Veredicto

- Integridad de la captura final local: `PASS`.
- Estado del paquete: `FINAL_FREEZE`.
- Milestone local M9: `EVIDENCE_READY`.
- Gate global M9: `EXTEND`.
- Evidence class: `synthetic_demo`.
- Efectos externos: `0`.
- UAT, capacitación, transferencia de accesos y aceptación final ENNCO: `0`.

Esta es la evidencia final del checkpoint local. No es prueba de producción, aceptación del cliente ni terminación del programa enterprise.

## Captura final local

- Commit fuente: `a84162757b22706915d2aaa2a18e3809dca8569e`.
- Tree SHA: `364d30be41bd200259facf13210ec85e9ce7c69f`.
- Manifest SHA256: `c99b7e0219656a2c3ed47845c936effdd9faa0d9bf11fbfd06cd91acc77533ac`.
- Source archive SHA256: `aa983245a31cc0af19291ca6ad109236ccee81dfa5b78d924f6221efe1b08f83`.
- Audit bundle SHA256: `b96a4b7f71555a15db789792893900be134d4a7dcd1a47ec7759757d946e0d12`.
- Worktree limpio al capturar: sí.
- Control de empaquetado incluido en el commit fuente: sí, ambos SHA256 son `e2d2ddf5eebaf7e9d9f00620e1b817f1026239d503d1f40245b5fe5d5c3df8cc`.

Las precondiciones del freeze quedaron satisfechas. `final_artifact=true` y los seis criterios locales están en `PASS`.

## Source archive

`evidence/m9-handoff/artifacts/ennco-revenue-platform-source.tar` se construye mediante una allowlist explícita desde un commit exacto. No se archiva el worktree.

Contenido exacto de esta captura:

- 220 archivos.
- 301 entradas de tar, incluyendo directorios.
- Código de aplicación allowlisted.
- Configuración root exacta.
- Tests E2E y gates SQL.
- Migraciones y rollbacks.
- Runbooks operativos.
- Tres configuraciones o fixtures de runtime allowlisted después del filtro content-based de identidad.

Cada archivo aparece en el manifest externo con ruta, tamaño y SHA256. El verificador extrae el tar en un directorio temporal, rechaza rutas inseguras, duplicados y symlinks, y compara el inventario real contra la allowlist y el manifest.

## Exclusiones restricted

El source archive no contiene:

- `data/imports/**`, 16 archivos rastreados en el commit fuente.
- `evidence/data-import/**`, 2 archivos.
- `data/prequote/**`, 3 archivos con calibración derivada de propuestas históricas.
- `src/lib/domain/prequote*`, 2 archivos que incorporan supuestos derivados de esa calibración.
- `data/content/**`, 1 archivo de evidencia histórica derivada.
- `docs/evidence/M9*`, 7 archivos.
- `evidence/m9-handoff/**`, 5 archivos.
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
- Archivos regulares inspeccionados: 220 de 220.

No se afirma ausencia universal de PII. Un scanner de patrones no puede probarla. Cualquier transferencia live sigue requiriendo revisión humana de privacidad y un canal restricted separado para los datos excluidos.

## Verificación ejecutable

```bash
npm run test:m9-package
npm run capture:m9-final
npm run verify:m9-readiness
shasum -a 256 -c docs/evidence/M9-checksums.sha256
```

Resultados:

- Negativos fail-closed: 7 de 7 `PASS`.
- Verificación final: 38 de 38 `PASS`.
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

El `EVIDENCE_READY` local no permite declarar producción lista, aceptación del cliente ni programa enterprise terminado.
