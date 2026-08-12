# QA de importación de fuentes ENNCO

## Estado

PASS para extracción y normalización reproducible. Los registros en cuarentena permanecen bloqueados para outreach y requieren resolución humana.

## Herramienta y alcance

- Lector obligatorio: `@oai/artifact-tool` 2.8.39.
- Se conservaron copias binarias exactas y extracciones de valores y fórmulas.
- La ejecución lee únicamente las copias raw repo-relative. Las rutas originales son metadata informativa y no son dependencia.
- Todo valor CSV que empieza con `=`, `+`, `-` o `@` se prefija con apóstrofo. El JSON conserva el valor raw.
- Sólo se normalizaron rangos tabulares declarados. Las hojas gráficas permanecen preservadas dentro del XLSX raw.
- No se generaron contactos, leads, oportunidades ni pipeline.

## Fuentes congeladas

| Fuente | SHA256 | Tamaño | Rango estructurado |
|---|---|---:|---|
| clientes....xlsx | 8bc5d60d1c90259e039480f7ea4408532408e8670c72658eb6b369b5359088ac | 13000 bytes | Hoja1!D7:I28 |
| Directorio_Empresas_Corredor_Leon_Queretaro.xlsx | 3cc14f924014e0be31cc4db1b9daca52850e5a07d189c4825771de9e997f7347 | 6293063 bytes | Directorio corredor!A1:H28; Resumen!A1:B8 |

## Histórico de proyectos

- Registros: 20.
- Ventas totales: $8411668.31 MXN.
- Fotovoltaicos: 18; mantenimiento eléctrico: 2.
- Fechas presentes: 19; faltantes: 1.
- Capacidad normalizada: 277895 Wp = 277.895 kWp.
- Duplicados exactos por clave de proyecto: 0.
- Outliers de venta por kWp para revisión manual: VALLE DE LOS REYES, VIÑA DEL MAR. Se preservan, pero quedan excluidos de calibración automática.

### Corrección de unidad

La fuente etiqueta la columna como `TAMAÑO kWp`, pero las fórmulas son multiplicaciones de cantidad de paneles por potencia nominal, por ejemplo `=4*620` y `=85*645`. Por ello, la capa normalizada conserva el valor como `capacity_wp` y deriva `capacity_kwp = capacity_wp / 1000`. El valor raw, encabezado y fórmula quedan preservados.

## Portabilidad y seguridad CSV

- Fuentes canónicas: `data/imports/raw/**`, verificadas contra SHA256 antes de leer.
- Dependencia de las rutas originales: ninguna. Sólo se conservan como metadata de procedencia.
- Fixtures negativos: seis casos, incluyendo `=`, `+`, `-`, `@` y un número negativo.
- Las 18 fórmulas de capacidad permanecen raw en JSON y neutralizadas como texto en CSV.

## Directorio de empresas

- Registros fuente: 27.
- URLs presentes: 11; faltantes: 16.
- Filas con ubicación marcada "Por verificar": 5.
- Registros en cuarentena: 6.
- Posible duplicado: WELDCOAT de México / HEWELDCOAT de México, similitud 0.8889.
- Registros habilitados para outreach: 0.

Todos los registros permanecen en `RESEARCH_SEED`. La existencia de una empresa en el directorio no prueba elegibilidad, contacto verificado, interés, lead o pipeline.

## Bloqueos humanos

- Resolver las cinco filas marcadas "Por verificar".
- Resolver si WELDCOAT y HEWELDCOAT son la misma entidad, alias o empresas distintas.
- Verificar las 16 empresas sin URL fuente.
- Conciliar contra Anexo A antes de habilitar cualquier registro para outreach.
- Validar con Paco los proyectos excluidos de calibración automática.
