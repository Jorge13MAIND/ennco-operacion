# Lectura de recibos ENNCO: OCR local y evaluación de alternativas

Fecha de consulta: 10 de septiembre de 2026. Implementación: `src/lib/projects/ocr.ts`; pruebas: `src/lib/projects/ocr.test.ts`.

**Se implementó lectura OCR local para imágenes JPEG/PNG con Tesseract.js 7 y modelo español incluido en el paquete.** El resultado es texto candidato para la extracción de campos y revisión humana. No confirma importes, consumo, tarifa o periodos y no sustituye al recibo. Todavía no hay una medición de precisión sobre documentos reales de Paco ni comparación empírica entre proveedores.

## 1. Contrato y ejecución

```ts
recognizeReceiptImage(bytes, 'image/jpeg' | 'image/png')
// Promise<{text, elapsedMs, engine: 'TESSERACT_LOCAL', warnings: string[]}>
```

El flujo de integración es: archivo guardado → validación de imagen → OCR local → parser de candidatos → revisión contra la imagen → confirmación explícita. `text` nunca debe publicarse en logs. Si el modelo no carga, la imagen no es compatible, el texto está vacío o se agota el tiempo, el expediente conserva el archivo y ofrece captura manual. La función rechaza con códigos `PROJECT_OCR_*`; la ruta que la integra debe convertir esos fallos en una alternativa de captura, sin perder el documento.

Controles implementados:

- PNG con firma/IHDR, dimensiones, estructura de fragmentos y final válidos; se rechazan animación APNG y cabeceras repetidas. JPEG se inspecciona mediante marcadores y segmentos SOF.
- Máximo **4 MiB** codificados, **20 megapíxeles** y **20,000 píxeles por dimensión**, antes de que el decodificador reserve la imagen expandida.
- Worker Node aislado con plazo de **25 segundos**, que incluye carga del motor/modelo y reconocimiento. Se termina en `finally`, incluso ante error o inicialización detenida.
- Scripts, WebAssembly y español resueltos desde dependencias locales. `fetch` está deshabilitado dentro del hilo OCR: no puede descargar un modelo de un CDN ni enviar la imagen a un proveedor.
- `cachePath` apunta a `os.tmpdir()` y `cacheMethod` es `none`: no se depende de escritura en el directorio del despliegue ni de caché compartida entre recibos. Imagen y texto permanecen en memoria de esta función; el archivo original tiene su persistencia privada en el expediente.
- Salida limitada a texto, sin hOCR/TSV. Los mensajes de diagnóstico del decodificador no pasan a los logs de aplicación. No se registra el texto reconocido ni la imagen.
- Las advertencias recuerdan la revisión humana. La confianza interna del motor no se presenta como porcentaje comprobado de precisión del sistema.

Tesseract documenta los workers, selección de idioma y opciones de rutas/caché en su [API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md) e [instalación local](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md). En Node, este adaptador posee el hilo inmediatamente y utiliza el protocolo de la versión **7.0.0 fijada**: esto permite terminarlo durante la carga, antes de que la promesa pública `createWorker` exponga su manejador. Cambiar de versión requiere revisar el protocolo y volver a ejecutar la prueba real, no sólo actualizar el número de dependencia.

### Integración y empaquetado

El servidor debe incluir:

```text
tesseract.js/**
tesseract.js-core/**
@tesseract.js-data/spa/4.0.0_best_int/**
```

La versión instalada contiene aproximadamente 44 MiB del paquete core y 2.1 MiB del modelo español comprimido seleccionado; eso no equivale al tamaño final de la función ni a su consumo de RAM. Verificar el artefacto de Vercel, el trazado de dependencias dinámicas, el arranque en frío y memoria disponible en preview. No hay credenciales de OCR externo que configurar para esta implementación.

PDF con texto utiliza la extracción de PDF.js. `ocr.ts` admite imágenes; la integración en `extraction.ts` rasteriza **la primera página** cuando el PDF no ofrece texto suficiente y la envía al mismo worker local. No procesa automáticamente todas las páginas de un escaneo: informa ese límite y conserva captura manual para las restantes. La extracción PDF admite hasta 20 páginas; el renderizado y el paquete nativo de canvas requieren verificación de recursos en preview. Fotografías inclinadas, reflejos, recortes, sombras y baja resolución pueden producir candidatos incorrectos o vacíos.

## 2. Evidencia obtenida

```bash
npx vitest run src/lib/projects/ocr.test.ts
npx eslint src/lib/projects/ocr.ts src/lib/projects/ocr.test.ts --max-warnings=0
npm run typecheck
```

La prueba de reconocimiento genera imágenes sintéticas en memoria con `@napi-rs/canvas`, texto explícito de prueba y números conocidos. Comprueba que JPEG y PNG producen los valores `1250`, `3456.78` y `2026-01-01`, sin persistir archivos ni utilizar un proveedor externo. También se prueban:

- Rechazo de una cabecera PNG que declara demasiados píxeles y de un prefijo PNG truncado.
- Rechazo de JPEG sobredimensionado o de segmentos inválidos.
- Rechazo de PNG sin final y archivos mayores de 4 MiB.
- Terminación de un worker real cuya inicialización se dejó detenida deliberadamente, usando un reloj de prueba para comprobar el plazo de 25 segundos.

Esta evidencia verifica que el motor empacado funciona y que operan los límites; **no demuestra lectura correcta de un recibo CFE real, todas sus tarifas, tablas o fotografías**. La evaluación operativa debe medir campos confirmados y correcciones necesarias, no únicamente texto o confianza del OCR.

## 3. Comparación de costo y capacidad

Consulta de precios públicos en USD; importes sin impuestos, conversión monetaria, infraestructura adicional ni posibles condiciones de cuenta. Son referencias de presupuesto, no una cotización ni una prueba de precisión. No se realizaron llamadas de pago, no se crearon cuentas de proveedor y no se enviaron recibos a terceros.

| Alternativa | Costo de referencia verificable | Lo que aportaría / límite de la comparación |
|---|---|---|
| Tesseract local español | Sin cargo por API de OCR. Sí utiliza cómputo/memoria/tiempo del hosting, cuyo costo debe medirse en el despliegue. | Ya implementado; archivos procesados en el servidor ENNCO. No incorpora interpretación completa de tablas CFE ni corrección automática de fotos. |
| Google Cloud Vision, Text Detection o Document Text Detection | Primeras 1,000 unidades mensuales gratuitas; después USD 1.50 por 1,000 hasta 5 millones, y USD 0.60 por 1,000 en el tramo superior. Una página de documento cuenta como imagen; cada función aplicada genera unidades. [Precio oficial](https://cloud.google.com/vision/pricing). | Alternativa externa para obtener texto. Requiere integración y evaluación sobre las mismas muestras; no se acredita que supere al local. |
| Amazon Textract, DetectDocumentText | Ejemplo oficial de US West/Oregon: USD 0.0015 por página para el primer millón y USD 0.0006 por página posterior. No se incluyen beneficios temporales de cuenta gratuita. [Precio oficial](https://aws.amazon.com/textract/pricing/). | Alternativa OCR externa. Forms/Tables/Queries son funciones distintas y no deben presupuestarse al costo de DetectDocumentText. |
| Azure Document Intelligence, Read | La página pública ofrece nivel gratuito de 500 páginas/mes; en esta consulta el precio S0 aparece como `$-` y requiere resolver región/moneda en su calculadora. **No se pudo confirmar una tarifa numérica S0.** [Precio oficial](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/). | Alternativa a comparar con región y modelo definidos. Read y los modelos de recibos/facturas tienen alcances y precios separados; no se supone compatibilidad CFE por el nombre del modelo. |

Ejemplo aritmético, sólo una función OCR y páginas de una imagen: a 10,000 páginas/mes, Google sería USD 13.50 tras las primeras 1,000 gratuitas; DetectDocumentText en el tramo de Oregon sería USD 15.00 antes de beneficios de cuenta. Son cálculos derivados de los precios citados; no incluyen reintentos, almacenamiento, red o desarrollo. El costo por página leída **y corregida** dependerá también del tiempo que invierta Paco en revisar.

No hay fundamento para declarar un proveedor “más preciso” o “mejor” con la evidencia disponible. Elegir únicamente por costo unitario ignoraría tablas, ambigüedades y trabajo de revisión.

## 4. Piloto verificable con Paco

Responsables: Paco/Administración aportan y validan las muestras; Ingeniería confirma consumo, demanda y periodos; el equipo técnico ejecuta la comparación.

1. Seleccionar al menos 30 documentos autorizados para el piloto: diez por segmento, distribuidos entre PDF digital, JPEG/PNG, fotografía y escaneo. Incluir más de un periodo y las tarifas que Paco utiliza. No afirmar cobertura de una familia ausente de la muestra.
2. Crear una referencia independiente con campos transcritos y revisados: tarifa, inicio/fin del periodo, kWh, total, demanda y reactiva cuando aparezcan. Diferenciar “campo no presente” de cero. Separar previamente documentos de ajuste y documentos reservados para evaluación.
3. Medir primero la extracción local existente. Registrar método, versión, latencia total, campos correctos, vacíos, ambiguos, incorrectos y tiempo/cambios de revisión. El texto sintético no cuenta como muestra real.
4. Si persiste trabajo de corrección importante, presentar a ENNCO el conjunto de documentos, campos, destino, región, presupuesto máximo y tratamiento de datos de un proveedor antes de enviar muestras. Esta investigación de precios no autoriza envíos ni contratación.
5. Ejecutar la alternativa sobre la misma muestra reservada, con igual definición de campo correcto. Medir exactitud antes y después de revisión, documentos completos sin corrección, errores numéricos graves, tiempo humano y costo total por documento útil.
6. Aceptar el flujo únicamente cuando la confirmación humana impida usar candidatos erróneos como entradas aprobadas. Paco debe decidir, a partir de la línea base observada, qué reducción de tiempo justifica el proveedor externo. Las tolerancias de importes y consumos no se relajan para mejorar una cifra de exactitud.

Formato mínimo del registro de evaluación:

| Dato | Contenido |
|---|---|
| Documento | Identificador interno/huella; el recibo se conserva privado. |
| Representatividad | Segmento, tarifa, formato, calidad y periodos. |
| Motor | Versión local o proveedor/modelo/región; configuración aplicada. |
| Resultado | Campos esperados, obtenidos, ambigüedad y corrección documentada. |
| Esfuerzo | Tiempo de máquina, reintentos y segundos de revisión humana. |
| Costo | OCR, infraestructura atribuible y trabajo de revisión; moneda/fecha. |
| Decisión | Aceptado para captura asistida, repetir o manual; responsable y fecha. |

Pendientes: muestras reales, tasa de errores por campo, costo de hosting observado, medición en preview, presupuesto/región de Azure si se evalúa y decisión de Paco. Hasta cerrarlos, el resultado disponible es **captura asistida con OCR local y revisión obligatoria**, sin promesa de precisión operativa ni contratación externa.
