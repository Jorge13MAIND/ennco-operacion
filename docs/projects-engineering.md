# Ingeniería de Proyectos ENNCO: especificación verificable

Versión del motor: `ennco-engineering-1.0.0`. Fecha de investigación: 10 de septiembre de 2026. Idioma/unidades: español de México, SI; dinero en MXN salvo conversión comercial explícita fuera del motor.

La copia de MEST tiene datos y parte del VBA, pero **cero fórmulas de cálculo en celdas**. Este motor reconstruye métodos físicos documentados. No afirma equivalencia con fórmulas desaparecidas, cumplimiento normativo integral ni aprobación de Paco. Ningún archivo Excel, DOCX ni macro original se modifica o ejecuta.

## Contrato y comportamiento

`engineeringInputSchema` valida el contrato de entrada. `EngineeringInput` es el tipo inferido. `calculateEngineering(input)` devuelve `EngineeringResult`. Las exportaciones están en `src/lib/projects/engineering.ts`; el catálogo de referencias está en `src/lib/projects/engineering-sources.ts`.

- El segmento es `RESIDENTIAL`, `COMMERCIAL` o `INDUSTRIAL`. La física no cambia por segmento; cambian datos, reglas aplicables y revisión. Un expediente puede tener sólo un circuito, sólo compensación o sólo materiales sin inventar paneles.
- Las secciones son opcionales; una sección presente debe aportar sus magnitudes mínimas. Ausencias en entradas de diseño se reportan mediante `missingData`. Magnitudes inválidas, NaN, infinitos, fechas mensuales inválidas, periodos repetidos e identificadores duplicados se rechazan con error Zod. No se corrigen silenciosamente.
- Los resultados conservan `assumptions` y `sourceRefs`. Las advertencias tienen `code`, `severity`, `path`, `message` y `sourceRefs`; las severidades son `INFO`, `REVIEW` o `BLOCKER`.
- `DRAFT`: no se calculó ningún estudio. `NEEDS_REVIEW`: hay faltantes, incompatibilidades o revisión específica pendiente. `READY_FOR_REVIEW`: las comprobaciones implementadas se pudieron ejecutar; **no es aprobado**. La firma y autorización humana son eventos separados del expediente.
- No se leen reloj, internet, archivos o variables de entorno. Mismas entradas producen mismos resultados. El módulo no importa React ni código de servidor.
- Las revisiones del expediente deben congelar entrada completa, salida, versión del motor, versiones de catálogo y ajustes. Cambiar cualquier entrada invalida la revisión calculada. No generar documentos aprobados con valores de una revisión diferente.
- El motor es una función matemática y no constituye un límite de autorización. Antes de invocarlo desde una API, el servidor debe resolver `reviewed`, `version` y `sourceRef` contra catálogos/reglas autorizados. Un valor `reviewed: true` enviado por un cliente **no prueba aprobación**.

Ejemplo mínimo de cálculo útil y explícitamente incompleto:

```ts
calculateEngineering({
  segment: "RESIDENTIAL",
  solar: {
    moduleCount: 10,
    module: { model: "Modelo capturado", powerW: 550, sourceRef: "documento:ficha-modulo" },
    performanceRatio: 0.8,
    performanceRatioSourceRef: "revision:criterio-perdidas",
    monthlyResource: [{
      month: "2026-01", dailyPlaneOfArrayKwhM2: 5,
      sourceRef: "documento:recurso-del-sitio", datasetPeriod: "periodo verificado",
      tiltDeg: 20, azimuthDeg: 0,
    }],
  },
});
```

El ejemplo produce 682 kWh para enero. No emite generación anual ni compatibilidad eléctrica; lista los campos faltantes. Los números son ilustrativos, no datos para cotizar.

## Métodos y límites

| Familia | Entradas / ecuación | Condición y salida |
|---|---|---|
| Consumo | Mes `YYYY-MM`, kWh, documento y confirmación por mes | Se suman únicamente meses confirmados. Sólo doce meses consecutivos producen `annualKwh`. No se distribuye un recibo bimestral automáticamente. |
| Generación | `Pdc = módulos × Wp / 1000`; `E_mes = Pdc × HSP_plano × días_mes × PR` | HSP es energía diaria del plano en kWh/m² dividida entre irradiancia de referencia 1 kW/m². Se usa calendario UTC, incluidos bisiestos. Doce meses consecutivos permiten el total anual; un periodo parcial conserva sólo su total. |
| Temperatura | `V(T) = V_STC × (1 + beta_pct/100 × (T_celda − 25))` | Necesita coeficientes Voc/Vmp y extremos de celda. Se comprueban Voc frío, Vmp caliente y Vmp frío; no se sustituye temperatura de celda por clima medio. Corrección a irradiancia de referencia, sin modelado horario de irradiancia. |
| Cadenas | Tensiones multiplicadas por módulos en serie; corrientes por cadenas en paralelo | Mínimo serie = techo de MPPTmin/Vmp_caliente. Máximo = menor de pisos de VDCmax/Voc_frío y MPPTmax/Vmp_frío. Se revisan cantidad de MPPT, corriente operativa, Isc de diseño y potencia DC máxima. Todas las cadenas de un MPPT usan el mismo módulo y longitud. |
| Sombra | `h = L_panel × sen(inclinación)`; `hueco = (h + obstáculo)/tan(elevación)`; `paso = L_panel × cos(inclinación) + hueco` | Geometría sobre terreno horizontal, sol perpendicular a las filas, elevación de diseño aportada. No modela un año de sombras, desniveles, azimut del sol ni obstáculos 3D. |
| Caída de tensión | `R = resistividad/sección`; DC: `2 I L R`; AC: `k I L (R cosφ + X senφ)` | `k = 2` monofásico y `√3` trifásico equilibrado; L de ida, R y X en Ω/m. X se recibe en Ω/km y se convierte. Tensión DC/monofásica del circuito; trifásica entre fases. |
| Ampacidad | Menor de `base × factor_temperatura × factor_agrupamiento` y límite de terminales | Tabla/factores/versiones revisados. Se compara con `I × multiplicador requerido`. La resistividad se suministra a la temperatura declarada; no se repite la corrección. |
| Protección/tierra | Dispositivo entre `I × multiplicador mínimo`, máximo de regla y ampacidad corregida; sección de tierra ≥ mínimo de regla | Sólo compara una regla aprobada explícita. No calcula cortocircuito, capacidad interruptiva, selectividad, contribución de fuentes ni reglas especiales del tablero. |
| Canalización | Ocupación = área exterior total de cables / área interior del ducto | Compara límite de llenado y medidas explícitas de catálogo revisado; no usa la sección metálica del conductor como diámetro exterior. |
| Capacitores | `Qc = P × (tan(acos(FP_medido)) − tan(acos(FP_objetivo)))`; `S = P/FP` | Sólo carga inductiva sinusoidal; FP objetivo ≥ medido. Distorsión desconocida bloquea Qc. Siempre estimación pendiente de ingeniería; sin banco, pasos, filtros, protecciones ni garantía de ahorro. |
| Materiales | Filas × módulos/fila; fijaciones/módulo; conectores/cadena; rieles según anchura, separación y extremos; recorridos × piezas paralelas | Reserva explícita para piezas y longitudes, sin paneles adicionales por merma. Riel comprado por línea completa; otras partidas por unidad comercial. No se supone aprovechamiento de recortes. |
| Calidad/frecuencia | Objetivo, instrumento, fecha, evidencias y hallazgos manuales | Estado de evidencia/revisión. Sin algoritmo ficticio de armónicos o filtros. |

Fuentes de métodos: [rendimiento fotovoltaico, NREL](https://research-hub.nlr.gov/en/publications/performance-parameters-for-grid-connected-pv-systems-2/), [recurso y metadatos, JRC-PVGIS](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en), [temperatura, Sandia](https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/point-value-models/sandia-pv-array-performance-model/), [series y paralelo, Sandia](https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/), [caída de tensión, Schneider Electric](https://www.electrical-installation.org/enwiki/Calculation_of_voltage_drop_in_steady_load_conditions), [compensación reactiva, Schneider Electric](https://www.electrical-installation.org/enwiki/Theoretical_principles_to_improve_power_factor). Las ecuaciones de geometría y cantidades son reconstrucción ENNCO documentada; no se atribuyen al Excel recuperado.

`solar` representa un inversor con distribución por MPPT. Para plantas de múltiples inversores, `solarSystems: [{ id, design }]` permite calcular cada inversor con sus módulos, recurso y límites independientes. `design` utiliza exactamente el esquema de `solar`; no se pueden enviar ambos formatos simultáneamente. La salida conserva `solarSystems: [{ id, solar }]` y `solarTotals` con capacidad, generación mensual y total anual. La generación se agrega sólo si todos los inversores tienen los mismos periodos calculados; si falta un cálculo se informa el faltante y no se presenta la suma parcial como total de la planta. El autoconsumo y el montaje se contrastan con los totales del proyecto. Un mismo MPPT no admite longitudes, módulos u orientaciones mezcladas; la interacción eléctrica del conjunto en el tablero requiere revisión adicional. El PR incluye pérdidas globales declaradas, entre ellas recorte; no se estima clipping horario. No se calculan batería, despacho ni almacenamiento. Esta limitación debe permanecer visible al usar los resultados.

### Escenario económico de energía

`consumption.tariff` representa un **escenario energético uniforme revisado** con MXN/kWh, cargo fijo mensual, cargo de demanda mensual y vigencia. El autoconsumo debe confirmarse por periodo, con fuente propia. No se deduce como mínimo de generación/consumo: esa cifra sólo sería un límite superior sin información temporal. Se rechaza una coincidencia imposible que exceda el consumo o la generación calculada del mes.

`antes = consumo × precio_energía + fijo + demanda`; `ahorro = autoconsumo × precio_energía`; `después = antes − ahorro`. La demanda permanece íntegra. El importe histórico del recibo se guarda y suma por separado; no se reescribe para hacerlo coincidir con el escenario.

**No es un motor completo de facturación CFE.** Faltan tablas vigentes por tarifa/región, escalones domésticos, subsidios, periodos horarios, demanda por ventanas de medición, saldo/compensación de excedentes, impuestos y mínimos aplicables. Por eso emite `TARIFF_SCENARIO` y requiere revisión. No genera TIR, VAN, financiamiento ni retorno a partir de ahorros incompletos. La separación entre componentes está respaldada por la publicación de [CFE GDMTO](https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCREIndustria/Tarifas/GranDemandaMTO.aspx).

## Trazabilidad de las 37 hojas comunes

La relación procede de `comparison.json` y de la inspección estática de VBA del archivo recibido. Las hojas agrupadas comparten destino, no fórmulas verificadas.

| Hojas originales | Destino / recuperación |
|---|---|
| Inicio, Menu_Principal, Menu_Accesos | Navegación de proyectos. El VBA de apertura de menús aporta intención; no se ejecuta en web. |
| Cal_Ing_Bas, Cal_Cir_Ele | Organización de estudios y circuitos; motores nuevos con datos explícitos. |
| Cotizador_G | Presupuesto comercial versionado, separado del presupuesto de ejecución. |
| Cal_Tarifa_Industrial, Cal_Tarifa_Comercial, Cal_Tarifa_Residencial | Recibos y escenarios. Reconstrucción tarifaria completa pendiente de reglas vigentes y casos de Paco. |
| Inf_Vac_Res, Inf_Vac_Com, Inf_Vac_Ind | Captura compartida, consumos confirmados, sitio y levantamiento. No repetir automáticamente un consumo mensual doce veces. |
| Tarifas | Catálogo versionado, revisión por región y periodo; valores históricos no se activan como tarifas vigentes. |
| Inf_Irrad_Sol, Gen_Energía | Recurso con metadatos y generación mensual. Fórmulas reconstruidas, sin extraerlas de caches de gráficos. |
| Inf_Apoyo, Inf_Factor_K | Catálogo de criterios/factores; no trasladar constantes sin unidades ni validación. |
| Cal_Sombra_Apoyo, Cal_Sombra | Geometría explícita del plano y condición de diseño. |
| Cal_Inv_St | Selecciones MPPT reconstruidas desde límites de ficha y temperatura; matrices históricas no son algoritmos recuperados. |
| Cal_Consumo | Historial confirmado. Macro conservada sólo copiaba D65 a doce filas; no recuperó D65. |
| Vigencia | Vigencia documental por revisión; se excluye caducidad/borrado del programa. |
| Estudio_Res, Estudio_Com, Estudio_Ind | Propuesta y expediente técnico de la revisión guardada, fotos y sembrado. Exportación VBA ofrece intención de presentación. |
| Inf_Módulos, Inf_Inversor | Fichas oficiales por modelo/revisión, desacopladas de precio. |
| Tab_Amp_Cir_AC, Inf_Tab_Cab | Ampacidad y conductores revisados con fuente y condiciones. Búsqueda VBA por umbral no acredita cálculo normativo. |
| Inf_Sistema_De_Montaje | Medidas, reglas de piezas y formatos comerciales; requiere aprobación de instalación. |
| Usuarios | Excluida de importación; autenticación/capacidades del dashboard. No copiar contraseñas o literales de protección. |
| Cal_Cir_Ele_DC, Cal_Cir_Ele_AC, Cal_Cir_Ele_Tab | Circuitos y reglas revisadas; tablero puede organizar circuitos, pero capacidad de barras, alimentación múltiple y cortocircuito necesitan revisión específica. |
| Cal_Fac_Pot | Estimación de kvar y expediente manual de calidad; no se encontró algoritmo de compensación en VBA. |
| Precios_SFV | Costos versionados por proveedor, unidad, moneda y vigencia. |
| Textos | Plantillas/documentos revisados; no implica aceptación jurídica de términos históricos. |

La hoja adicional `Recuperacion` documenta el estado recuperado y no se convierte en módulo de negocio. Las macros de acceso, borrado por caducidad y envío oculto por Outlook se excluyen. Limpiar captura se adapta a reiniciar un borrador con confirmación; exportar y colocar imagen usan documentos de la revisión sin automatizar envíos.

## Actualización e investigación pendiente

Las fuentes del motor documentan métodos, **no contienen tarifas ni equipos aprobados para producción**. Se requieren conjuntos de datos con fuente, periodo aplicable, región/modelo, fecha de consulta, versión, unidades y decisión del revisor. Una actualización no cambia una propuesta emitida.

| Conjunto | Trabajo para cerrar datos operativos | Evidencia de aceptación |
|---|---|---|
| Tarifas | Consultar publicaciones CFE de cada familia usada, periodos/regiones y resoluciones aplicables. No se presupone API ni estabilidad de tablas HTML. | Caso por familia, meses de verano/invierno si aplican, bandas y demanda, cálculos independientes y recibo confirmado. |
| Recurso solar | Comparar cobertura JRC-PVGIS con NASA POWER y PVWatts según ubicación. Registrar plano, orientación, periodos y unidades; no sustituir recurso horizontal por plano inclinado sin transformación. | Sitio y estudio trazables; diferencia frente a simulación de referencia documentada. |
| Extremos de diseño | Acordar fuente meteorológica y conversión a temperatura de celda de diseño, conforme a ficha/equipo. | Caso frío y caliente revisados por ingeniería. |
| Electricidad | Revisar norma aplicable, artículos/tablas y método de instalación; [NOM-001-SEDE-2012 identificada](https://e.economia.gob.mx/wp-content/uploads/sites/29/PDF_Normas_Publicas/001sede2012.pdf), pero descarga falló en esta consulta y no se ha validado vigencia/aplicación integral. | Catálogos aprobados de ampacidad, agrupamiento, temperatura, protección, tierra, canalización y tablero, con condiciones de uso. |
| Equipos/montaje | Ficha oficial por modelo/variante; conectores compatibles; regla de montaje, viento/anclaje y revisión de estructura. | Selecciones y cantidades verificadas en levantamiento. |
| Precios/cambio | Listas o cotizaciones identificables del proveedor, vigencia y moneda; tipo comercial confirmado. | Presupuesto conciliado, método de precio y margen definidos por Administración. |
| Recibos | Extracción de texto PDF y OCR local en español ya implementados para JPG/PNG y primera página de PDF escaneado sin texto utilizable. Revisión de candidatos y captura manual siempre disponibles. Evaluar opciones por consumo con recibos autorizados. | Exactitud por campo, ambigüedades, correcciones, tiempo, costo/documento y tratamiento de datos. El OCR tiene límite de tiempo y tamaño y no consulta un proveedor externo. Revisar páginas adicionales de PDF escaneado manualmente. Las pruebas sintéticas no demuestran precisión operativa sobre recibos reales. |

Validaciones con Paco necesarias antes de aprobación técnica: cobertura exacta de tarifas/configuraciones, datos para preliminar frente a selección final, ahorro sin curvas horarias, criterio de pérdidas, extremos térmicos, reglas de montaje/merma, dispositivos permitidos, calidad/armónicos y criterios de aceptación. Administración debe validar definición de margen, precio USD/W, impuestos, condiciones y contrato. El sistema puede guardar borradores mientras esas decisiones siguen pendientes; no debe presentar resultados como ingeniería aprobada.

## Pruebas y aceptación

`engineering.test.ts` usa especificaciones sintéticas con valores calculados independientemente: 5 kWp a 20 kWh/día = 7,300 kWh/año, Voc frío de 537.5 V, caída DC de 5 V, compensación de 75 kvar para triángulo 3-4-5, y geometría de sombra de 1 m. No son proyectos reales de Paco ni certifican sus parámetros.

Se prueban los tres segmentos, múltiples inversores sin doble conteo, periodos consistentes entre subsistemas, bisiestos, entradas incompletas, periodos duplicados, incertidumbre de tarifas, autoconsumo imposible, rango MPPT, sobrevoltaje/corriente, límite DC, ampacidad/terminales/protecciones, suelo de cálculo negativo, reactancia AC, ocupación de ductos, compras por tramos, calidad manual, ausencia de mutaciones y determinismo.

La aceptación operativa exige además casos reales residencial/comercial/industrial revisados por Paco, contraste independiente con tolerancia específica por resultado, expedientes completos, documentos iguales a la revisión guardada y autorización humana trazable. No tratar pruebas unitarias ni `READY_FOR_REVIEW` como sustituto de esa validación.

## Dimensionamiento preliminar y retorno simple

Se añadió `economics.ts` con dos funciones separadas para conservar el origen y las limitaciones de cada estimación.

`preliminarySizingSchema` / `estimatePreliminarySizing(input)` requieren demanda anual declarada, cobertura objetivo, potencia por módulo, PR, fuente y doce meses consecutivos de recurso del mismo plano y periodo meteorológico. La energía anual por kWp es la suma de HSP × días × PR; la potencia mínima divide la energía objetivo entre ese rendimiento. Se redondea hacia arriba la cantidad de módulos y se devuelve la potencia resultante, generación mensual/anual y cobertura energética obtenida. Un recurso nulo, periodos faltantes o planos mezclados se rechazan.

Esta función se integra como `engineeringInput.preliminarySizing` y `engineeringResult.preliminarySizing`. Se guarda dentro de la revisión junto a fuente, supuestos y advertencias y aparece en la memoria técnica. El estado sigue requiriendo revisión: se propone cantidad por energía, sin inventar inversor, espacio, MPPT ni ahorro económico. La cobertura después de redondear puede superar el objetivo; se muestra sin recortarla ni equipararla con autoconsumo.

`proposalEconomics(proposal, calculation)` calcula exclusivamente **retorno simple antes de IVA** desde la revisión vinculada a la propuesta. Necesita doce consumos confirmados y doce escenarios mensuales correspondientes al mismo periodo, totales conciliados, inversión de venta sin IVA y costo anual de operación **explícito** del sistema del cliente. Cero sólo se usa si se capturó expresamente. Si falta información, hay incompatibilidades bloqueantes o el ahorro anual no supera operación, devuelve `simplePaybackYears: null`, estado `UNAVAILABLE` y motivos.

La aritmética es `inversión / (ahorro energético anual - operación anual)`. El resultado positivo es estado `ESTIMATE`, conserva periodo, cálculo, hash, versión y fuentes. No incorpora costo interno ni margen ENNCO. Tampoco descuenta flujos, calcula TIR/VAN, inflación, reposición, degradación o financiamiento; no hace pronósticos de tarifas. Es un escenario simple del componente energético, con las limitaciones tarifarias ya documentadas.

La API congela el resultado en `proposal.data.economics` después de calcular el precio; el PDF comercial sólo incluye inversión, ahorros, operación del sistema, plazo y limitaciones permitidos. Las pruebas contrastan un caso independiente: inversión 10,000 MXN, ahorro anual 2,400 MXN y operación 400 MXN dan cinco años, excluyendo IVA. También cubren meses/años incompatibles, operación faltante/negativa, ahorro no positivo, redondeo de módulos, bisiesto y exposición de información interna.
