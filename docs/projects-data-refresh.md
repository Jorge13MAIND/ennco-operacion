# Datos históricos y actualización de fuentes ENNCO

Entrega: catálogo histórico revisable, consulta solar PVGIS y consulta FIX Banxico. Fecha de implementación/verificación: 10 de septiembre de 2026.

Todos los datos entran como **DRAFT / requiere revisión**. Consultar una fuente no aprueba el criterio de ingeniería, actualiza una propuesta emitida ni reemplaza la aprobación humana. No se han obtenido ni activado automáticamente tarifas CFE, nuevos precios de proveedores o fichas verificadas de todos los modelos.

## Catálogo recuperado

`data/projects/historical-catalogs.json` contiene 187 registros derivados de una lista explícita de celdas técnicas de la auditoría estática MEST:

| Categoría | Registros | Procedencia |
|---|---:|---|
| Módulos | 18 | `Inf_Módulos`, filas 6–23 |
| Inversores | 40 | `Inf_Inversor`, filas 6–45 |
| Recurso histórico por ciudad | 59 | `Inf_Irrad_Sol`, filas 5–63 |
| Conductores | 56 | Dos bloques de `Tab_Amp_Cir_AC`; se mantienen separados |
| Métodos de instalación | 6 | `Inf_Tab_Cab` |
| Sistemas de montaje | 8 | Bloque en español de `Inf_Sistema_De_Montaje` |

Los módulos conservan las familias Longi LR5-72HTH, LR7-72HTHF, Trina TSM-NE21 y Best Solar MGL. Los inversores son las filas Growatt MIC/MIN/MID/MAC/MAX del libro, incluida su nomenclatura original. Los nombres no fueron corregidos, combinados o sustituidos por modelos supuestamente equivalentes.

Cada entrada tiene `id`, `category`, `name`, `data.rawFields`, `data.fieldProvenance`, `data.context`, `data.reviewFlags`, `sourceSheet`, `sourceRow`, `sourceSha256`, `status: 'DRAFT'` y `requiresReview: true`. `fieldProvenance` indica celda, tipo original, celda de encabezado y etiqueta; los valores originales permanecen como fueron recuperados. Las filas del mismo nombre se conservan por separado y se identifican mediante `sameNameOccurrences`.

El archivo fuente se verificó contra SHA-256:

`aa11dfac9f93c78d9c05ef94b23e5faa03a2d99c9e775b441f2f50834731de28`

Se excluyeron Usuarios, propuestas, recibos de clientes y VBA. También se excluyeron precios aun dentro de fichas: columna AN de módulos y BK de inversores. En módulos no se importaron las columnas R–AC con resultados térmicos ya calculados, ni las columnas gráficas. El catálogo no se publica como archivo de `public`; se utiliza mediante las rutas privadas del módulo.

El libro no establece una fecha verificable para cada ficha. `sourceDate` permanece `null`; la fecha de recuperación o consulta no debe mostrarse como actualización de especificaciones. La referencia de la conversación a datos de 2025 indica que podrían estar desactualizados, no prueba una fecha uniforme de revisión.

### Qué puede reutilizarse y qué debe comprobarse

- **Identificación y captura:** nombres, modelos y ubicaciones de las celdas permiten evitar recaptura y orientar la búsqueda de fichas.
- **Especificaciones:** potencias, dimensiones y tensiones permanecen como referencia histórica hasta cotejarlas con fabricante/variante. Una marca en un campo de peso, como la observada en la fila Trina, no se convierte a número.
- **Temperatura:** el coeficiente Vmp no está identificado explícitamente; no se copia Voc o Pmax para rellenarlo. Los coeficientes numéricos históricos deben revisarse con su unidad antes de convertir fracción a porcentaje.
- **Inversores:** un límite de corriente operativa no se transforma en corriente máxima de cortocircuito. Se revisan límites por MPPT y variante de tensión; ceros en MPPT inexistentes no son una regla de diseño.
- **Recurso solar:** faltan metadatos fiables de periodo, plano y unidades. No se adoptan columnas históricas de temperatura como extremos de celda ni se activa el promedio histórico para generación nueva.
- **Conductores:** hay referencias y condiciones de distintas tablas/normas. Una fila del mismo calibre puede corresponder a una temperatura o método diferente. Se conserva el contexto; no se activa ampacidad por nombre solamente.
- **Montaje y garantías:** las afirmaciones históricas de certificación o años de garantía requieren documentos del proveedor y aceptación de ENNCO antes de figurar como compromiso contractual.

### Reproducir la importación

El script `scripts/projects-import-historical.py` usa sólo biblioteca estándar de Python. Lee la auditoría JSON y los bytes del libro para verificar su huella; escribe exclusivamente el JSON de salida. No abre Excel, ejecuta VBA ni modifica originales. Rechaza una salida que coincida con el libro o la auditoría.

```bash
python3 scripts/projects-import-historical.py \
  --audit-json /tmp/ennco_audit/comparison.json \
  --workbook '/ruta/MEST PROGRAM 2.0 - Act - Recuperado PARCIAL.xlsm' \
  --output data/projects/historical-catalogs.json
```

Agregar `--check` compara contra el catálogo existente sin escribirlo. La auditoría de `/tmp` no forma parte del repositorio; para reproducir fuera de este entorno se requiere conservar el archivo de auditoría junto al original bajo acceso autorizado.

## Consulta de fuentes

La API de implementación está en `src/lib/projects/source-refresh.ts`:

```ts
const candidate = await refreshSource({
  provider: "PVGIS", lat: 20.67, lon: -103.35,
  tilt: 20, azimuth: -90, year: 2026,
});
// O bien:
const exchange = await refreshSource({ provider: "BANXICO" });
```

`sourceRefreshSchema` es la unión discriminada de esos dos tipos. `solarResourceRequestSchema` valida coordenadas, plano y año del escenario. También se exportan `fetchSolarResource(input)` y `fetchExchangeRate()`. Los fallos usan `SourceRefreshError` con `code` y mensaje seguro para la interfaz; no incluyen cuerpos de error, credenciales ni valores inventados.

### PVGIS

Se utiliza el host oficial fijo `re.jrc.ec.europa.eu`, API v5.3 **DRcalc** con `month=0`, `global=1`, `angle`, `aspect`, `usehorizon=1`, `localtime=0` y `outputformat=json`. MRcalc no ofrece parámetro de azimut; DRcalc permite representar la orientación real. Se valida que la respuesta corresponda al sitio y plano y tenga doce perfiles de 24 horas uniformes, metadatos y unidades W/m². [Documentación oficial de la API JRC-PVGIS](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en).

El normalizador integra `suma de las 24 irradiancias horarias × 1 hora / 1000` para obtener kWh/m²/día. No divide por 24 ni multiplica por los días del mes; esa multiplicación ocurre una sola vez en el motor. El año solicitado etiqueta el calendario de simulación. El periodo meteorológico real viene de `year_min/year_max`; no se afirma observar 2026 porque el usuario elija 2026. [Descripción del perfil diario JRC-PVGIS](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/pvgis-5-tools/daily-radiation_en).

Salida: `provider`, `status`, `requiresReview`, `sourceUrl`, `consultedAt`, `dataset`, `monthlyResource` compatible con el motor y `warnings`. No contiene PR, pérdidas calculadas, tarifa ni temperatura extrema de diseño. Azimut: 0° sur, 90° oeste, −90° este.

**Verificación viva:** el wrapper se consultó en modo lectura el 10 de septiembre de 2026 a las 23:14:32 UTC, para coordenadas genéricas de Guadalajara 20.67/−103.35, inclinación 20°, azimut −90° y calendario 2026. PVGIS devolvió ERA5 2005–2023 y los doce meses; enero normalizado fue **4.86692 kWh/m²/día**. Es evidencia del adaptador, no estudio aprobado de un sitio de Paco ni valor predeterminado de producción.

### Banxico

Se consulta la serie FIX `SF43718` en el host oficial mediante token en el encabezado `Bmx-Token`. La serie y el mecanismo de autenticación se verificaron en la [documentación oficial SIE-API](https://www.banxico.org.mx/SieAPIRest/service/v1/).

La variable de servidor es `ENNCO_BANXICO_TOKEN`; nunca viaja como parámetro de consulta, en la URL de procedencia ni en la respuesta. Se valida fecha real, serie y dato positivo. Si devuelve `N/E`, una fecha inválida, falta token o falla la red, no se adopta un valor alternativo. Una observación con más de siete días genera aviso.

Salida: `provider`, `status`, `requiresReview`, `sourceUrl`, `consultedAt`, `seriesId`, `observationDate`, monedas USD/MXN, `rateMxnPerUsd` y advertencias. Administración conserva el tipo comercial que apruebe en cada propuesta. La precisión del parser se probó con respuestas sintéticas; no se realizó una consulta Banxico autenticada en esta entrega.

### Operación y límites

Las consultas sólo leen. Se prohíben URLs arbitrarias y redirecciones; las solicitudes tienen tiempo máximo de 20 segundos, límite de respuesta de 1 MB y validación de contenido JSON/unidades/metadatos. Una caída del proveedor conserva la situación del expediente y permite reintentar; no activa datos históricos como sustituto silencioso. Los permisos y la persistencia de la revisión corresponden a la ruta privada del dashboard.

## Investigación todavía requerida

1. **Tarifas:** reconstruir familias usadas por Paco, periodos, regiones, subsidios, bandas y demanda a partir de publicaciones CFE. La fuente actual del motor separa componentes, pero no importa un tarifario vigente completo.
2. **Equipos y montaje:** cotejar los 18 módulos/40 inversores con fichas oficiales, confirmar variantes, unidades, límites y disponibilidad. Solicitar cotizaciones vigentes del proveedor por unidad y moneda.
3. **Normativa/catálogos:** revisar artículos, tablas y condiciones de instalación antes de aprobar ampacidad, protecciones, tierra o tableros. Importar una tabla histórica no acredita su vigencia ni aplicación.
4. **Recibos:** la implementación ya extrae texto de PDF y utiliza OCR local en español con Tesseract para JPG/PNG y para la primera página de un PDF escaneado sin texto utilizable. El modelo se incluye con la aplicación; el hilo de OCR tiene acceso de red desactivado, límite de 25 segundos y validación previa del tamaño de imagen. Cada lectura queda pendiente de revisión, conserva candidatos ambiguos y permite captura manual ante errores. El OCR de un PDF escaneado no cubre automáticamente todas sus páginas. Falta comparar esta implementación con opciones por consumo sobre documentos autorizados representativos: medir exactitud por campo, correcciones manuales, tiempo por documento, costo vigente y tratamiento de archivos. La implementación y sus pruebas sintéticas no demuestran precisión sobre recibos reales de Paco ni justifican elegir un proveedor pagado.

Se mantienen captura manual y revisión humana. Los resultados de una evaluación con documentos sintéticos se identificarán como tales y no sustituirán el piloto real.

## Verificación

Las pruebas automatizadas cubren integración de unidades, meses bisiestos, correspondencia entre año del escenario y periodo climatológico, plano equivocado, horas duplicadas/faltantes, valores negativos, error HTTP, tiempo de espera, JSON/tamaño, host fijo, ausencia de token en URL, observación FIX inválida y exclusión de precios/usuarios del histórico. También verifican conteos, modelo real recuperado, celda y hash de origen, duplicados y faltantes de coeficientes/límites.

El script `--check` verifica reproducibilidad sin escribir los originales. Las consultas de tarifas, aprobación de fichas y validación del OCR sobre recibos reales permanecen pendientes y no se presentan como realizadas.
