# Segmentación de Apollo — ENNCO

Versión 2026-09-02. **Medida en vivo, no estimada**: cada cifra de este documento
salió de una búsqueda real contra Apollo el 2 de septiembre de 2026, con **cero
créditos gastados** (10/4,010 consumidos antes y después; la búsqueda de personas
es gratis, la de empresas cuesta 1 crédito por request con resultados).

Hasta hoy la segmentación existía sólo dentro de dos corridas puntuales y en la
metodología del sourcing público. Esta hoja la deja explícita y copiable.

## 1. El filtro base

Es el ICP contractual traducido a los campos que Apollo entiende. Todo segmento
parte de aquí:

| Campo de Apollo | Valor | De dónde sale |
|---|---|---|
| `organization_naics_codes` | `["31","32","33"]` | Manufactura. El repo razona en SCIAN; Apollo pide NAICS, y ambos están armonizados a nivel de sector y subsector, así que 31-33 es equivalente al 31-33 del SCIAN |
| `person_locations` | `["Guanajuato, Mexico","Queretaro, Mexico"]` | Corredor León–Querétaro |
| `organization_num_employees_ranges` | `["101,200","201,500","501,1000","1001,2000","2001,5000","5001,10000","10001,20000"]` | Proxy de >100 kWp. No existe padrón público de grandes consumidores de CFE |
| `contact_email_status` | `["verified"]` | Sólo cuando se va a contactar; para dimensionar, omitir |

**Dos precisiones que cuestan tiempo si se ignoran:**

- **`person_locations`, no `organization_locations`.** El primero filtra dónde
  vive la persona; el segundo, dónde está la sede. Las plantas del Bajío de
  multinacionales cuelgan del corporativo global (P&G, Lear, Kirchhoff, Eaton),
  así que filtrar por sede las pierde todas.
- **El tamaño es de la empresa, no de la planta.** P&G aparece con más de 10,000
  empleados aunque su planta de Apaseo tenga unos cientos. El filtro sirve para
  descartar talleres, no para medir la planta.

## 2. Los cuatro segmentos, con sus títulos

Uno por cada variante del copy. Se aplican sobre el filtro base.

### A · Dirección general
```
person_titles: ["director general","gerente general","plant manager",
                "director de planta","gerente de planta","plant director",
                "general manager","country manager"]
```

### B · Mantenimiento y planta
```
person_titles: ["maintenance manager","gerente de mantenimiento",
                "jefe de mantenimiento","maintenance supervisor",
                "supervisor de mantenimiento","facilities manager",
                "gerente de instalaciones","maintenance engineer"]
```

### C · Seguridad e higiene
```
person_titles: ["seguridad e higiene","safety manager","ehs manager",
                "coordinador de seguridad","jefe de seguridad",
                "health and safety manager","environmental health and safety",
                "gerente de seguridad"]
```

### D · Compras
```
person_titles: ["purchasing manager","gerente de compras","jefe de compras",
                "procurement manager","procurement director",
                "purchasing supervisor","buyer indirect","comprador"]
```

**Criterio fino de compras** (del hallazgo del 1-sep): el comprador de una póliza
es de compras indirectas, servicios o MRO, o un generalista con seniority de
supervisor para arriba. **Se descartan** materials managers y planners, sourcing
engineers de componentes, product supply, becarios, auxiliares y perfiles
customer-facing: esos compran materia prima, no mantenimiento.

## 3. El universo, medido el 2-sep-2026

Todo con el filtro base (manufactura, 101+ empleados):

| Segmento | Guanajuato + Querétaro |
|---|---:|
| Universo sin filtro de cargo | **29,299** |
| A · Dirección general | 402 |
| B · Mantenimiento | 443 |
| D · Compras | 428 |
| C · Seguridad e higiene | 146 |
| **Los cuatro perfiles, con correo verificado** | **644** |

Sub-segmento premium — sólo sectores intensivos en energía
(`["322","325","326","327","331","336"]`: papel, química, plástico, minerales no
metálicos, metálicas básicas y autopartes) y 201+ empleados: **665 personas**.

**Dimensionamiento:** el gate de arranque pide 150 contactos verificados. Sólo
Guanajuato y Querétaro ya ofrecen 644 con correo verificado, más de cuatro veces
lo necesario. La restricción del programa no son los datos.

## 4. El hallazgo: la mitad del mercado contractual está fuera del sistema

El contrato (cláusula 01) cubre **Guanajuato, Querétaro, Jalisco y Michoacán**.
El código sólo admite dos: `src/lib/research/contracts.ts` acepta `GUANAJUATO` y
`QUERETARO`, y la verificación de cuentas descarta lo demás.

Medido con exactamente los mismos filtros:

| | Contactos objetivo | Con correo verificado |
|---|---:|---:|
| Guanajuato + Querétaro (lo que el sistema cubre) | ~1,419 | **644** |
| **Jalisco + Michoacán (lo que ignora)** | **1,475** | **758** |

**Hay más mercado contractual afuera que adentro.** Jalisco y Michoacán suman un
18% más de contactos alcanzables que los dos estados que sí se trabajan, y ya hay
176 registros de PROFEPA de esos estados descargados en
`data/imports/raw/sourcing-2026-08-26/profepa-jal-mich.csv` que nunca entraron a
un lote.

No es sólo mercado sin explotar: es alcance firmado que el sistema no atiende, y
por lo tanto un incumplimiento silencioso si alguien lo revisa.

## 5. Reglas de uso

- **Créditos.** La búsqueda de personas es gratis; la de empresas cuesta 1 crédito
  por request que devuelva resultados. Enriquecer (revelar correos) sí cuesta y
  tiene tope aprobado de 300 créditos para la fase de verificación. Snapshot antes
  y después de cualquier corrida, siempre.
- **Anexo A.** POSCO MPPC, MPE Plastic y Laproba El Águila quedan fuera de todo,
  con marcador explícito. Apollo no conoce esa lista: la exclusión se aplica del
  lado nuestro, contra `suppression_entries`.
- **Nada se contacta desde Apollo.** La secuencia sale por el motor propio, desde
  `francisco@enncoindustrial.com`. Apollo es fuente de datos, no canal.
- **Los apellidos vienen enmascarados** en los resultados de búsqueda; se revelan
  al enriquecer. Es comportamiento normal del plan, no un dato faltante.

## 6. Cómo se conecta con lo demás

La segmentación de Apollo **complementa**, no sustituye, al sourcing público
(1,831 empresas de PROFEPA, DENUE y directorios de parques). La diferencia:

- **El sourcing público da cuentas** con evidencia verificable y URL de origen, que
  es lo que el contrato exige para documentar un lead.
- **Apollo da personas** con cargo y correo, que es lo que hace falta para
  contactar.

El orden correcto es: cuenta con señal pública → contacto en Apollo dentro de esa
cuenta → verificación → secuencia. Nunca al revés: una persona de Apollo sin
cuenta con señal no cumple las cinco condiciones del lead calificado.
