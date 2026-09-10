# Proyectos ENNCO: liberación, cobertura y aceptación

Fecha de corte: 10 de septiembre de 2026. Paquete: módulo `/operacion/proyectos`, migración M055 y motor `ennco-engineering-1.0.0`.

**Estado: implementación para revisión e integración; no está lista para producción. No acredita aceptación de Paco ni liberación productiva.** Hay un recorrido técnico y administrativo implementado para los tres segmentos y pruebas sintéticas de sus controles. Faltan OAuth/Drive comprobados, datos operativos aprobados, pruebas con los recibos reales de Paco, validación contractual, aceptación en el entorno conectado y aplicación autorizada de M055 a producción. No se presenta como recuperación exacta de todas las fórmulas del Excel.

Este documento complementa [la especificación del motor](projects-engineering.md), [la evaluación de OCR](projects-ocr-evaluation.md) y [la plantilla contractual](projects-contract-template.md). No modifica el estado de producción ni las autorizaciones descritas en el README del repositorio. El permiso para construir no sustituye la autorización de publicación en producción.

## 1. Paquete y evidencia disponible

| Elemento | Implementación / evidencia | Estado al corte |
|---|---|---|
| Navegación y expediente | `src/components/OperationsNav.tsx`, rutas `/operacion/proyectos` y componentes en `src/components/projects` | Implementado; capturas de escritorio/móvil y pruebas con axe en `evidence/projects/`. |
| Contratos de datos y autorización | `src/lib/projects/types.ts`, `schemas.ts`, `permissions.ts`, `server.ts`; `/api/v1/projects/**` | Organizaciones y actor derivados de sesión; origen e idempotencia requeridos en escrituras. |
| Persistencia | `supabase/migrations/202609100055_ennco_projects.sql` y `src/lib/projects/repository.ts` | Gate local PostgreSQL aprobado, incluidas firmas de resultados derivados; sin constancia de aplicación a la base externa. |
| Prueba de base | `supabase/tests/055_ennco_projects.sql`, `run-ennco-projects-gate.sh` | Pasa en PostgreSQL 17 desechable, con concurrencia de dos sesiones y rollback. No utiliza la base de producción. |
| Ingeniería y cantidades | `engineering.ts`, `calculation.ts`, `engineering-sources.ts`, pruebas de ingeniería | Métodos deterministas documentados; parámetros, cobertura tarifaria y casos reales pendientes de Paco. |
| Operación financiera | `finance.ts`, validadores SQL y pruebas financieras | Separación de facturas, costos, compromisos y pagos; asignaciones y calendarios revisados; detección de duplicados y correcciones por reversión. |
| Documentos y lectura de recibos | `documents.ts`, `document-service.ts`, `extraction.ts`, `ocr.ts` | PDF por revisión; texto PDF y OCR local español de JPEG/PNG. El PDF sin texto suficiente rasteriza su primera página para OCR. Captura manual y revisión siempre disponibles. |
| Drive | `drive.ts` y registro `drive_setup` | Integración implementada; OAuth, permisos reales y prueba de reintentos pendientes. Variables presentes sólo significan configuración, no conexión validada. |
| Pruebas generales | 591 unitarias aprobadas en 94 archivos; 5 pruebas del asistente OAuth; gate M055 final aprobado con firma de servidor, asignaciones y calendarios | Salidas reproducibles en `evidence/projects/`: lint, tipos, unitarias, build, base, E2E, OAuth y capturas. La aceptación operativa de ENNCO permanece pendiente. |
| Material histórico | `data/projects/historical-catalogs.json`, `scripts/projects-import-historical.py` | Datos extraídos con procedencia y estado DRAFT. No constituyen equipos, precios o reglas aprobados para cotizar. |

El gate de base verifica actor y organización, lecturas financieras por función, directorio restringido, denegación de acceso crudo incluso con un GRANT posterior, Storage privado, referencias CRM, importes, anticipo/excepción, recepción parcial y cierre/reapertura. Los casos finales cubren eliminación explícita de metadatos opcionales, duplicados normalizados, reparto y reasignación de cobros, calendarios por adicionales, historial inmutable y reversiones que no pueden sobreasignar ni reactivar una parcialidad eliminada. También comprueba que un usuario no puede enviar resultados derivados sin firma del servidor, alterar su contenido ni reutilizar la firma con otro actor, proyecto, versión, tipo o clave; el reintento firmado conserva el resultado original. El módulo no genera leads, pagos comerciales ni comisiones en las tablas existentes.

Las siete pruebas de OCR reconocen números conocidos en imágenes JPEG/PNG sintéticas y verifican límites de imagen y terminación de un worker real a los 25 segundos. No miden exactitud sobre recibos de Paco. Una prueba adicional rasteriza y reconoce un PDF escaneado sintético completo. El build incluye worker, modelo español y canvas; la ruta de documentos traza aproximadamente 162 MiB. El arranque en frío con documentos reales y la precisión deben medirse en el entorno conectado.

### Comandos reproducibles de verificación

Desde la raíz del repositorio, con dependencias instaladas:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
bash supabase/tests/run-ennco-projects-gate.sh
npm run test:projects:e2e
node --test scripts/projects-drive-oauth.test.mjs
```

El gate PostgreSQL utiliza por defecto `/usr/lib/postgresql/17/bin`; otro entorno debe definir `ENNCO_POSTGRES_BIN` con una instalación compatible. Crea y elimina exclusivamente un clúster temporal en `/tmp`; no recibe credenciales externas. E2E requiere los navegadores de Playwright; la configuración dedicada arranca el entorno local en el puerto 3017. Cubre la API, formularios, accesibilidad con axe y los tres ciclos completos. El precotizador y el resto de la suite mantienen sus pruebas existentes.

Para pruebas de escritura sintética de la nueva sección, arrancar un servidor local dedicado:

```bash
ENNCO_DEMO_MODE=true ENNCO_PROJECTS_DEMO_WRITE=true NEXT_PUBLIC_APP_ENV=development npm run dev
```

La demostración conserva datos en memoria del servidor, puede perderlos al reiniciar y no llama a Drive. `ENNCO_PROJECTS_DEMO_WRITE` no habilita escrituras en Vercel ni en un build de producción. No confundir este recorrido con una prueba de persistencia real. Registrar artefactos de QA por SHA y mantener datos personales y secretos fuera de fixtures, consola, capturas públicas y commits.

## 2. Secuencia de despliegue y conexión

### A. Preparar el destino y aplicar M055

Responsable: implementador técnico; validación del destino: responsable de infraestructura ENNCO.

1. Registrar SHA candidato, rama, URL de preview prevista, referencia del proyecto Supabase dedicado y UUID de organización. Confirmar que el preview usa una base de prueba de ENNCO; no conectarlo a otro cliente ni usar una base productiva como sandbox.
2. Confirmar las migraciones previas del repositorio, la política de autenticación vigente y disponibilidad de `auth.users` y `storage`. Conservar sin cambios los controles existentes de campañas, correo y superficies públicas.
3. Respaldar el destino mediante el procedimiento de infraestructura aprobado. Registrar dónde se conserva el respaldo y cómo se verificó que puede restaurarse. Este runbook no acredita PITR, RPO ni RTO del proveedor.
4. Aplicar **sólo M055** después de revisar su diferencia y el destino. La migración es aditiva: crea tablas y RPC del expediente; no migra oportunidades comerciales, no ejecuta macros y no importa datos históricos a catálogos aprobados.

Ejemplo para un servicio de conexión previamente configurado y revisado, sin contraseña en la línea de comandos:

```bash
psql 'service=ennco_projects_preview' -X -v ON_ERROR_STOP=1 -f supabase/migrations/202609100055_ennco_projects.sql
```

`ennco_projects_preview` es un nombre de servicio de ejemplo, no una conexión incluida. Si se aplica SQL fuera del flujo habitual de migraciones, conciliar el historial del proveedor antes de ejecutar un despliegue automático posterior. M055 no es un script para ejecutarse repetidamente sobre las mismas tablas.

Las escrituras usan la sesión Supabase del usuario y sus capacidades. **El servidor requiere además `SUPABASE_SERVICE_ROLE_KEY` del Supabase dedicado de ENNCO, sólo para solicitar firmas de resultados derivados.** Configurar como secreto de servidor en el entorno autorizado, sin prefijo `NEXT_PUBLIC_`, sin registrarlo y sin reutilizar credenciales de otro proyecto. La URL sigue siendo `NEXT_PUBLIC_SUPABASE_URL` del destino dedicado. No se modifican variables externas como parte de este paquete.

M055 genera una clave HMAC privada de 32 bytes dentro de `app.ennco_project_signing_secret`. La RPC `ennco_projects_attest` sólo puede ejecutarse con `service_role` y firma organización, actor, proyecto, versión esperada, tipo de registro, contenido y clave de idempotencia. El cliente servidor no persiste sesión ni renueva tokens. Sólo utiliza esa credencial para solicitar la firma; `ennco_projects_append` continúa ejecutándose con la sesión del usuario y verifica sus áreas, reglas de negocio y versión. La firma no confiere aprobación técnica ni facultades de Dirección.

Los tipos `calculation`, `proposal`, `supplier_quote`, `document` y `drive_setup` requieren esa firma incluso al reintentar. Las tablas carecen de lectura/DML crudo para usuarios de aplicación y la función de escritura no está concedida a `service_role`. Si falta la credencial de firma, estas operaciones fallan con `PROJECT_SERVER_SIGNING_NOT_CONFIGURED`; no se permite saltar la comprobación. Probar en preview solicitud legítima, rechazo directo por usuario, clave ausente y reintento antes de aceptar el candidato.

### B. Verificar almacenamiento privado

M055 crea el bucket `ennco-project-documents`. Es almacenamiento intermedio durable para conservar archivos mientras Drive esté pendiente. La ruta tiene este formato:

```text
<organizationId>/<projectId>/<TEAM|ADMIN|PURCHASES>/<clave-de-archivo>
```

Confirmar antes del piloto:

- Bucket privado y reglas de lectura/escritura por organización, proyecto y clasificación. Sin sobrescritura ni borrado directo autenticado.
- Una persona de Ingeniería descarga un documento TEAM y no puede descargar uno ADMIN por URL directa o por la API. Compras accede a PURCHASES según sus capacidades.
- Subir nuevamente la misma solicitud no crea otro objeto ni otro registro; cambiar el contenido usando la misma clave produce conflicto.
- El archivo queda disponible para descarga autorizada si Drive falla. La sincronización utiliza huella SHA-256 y reserva IDs antes de crear archivos externos.

La API de carga admite **PDF, JPEG y PNG hasta 4 MiB** por archivo. Aunque la capacidad del bucket sea mayor, prevalece este límite de la ruta. El extractor limita la lectura PDF a 20 páginas. Si el PDF no ofrece texto suficiente, procesa por OCR sólo la primera página rasterizada y avisa que las demás requieren revisión. El OCR limita imágenes a 20 megapíxeles y su worker a 25 segundos; un fallo conserva el documento y permite captura manual. La validación de firma/tamaño no equivale a análisis antimalware; aplicar el procedimiento de archivos del entorno antes de aceptar documentos no controlados.

Verificar en el artefacto de preview que se incluyan `tesseract.js`, `tesseract.js-core`, `@tesseract.js-data/spa/4.0.0_best_int`, PDF.js y la biblioteca nativa de canvas para la plataforma. El motor español está incluido localmente; no necesita credenciales de proveedor OCR ni descargas de modelos. No confundir este plazo del worker con un límite general de procesamiento del PDF.

### C. Asignar usuarios y áreas

Responsables: Paco/Dirección y Administración. Usar usuarios activos ya existentes en la organización; la pantalla de áreas no crea identidades ni cambia sus roles globales.

- Un `ennco_admin` tiene las capacidades iniciales de Dirección para configurar el módulo.
- Dirección asigna las áreas `administration`, `purchases`, `engineering`, `projects` y `sales` en Catálogos y configuración, mediante `/api/v1/projects/members`.
- Administración funcional confirma cobros, registra costos y concilia; no obtiene automáticamente margen global ni excepciones de Dirección.
- `teckel_admin` conserva lectura técnica completa, incluidos costos/márgenes, pero no recibe facultades comerciales automáticamente. Una asignación de área de negocio debe ser explícita.
- `auditor_readonly` permanece de sólo lectura; no se convierte en operador por asignarle un formulario.

Probar cada perfil con una sesión diferente, incluyendo denegación de llamadas directas. Dejar evidencia de usuario, área, responsable que autorizó y fecha; no incluir contraseñas o tokens en el acta.

### D. Conectar Drive de contacto@ennco.com.mx

Responsables: administrador Google Workspace y responsable técnico. La conexión crea un árbol nuevo administrado por esta aplicación bajo la cuenta indicada. No reutiliza tokens de Gmail ni modifica permisos de carpetas existentes silenciosamente.

1. Preparar un cliente OAuth de ENNCO con Drive API y autorizar **contacto@ennco.com.mx**. Para los archivos creados por la aplicación, comenzar con el alcance `https://www.googleapis.com/auth/drive.file`, que Google recomienda para acceso por archivo. Validar las llamadas necesarias sin ampliar a acceso a todo Drive por conveniencia. [Documentación oficial de alcances](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
2. Obtener acceso offline y el refresh token mediante el procedimiento OAuth autorizado. El módulo no incorpora un asistente de consentimiento/renovación en la interfaz. [Flujo OAuth de servidor de Google](https://developers.google.com/identity/protocols/oauth2/web-server#offline).
3. Configurar en el entorno de preview, como secretos de servidor: `ENNCO_DRIVE_CLIENT_ID`, `ENNCO_DRIVE_CLIENT_SECRET` y `ENNCO_DRIVE_REFRESH_TOKEN`. No tienen prefijo `NEXT_PUBLIC_`; no registrar sus valores en este documento.
4. Validar identidad efectiva mediante Drive `about`. El código rechaza una cuenta distinta de la acordada. Administración/Dirección realiza la primera sincronización y se reservan el directorio raíz, el folio y las ocho secciones.
5. Comprobar que el árbol y los archivos pertenecen a la cuenta indicada. El adaptador actual rechaza permisos de dominio, públicos, grupos u otros usuarios. Los demás operadores acceden a documentos desde el dashboard autorizado. No es una implementación de unidades compartidas; si ENNCO requiere otra política de compartición, hay que implementarla y probarla expresamente.
6. Probar pérdida temporal de conexión, respuesta repetida, documento pendiente y reintento. Confirmar un único árbol por proyecto y un único archivo por reserva, además de integridad y clasificación.

No activar sin registrar resultado de estas pruebas. No hay un cron nuevo que prometa sincronización automática continua; la acción disponible es la sincronización del expediente. Si falla, registrar el código y folio, revisar el borrador y reintentar desde una vista actualizada.

### E. Preview, aceptación y producción

1. Publicar el SHA candidato en el **preview del proyecto Vercel correcto**, con Supabase de prueba y origen `NEXT_PUBLIC_APP_URL` correspondiente al preview. Una URL distinta del origen configurado debe rechazar escrituras.
2. Ejecutar la matriz de aceptación siguiente con Paco y los responsables de cada función. Documentar defectos, decisiones técnicas pendientes y diferencias frente a sus referencias.
3. Corregir y repetir únicamente los casos afectados y las verificaciones requeridas por el cambio. Guardar la URL, SHA, resultados, PDFs de prueba y acta de aceptación sin datos expuestos públicamente.
4. Solicitar la autorización de producción sobre ese resultado concreto: SHA, migración, configuración de firma, datos iniciales aprobados, responsables, ventana y reversión. No hay autorización productiva registrada en este documento.
5. Con aprobación, repetir la comprobación de destino y respaldo, aplicar M055 a la base productiva si aún falta, asignar capacidades y configurar los secretos del entorno productivo. Publicar el mismo candidato validado y comprobar login, permisos, alta, descarga y respuestas de errores.
6. Durante el piloto operativo, revisar fallos de autorización, conflictos de versión/idempotencia, archivos pendientes de Drive y errores de extracción. Utilizar identificadores/códigos, no contenido de recibos ni secretos. Medir tiempo de preparación, correcciones, capturas repetidas y tareas externas que continúan siendo necesarias.

La publicación del módulo privado no cambia la autorización de campañas, envío de mensajes, DNS o páginas públicas.

## 3. Matriz del procedimiento operativo

Los quince estados son etiquetas de seguimiento. Cambiar una etiqueta no registra aceptación, pago, recepción, revisión técnica ni liberación de compras. El estado `CLOSED` sí exige cierres técnico y financiero vigentes. Pausa, cancelación y oportunidad perdida se conservan como ciclo de vida separado.

| Estado | Función implementada | Evidencia exigida / validación pendiente |
|---|---|---|
| Prospecto | Alta, folio ENN-año-consecutivo, cliente y vínculo CRM opcional | Necesidad, contacto, responsable; vínculo de la misma organización. |
| Información recibida | Archivos, extracción revisable y captura manual de consumos | Recibo y periodos confirmados; precisión con recibos reales pendiente. |
| Cotización | Escenarios técnicos y métodos de precio USD/W o margen sobre venta | Parámetros e inclusiones comerciales aprobados; no ahorro CFE universal. |
| Levantamiento | Instalación, medidas, recorridos, fotos, restricciones y listas de revisión | Mediciones y responsable; validar la lista con Paco. |
| Propuesta | Revisión de precio, cliente/alcance congelados y PDF comercial | Referencia técnica y aceptación del cliente como registro separado. |
| Negociación | Nuevas propuestas, condiciones y notas sin sobrescribir revisiones | Evidencia del acuerdo; no enviar propuesta o mensajes automáticamente. |
| Contratado | Contrato referenciado a propuesta aceptada y calendario de pagos; posteriores revisiones del calendario por Administración/Dirección | Contrato firmado externo y plantilla legal validada, aún pendiente; conservar calendario original y conciliar el vigente con cambios aprobados. |
| Anticipo recibido | Cobro confirmado por Administración y anticipo contractual | Movimiento pendiente no libera compras; factura no equivale a cobro. |
| Compras | Cotizaciones de proveedores, pedidos y recepciones parciales | Anticipo o excepción expresa de Dirección; cinco días hábiles para compras principales. |
| Ingeniería | Solar/MPPT, sombras, circuitos, cantidades y estudios aplicables | Reglas revisadas y aprobación técnica; faltan cobertura/datos operativos. |
| Ejecución | Progreso físico, evidencia, incidencias y adicionales | Avance capturado por responsable; sobrecostos generan revisión, no bloqueos arbitrarios. |
| Trámites / Interconexión | Evidencia, seguimiento y documentos dentro del expediente | Gestión externa; no hay envío automático ni aprobación ante CFE. |
| Cobranza | Contratado, facturado, cobrado, saldo y parcialidades; reparto/reasignación de un cobro confirmado | Distribución completa sin duplicar dinero; rechazo de duplicados; calendario conciliado; comprobantes de bancos externos. |
| Entrega | Cierre técnico, documentos y verificación | No exige que el saldo financiero se invente como liquidado. |
| Cerrado | Conciliación, cierre financiero y utilidad según costos registrados | Excepción sólo Dirección cuando hay diferencias; reapertura trazable antes de ajustes. |

La implementación se distribuye entre `ProjectIntake.tsx`, `ProjectEngineering.tsx`, `ProjectCommercial.tsx`, `ProjectOperations.tsx`, `ProjectsOverview.tsx` y `CatalogWorkspace.tsx`. Los invariantes se verifican nuevamente en SQL y no dependen de que el usuario utilice estos formularios.

Un cierre financiero vigente impide nuevos movimientos financieros y su reversión hasta reabrirlo con motivo/evidencia. El cierre técnico exige reapertura antes de modificar estudio, recibos, levantamiento o progreso. Administración puede registrar la reapertura; un nuevo cierre necesita sus comprobaciones. Notas, documentos y recepción de almacén permanecen disponibles. Esta regla aplica a cierres registrados; no añade bloqueo por desviación de costos durante ejecución.

### Registro de cobros, revisiones y correcciones

- `customer_payment` y `supplier_payment` exigen referencia, método, fecha e importe. La base rechaza otro pago activo del mismo tipo/proyecto con referencia y método iguales tras quitar espacios y normalizar mayúsculas, y con el mismo instante de pago. Un reintento con la misma clave y contenido recupera su resultado. Si el original se revierte, puede registrarse el movimiento corregido con una nueva clave.
- `customer_payment_allocation` distribuye **todo** un cobro confirmado entre una o varias parcialidades del contrato. Cada revisión conserva la anterior; sólo la última vigente determina la distribución, sin sumar nuevamente el dinero. La suma debe coincidir con el cobro y ninguna parcialidad puede exceder su cuota al incluir los demás cobros.
- `payment_schedule` conserva una revisión completa del calendario, con motivo/evidencia. Su suma debe coincidir con contrato más cambios aprobados. No puede eliminar una parcialidad con dinero asignado ni reducir su cuota por debajo de lo ya aplicado. Registrar un adicional aprobado puede dejar pendiente actualizar el calendario; no detiene automáticamente la obra.
- El cierre financiero exige conciliación de importes, calendario y asignaciones. Un saldo global cero no basta si existen cobros sin distribuir. Una diferencia sólo puede admitirse con excepción documentada de Dirección.
- Correcciones, cancelaciones y devoluciones se documentan mediante reversión del registro y movimientos corregidos, con motivo y soporte externo. Si el cierre está vigente, primero debe reabrirse. La reversión no borra historia ni ejecuta una devolución bancaria. Las asignaciones de un cobro revertido permanecen como evidencia sin contribuir a las cifras; revertir una distribución o calendario tampoco puede restaurar cuotas excedidas o referencias inválidas.
- En la ficha, un PATCH con `null` elimina `accountId`, `opportunityId`, `dueDate`, `latitude` o `longitude`; omitir un campo conserva su valor. La base valida organización y coherencia cuenta/oportunidad después de aplicar ambas clases de cambio. Limpiar un vínculo no modifica el CRM ni sus métricas.

## 4. Cobertura de las 37 hojas auditadas

La auditoría encontró 37 hojas comunes con valores coincidentes; no conservan fórmulas de cálculo en celdas. Las macros recuperadas orientan navegación, selección y exportación, pero no acreditan equivalencia matemática del nuevo motor. La siguiente agrupación contabiliza las 37 hojas, sin convertir usuarios, contraseñas o funciones de caducidad en datos de la aplicación.

| Hojas (cantidad) | Destino implementado | Pendiente / tratamiento |
|---|---|---|
| Inicio, Menu_Principal, Menu_Accesos (3) | Navegación y `ProjectWorkspace.tsx` | Validación de uso con Paco. |
| Cal_Ing_Bas, Cal_Cir_Ele (2) | `ProjectEngineering.tsx`, `engineering.ts` | Reglas y configuraciones aplicables al sitio. |
| Cotizador_G (1) | `ProjectCommercial.tsx`, `finance.ts` | Inclusiones USD/W, margen, descuentos y condiciones de ENNCO. |
| Cal_Tarifa_Industrial, Cal_Tarifa_Comercial, Cal_Tarifa_Residencial (3) | Captura de recibos y escenario energético de `engineering.ts` | Facturación completa por tarifa/región/horario todavía no implementada. |
| Inf_Vac_Res, Inf_Vac_Com, Inf_Vac_Ind (3) | `ProjectIntake.tsx` y expediente compartido | Casos reales y datos mínimos por segmento. |
| Tarifas (1) | Catálogos versionados y revisión de fuentes | No hay tarifas vigentes aprobadas cargadas por defecto. |
| Inf_Irrad_Sol, Gen_Energía (2) | Recurso documentado y generación mensual en `engineering.ts` | Recurso/plano/periodo del sitio y extremos de diseño por validar. |
| Inf_Apoyo, Inf_Factor_K (2) | Catálogos y resolución de reglas en `calculation.ts` | Unidades, condiciones de aplicación y tablas aprobadas. |
| Cal_Sombra_Apoyo, Cal_Sombra (2) | Geometría plana en `engineering.ts` | No sustituye simulación anual o estudio 3D. |
| Cal_Inv_St (1) | MPPT, cadenas, temperatura y múltiples inversores | Fichas por modelo y revisión de límites. |
| Cal_Consumo (1) | Meses/periodos confirmados | No se reproduce la macro que copiaba un consumo doce veces. |
| Vigencia (1) | Vigencia de propuesta/catálogos y revisión inmutable | Se excluye caducidad o borrado del programa. |
| Estudio_Res, Estudio_Com, Estudio_Ind (3) | `documents.ts`, documentos/fotos del expediente | Diseño y aceptación de propuestas con Paco; no es copia visual exacta del Excel. |
| Inf_Módulos, Inf_Inversor (2) | Histórico DRAFT, catálogos y entradas de ingeniería | Datos históricos necesitan fichas oficiales y unidades verificadas. |
| Tab_Amp_Cir_AC, Inf_Tab_Cab (2) | Reglas explícitas de conductores/ampacidad | Norma, temperatura, agrupamiento, terminales e instalación revisados. |
| Inf_Sistema_De_Montaje (1) | Cantidades por medidas y unidades comerciales | Anclaje, viento, estructura, merma y criterios de instalador. |
| Usuarios (1) | Sesión del dashboard y áreas del proyecto | Excluido de importación; no copiar credenciales de MEST. |
| Cal_Cir_Ele_DC, Cal_Cir_Ele_AC, Cal_Cir_Ele_Tab (3) | Circuitos AC/DC, protecciones/tierra/canalización por reglas | Falta ingeniería integral de barras, cortocircuito, selectividad y tablero. |
| Cal_Fac_Pot (1) | Estimación de kvar y expediente manual de calidad | No selecciona automáticamente banco, pasos, filtros o protecciones. |
| Precios_SFV (1) | Costos/proveedores y presupuesto versionado | Precios, disponibilidad, moneda y tipo comercial actual por confirmar. |
| Textos (1) | Documentos y contrato borrador | Revisión contractual/garantías; no reutilizar compromisos históricos sin aprobación. |

Total: **37 hojas**. La hoja adicional `Recuperacion` pertenece a la auditoría y no añade una función de negocio. Las macros de envío oculto y borrado/caducidad quedan excluidas. El histórico permanece DRAFT y separado de las reglas que permiten aprobar cálculos nuevos.

## 5. Acta de aceptación: tres segmentos y responsables

Estado inicial de todas las filas: **PENDIENTE DE VALIDACIÓN ENNCO**. No completar una firma o fecha por inferencia a partir de pruebas automatizadas.

| Recorrido | Responsable principal | Criterio de aceptación y evidencia |
|---|---|---|
| Residencial completo | Paco + Ingeniería + Administración | Caso real: recibos confirmados, visita, módulos/inversor, circuitos/materiales, precio, propuesta, contrato externo, anticipo, compra/recepción, gastos, entrega y conciliación. Contrastar cálculo con referencia independiente y tolerancia específica. |
| Comercial completo | Paco + Ingeniería + Compras + Administración | Caso con condiciones de instalación y tarifa confirmadas; distinguir estimación energética de factura completa; comprobar partidas, cantidades comerciales, compras parciales y documentos del cliente. |
| Industrial completo | Paco + Ingeniería + Proyectos + Administración | Caso con suministro/configuración definidos, múltiples inversores cuando apliquen, demanda y datos temporales explícitos; validar tableros/compensación sólo dentro de la cobertura aprobada. Registrar qué estudios siguen externos. |
| Permisos y separación de costos | Dirección + responsable técnico | Sesiones reales de cada función; llamadas directas sin facultades denegadas; márgenes ausentes de respuesta/documento comercial; técnico administrador sin poderes de negocio automáticos. |
| Drive y continuidad | Administración + responsable Workspace | Cuenta efectiva correcta; ocho secciones; documentos privados; archivo íntegro; fallo/reintento sin duplicados; acceso autorizado por dashboard. |
| Contrato y condiciones | Administración + asesoría legal ENNCO | Razón social, representación, alcances, términos, jurisdicción, pagos, garantías y anexos completos; aprobación identificada de plantilla. |
| Conciliación/reapertura | Administración + Dirección | Factura, costo y pago no duplicados; repartir y reasignar un cobro entre parcialidades; revisar calendario por adicional; rechazar duplicados y cuotas excedidas; documentar devolución/corrección y reapertura sin borrar historia ni ejecutar banco. |
| Recibos asistidos | Paco + Ingeniería + Administración | JPEG/PNG, PDF digital y PDF escaneado representativos; comparar campos con el original y medir correcciones/tiempo. Verificar aviso de primera página, captura manual ante fallo y persistencia del archivo. |
| Usabilidad y desempeño | Paco + responsables de área | Recorrido sin guía del desarrollador; escritorio/móvil, teclado, archivos, corrección de errores, recuperación de borrador y tiempos medidos. |

Cada caso debe registrar: folio, segmento/configuración, tarifa y periodos, SHA desplegado, versión del motor, catálogos utilizados, referencias de entrada, resultados esperados y obtenidos, tolerancias, desviaciones justificadas, PDFs/huellas, responsable, fecha, decisión y pendientes. Las referencias técnicas independientes no se generan con el mismo motor probado.

Criterio de liberación: tres recorridos aceptados por Paco y responsables, ausencia de defectos críticos abiertos, permisos/OAuth/Drive comprobados, parámetros aprobados y autorización productiva del SHA. La disponibilidad productiva requiere además aplicar M055 al destino autorizado y verificar la integración desplegada. Mientras falte cualquiera de estas condiciones, el paquete continúa en validación. Si una tarifa, configuración o selección no está respaldada, debe mantenerse identificada como fuera de cobertura final; no habilitar una aprobación genérica para ocultar el pendiente.

## 6. Límites que deben conservarse visibles

- **Tarifas y ahorro:** existe escenario uniforme de energía con autoconsumo confirmado. No implementa todas las reglas CFE, escalones, subsidios, bandas, demanda por ventana, excedentes o impuestos. No hay TIR, VAN ni financiamiento calculado a partir de ese escenario incompleto.
- **Diseño eléctrico:** comprueba magnitudes y reglas explícitas; no certifica cumplimiento normativo integral. No incluye estudio estructural, cortocircuito, coordinación/selectividad o ingeniería completa de tableros.
- **Capacitores/calidad:** Qc es una estimación bajo hipótesis indicadas. El expediente de armónicos/frecuencia es manual. Falta validar con Paco el estudio, mediciones y selección definitiva de equipos.
- **Recibos:** PDF con texto y OCR local español sugieren campos. Se reconocen JPEG/PNG y la primera página de un PDF sin texto suficiente; no hay OCR automático de todo un escaneo multipágina. Documentos ilegibles, extensos o fallidos conservan captura manual. Toda extracción necesita revisión. No se midió precisión sobre recibos reales ni se contrató proveedor de OCR por consumo.
- **Datos vigentes:** no hay actualización automática contratada de CFE, clima, fichas, precios o Banxico. El histórico 2025/recuperado necesita fuente, unidades, vigencia y aprobación antes de uso operativo.
- **Contrato:** se entrega borrador, con pendientes explícitos; no hay dictamen legal o firma integrada acreditados.
- **Operaciones externas:** no hay timbrado CFDI, ejecución bancaria, nómina, firma electrónica integrada, envío automático de propuestas ni presentación automática de trámites CFE. Se registran comprobantes y evidencias externas.
- **Demostración y entrega:** la demo es efímera. Una implementación con pruebas no equivale a que Paco ya la utilice, que Drive esté conectado o que la base externa haya sido migrada.

## 7. Reversión y continuidad de los datos

Responsables: infraestructura + Dirección/Administración, según impacto. Registrar causa, SHA anterior, última revisión guardada y decisión.

**Primera opción: revertir sólo la aplicación al despliegue anterior y conservar M055 y sus datos.** Al ser aditiva, la versión anterior puede ignorar esas tablas; comprobar antes la compatibilidad del SHA elegido. Suspender las nuevas operaciones del módulo durante la revisión y conservar los archivos privados.

El rollback SQL elimina las tablas del expediente y su auditoría: **no ejecutarlo sobre datos nuevos sin respaldo verificado y autorización sobre esa pérdida de disponibilidad**. Debe conservarse:

- Copia consistente de las cinco tablas `public.ennco_projects` / `ennco_project_*` y de `app.ennco_project_counters`, `ennco_project_commands`, `ennco_project_audit`, `ennco_project_signing_secret`. La clave de firma requiere respaldo con acceso restringido; nunca incluirla en evidencia de QA o archivos públicos.
- Archivos del bucket privado con sus rutas y SHA-256, y el inventario de IDs/secciones de Drive.
- Usuarios/organización y configuración necesarios para restaurar relaciones y permisos. No guardar secretos junto a copias públicas de documentos.
- Una restauración ensayada en base aislada con conteos, folios, revisiones, archivos, permisos y descargas comprobados.

Sólo para un destino autorizado, ya respaldado y verificado:

```bash
psql 'service=ennco_projects_preview' -X -v ON_ERROR_STOP=1 -f supabase/rollbacks/202609100055_ennco_projects.down.sql
```

El rollback no borra archivos de Drive. Conserva los objetos Storage; si quedan objetos, conserva también el bucket, pero retira las políticas nuevas. Por ello no debe presentarse como una restauración operativa automática de documentos. La recuperación requiere volver a disponer de las relaciones/reglas correspondientes y reconciliar los objetos conservados antes de reanudar escrituras.

No restaurar parcialmente registros/cierres sin sus reversiones, comandos e IDs: se perdería trazabilidad o se duplicarían reintentos. Conciliar también el historial de migraciones antes de reaplicar M055. Las tablas comerciales y sus comisiones no forman parte de este rollback.

## 8. Artefactos de revisión

La rama de implementación es `grant/proyectos-ennco`, basada en `c943c32` de `main` al integrar los cambios concurrentes. El expediente original y los archivos Excel/DOCX no fueron editados. `evidence/projects/source-integrity.json` verifica los hashes de ambos Excel contra la auditoría.

El preview se configura con datos sintéticos de sólo lectura para los tres segmentos; no contiene proyectos reales ni conecta Drive. La comprobación local del build devolvió tres expedientes, PDFs válidos y rechazo HTTP 409 para escrituras. Las pruebas de escritura operativa usan exclusivamente la demo local y el clúster PostgreSQL temporal.

Para verificar el histórico contra los archivos auditados originales, ejecutar `npm run verify:projects:historical -- --audit-json /ruta/comparison.json --workbook /ruta/libro.xlsm`. El comando exige ambos archivos y compara la salida sin modificarlos: 187 entradas DRAFT verificadas.
