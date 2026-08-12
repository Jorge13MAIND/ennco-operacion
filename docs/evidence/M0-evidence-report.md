# M0 Evidence Report

Audit snapshot: 2026-08-11 20:38 CST.

## Veredicto

`EXTEND`

El paquete documental M0 existe y permite continuar trabajo interno. El gate M0 no puede marcarse `PASS` porque faltan el Anexo A, la copia ejecutada del contrato, el certificado de firma y la constancia canónica de inicio. El repositorio tampoco tiene un primer commit, por lo que aun no existe un baseline Git inmutable.

No se contacto a terceros, no se usaron credenciales, no se compro infraestructura, no se modifico DNS y no se desplego.

## Baseline de fuentes

| Fuente | SHA256 | Estado | Resultado |
|---|---|---|---|
| Handover 11-ago | `d9cf4d76d8ae0928d9580895cc38caadafe6e1104dd30b46785f4a78d10e577d` | VERIFIED | Fuente historica completa; contiene estados que fueron sustituidos por evidencia posterior |
| Transcript 5-ago | `bd48a67c29846e4731e79980136824796ce2efd77d02b9dfef49daf44fefdc8d` | VERIFIED | Fuente local presente |
| Transcript 3-ago | `7e6c78370aec06f70c02ba07b56fdc3af72a9725de4fbcd644f95dd1888c2f9d` | VERIFIED | Fuente local presente |
| Chat plataforma ENNCO x Teckel | `cdecf92f47004bbd647e63107ea1ca4a96a58ecc5d0924d19698b46ac4f851b6` | VERIFIED | 15 referencias de adjuntos y 15 archivos presentes |
| Chat Paco Orozco | `09fd696d33c994945b1375a2d8950cd436ad1308606064d4adafeb513a23b3c4` | VERIFIED | 24 referencias de adjuntos y 24 archivos presentes |
| Contrato fuente | `28d6c6a2bf7a0704c82b946206fcc1e24324896910509a97decf1fbca5054fe0` | VERIFIED | PDF fuente de 13 paginas, A4, sin cifrado y sin formulario |
| Historico `clientes....xlsx` | `8bc5d60d1c90259e039480f7ea4408532408e8670c72658eb6b369b5359088ac` | VERIFIED | Fuente local congelada por hash; la normalizacion ocurre en M2 |
| Directorio corredor | `3cc14f924014e0be31cc4db1b9daca52850e5a07d189c4825771de9e997f7347` | VERIFIED | Fuente local congelada por hash; no se considera pipeline |

Material adicional encontrado:

- `Material Grafico 2`: 7 archivos, 6 JPG y 1 MP4.
- `Material Grafico ENNCO`: 26 archivos, 1 AI, 4 HEIC, 11 JPG, 2 MP4 y 8 PDF.
- Nueve documentos duplicados entre el export de plataforma y la raiz de Downloads tienen SHA256 identico. No son nueve versiones nuevas.
- Los dos exports de WhatsApp no presentan adjuntos referenciados faltantes.

## Auditoria del contrato y anexos

| Control | Estado | Evidencia |
|---|---|---|
| PDF fuente legible | VERIFIED | `pdfinfo`: 13 paginas, A4, `Form: none`, `Encrypted: no` |
| Pagina de firmas renderizada | VERIFIED | El render de pagina 13 es legible y sin defectos visuales relevantes |
| Firmas dentro del PDF local | BLOCKED | Pagina 13 muestra `{{sign...}}` y `{{date...}}` para ambas partes |
| Afirmacion de firma | VERIFIED como mensaje, no como documento | Chat de Paco, linea 138: "Ya esta firmado" el 11-ago a las 13:35 |
| Copia ejecutada local | BLOCKED | Busqueda por nombre no encontro PDF ejecutado ni firmado |
| Certificado o audit trail BoldSign | BLOCKED | No existe archivo local encontrado |
| Anexo A | BLOCKED | No existe archivo local encontrado; el contrato lo exige antes del primer contacto |
| Anexo E o constancia de inicio | BLOCKED | No existe archivo local encontrado |
| Condiciones del reloj | VERIFIED | Clausula 3 exige firma, primer pago y entregables de clausula 7 de forma acumulativa |
| Fecha exacta de firma | UNKNOWN | Handover y chat no prueban el mismo timestamp; debe resolverse con el certificado |
| Fecha de inicio contractual | UNKNOWN | No se puede fijar sin Anexo A, evidencia de pago y constancia de accesos/insumos |

Conclusion: el contrato comercial puede estar firmado, pero el paquete probatorio local no esta cerrado. No debe afirmarse lo contrario en un gate.

## Estado de artefactos M0

| Artefacto | Estado | Evidencia positiva | Gap |
|---|---|---|---|
| Program Charter | VERIFIED | Objetivo, restricciones, fuentes de verdad y entrega definidos | La entrega final permanece futura, correctamente no declarada |
| RTM | UNKNOWN | 27 requisitos, 18 P0, 9 P1, cero IDs duplicados y cero campos obligatorios vacios | No demuestra cobertura uno a uno del checklist de 47 puntos ni de todos los controles del plan; requiere reconciliacion antes de M0 PASS |
| RACI | UNKNOWN | Responsabilidades principales documentadas | No incorpora la delegacion AVA para staging aislado y release interno; mantiene aceptaciones anteriores a la delegacion |
| Risk Register | UNKNOWN | 12 riesgos, controles P0/P1 y responsables | Debe incorporar falta de ejecutado/certificado, cobertura RTM, baseline Git y dependencia de evidencias de inicio |
| Bill of Materials | UNKNOWN | Proveedores default, propiedad ENNCO, gates y fallbacks definidos | Sin estado por fila, precio vigente, region, DPA, retencion, limites o validacion de cuenta existente |
| NFR y SLO | VERIFIED como objetivo | Confiabilidad, seguridad, performance y error budget definidos | RPO de 15 minutos sigue condicionado a compra y restore |
| Threat Model v0.1 | VERIFIED para M0 | Activos, limites de confianza y amenazas principales presentes | Diagrama real, inventario de tratamiento y proveedor quedan correctamente para M2 |
| Campaign Governance | VERIFIED | Manifest, stop rules, kill switch y defaults fail closed definidos | No autoriza envio y no necesita hacerlo en M0 |
| Definition of Enterprise Ready | VERIFIED | Incluye pruebas, seguridad, restore, SLO, canary, UAT y evidencia | Ningun componente alcanza aun esta definicion |
| Decision Register | VERIFIED | Decisiones, jerarquia de evidencia, estado y condiciones de revision documentadas | Debe mantenerse en cada gate |

## Gaps P0

1. `P0-EXT-001 Anexo A`: no existe archivo local aceptado y hasheado. Desbloqueo: archivo recibido, normalizado, conciliado y con aceptacion registrada.
2. `P0-EXT-002 Contrato ejecutado`: el PDF local no contiene firmas. Desbloqueo: PDF ejecutado y certificado BoldSign archivados, hasheados y vinculados al registro de inicio.
3. `P0-GOV-001 RTM incompleta`: 27 filas no prueban cobertura del checklist de 47 puntos ni de todos los controles aprobados. Desbloqueo: matriz reconciliada con cobertura o justificacion explicita de cada fuente.
4. `P0-GOV-002 Autoridad desactualizada`: el RACI no refleja la delegacion AVA para decisiones internas y staging aislado. Desbloqueo: actualizar aceptacion interna sin ampliar permisos externos.
5. `P0-SEC-001 Credenciales expuestas`: el riesgo esta documentado y no se uso ninguna credencial. Desbloqueo para M2/produccion: rotacion comprobada y vault ENNCO.

Los P0 externos no detienen golden path, fixtures, pruebas, documentos o staging local aislado. Todos bloquean contacto o produccion segun corresponda.

## Gaps P1

1. `P1-CFG-001 Baseline Git`: el repositorio esta en `main`, no tiene `HEAD` y todos los archivos aparecen untracked. Debe crearse un primer commit despues de reconciliar cambios concurrentes.
2. `P1-BOM-001 BOM no cotizado`: no hay precio, region, DPA, retencion, limite o estado verificado por proveedor. No autoriza compras.
3. `P1-RISK-001 Cobertura de riesgos`: el registro no incluye aun la ausencia de evidencia ejecutada, el baseline Git ni la inconsistencia del reloj.
4. `P1-DATA-001 Conflicto de calidad`: el handover llama verificadas a las 27 empresas; la auditoria posterior identifica cinco por verificar y un posible duplicado. El directorio debe entrar a M2 como semilla no contactable.
5. `P1-SOURCE-001 Handover historico`: declara estados posteriores ya refutados o modificados. Debe conservarse como fuente, no como snapshot actual.

## Criterio para M0 PASS

M0 puede emitir `PASS` solo cuando existan, como minimo:

- PDF ejecutado y certificado de firma con SHA256.
- Anexo A aceptado, conciliado y con SHA256.
- Constancia de inicio que identifique firma, pago e insumos de clausula 7.
- RTM reconciliada contra contrato, checklist, transcripts, correcciones y plan.
- RACI alineado con la delegacion vigente.
- Risk Register actualizado.
- BOM con `VERIFIED`, `UNKNOWN` o `BLOCKED` por fila.
- Primer commit y tag de baseline despues de integrar el trabajo concurrente.

Hasta entonces, el estado correcto es `EXTEND`, no `PASS` ni `KILL`.

## Comandos ejecutados y resultados

| Proposito | Comando | Resultado |
|---|---|---|
| Reglas del repositorio | `sed -n '1,240p' AGENTS.md` | Restricciones confirmadas |
| Inventario M0 | `rg --files docs` y `sed` de `docs/00` a `docs/08` | 9 artefactos M0 y 3 ADR presentes al inicio del audit |
| Contrato metadata | `pdfinfo Contrato-ENNCO-Teckel.pdf` | 13 paginas, A4, sin form, sin cifrado |
| Contrato visual | `pdftoppm -f 13 -l 13 -png -r 120 ...` y `view_image` | Placeholders de firmas confirmados visualmente |
| Clausulas criticas | `pdftotext -layout ... | rg` | Inicio acumulativo, Anexo A, lead estricto y suspension confirmados |
| Busqueda de ejecutado/anexos | `find Downloads teckel-discovery/sales/ennco attachments ...` | Solo contrato fuente y script BoldSign; sin ejecutado, certificado o Anexo A |
| Integridad de exports | Parser de referencias `<attached: ...>` contra archivos presentes | Plataforma 15/15, Paco 24/24, cero faltantes |
| Duplicados | SHA256 de nueve pares export/Downloads | 9/9 identicos |
| Fuentes criticas | `shasum -a 256` sobre ocho fuentes | Hashes registrados en este reporte |
| RTM | Parser CSV | 27 filas, 18 P0, 9 P1, 0 duplicados, 0 campos vacios |
| Estado Git | `git branch --show-current`, `git rev-parse HEAD`, `git status --short` | Rama `main`, sin `HEAD`, archivos untracked |

## Limitaciones de esta auditoria

- No se abrio BoldSign ni se uso su document ID.
- No se verifico pago bancario o CFDI.
- No se inspeccionaron credenciales contenidas en chats.
- No se cotizaron proveedores ni dominios.
- No se modificaron RTM, RACI, Risk Register o BOM para evitar conflictos con trabajo concurrente.
- Los hashes prueban identidad local al snapshot, no validez legal ni vigencia externa.
