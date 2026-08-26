# Sourcing ENNCO — Fuentes de prospección públicas (Gto/Qro)
Fecha de adquisición: 2026-08-26. Todas las fuentes son públicas y oficiales o directorios públicos de primera mano. Ningún dato inventado: campo vacío = la fuente no lo trae.

## 1. Inventario de archivos

| Archivo | Qué es | Filas |
|---|---|---|
| `profepa-raw-2026-08-26.csv` (+`.meta.json`) | Padrón crudo PNAA certificados VIGENTES (nacional) | 1,245 |
| `profepa-emitidos-raw-2026-08-26.csv` (+`.meta.json`) | Padrón crudo PNAA certificados EMITIDOS en el año (nacional) | 301 |
| `profepa-gto-qro.csv` | PROFEPA filtrado a Guanajuato + Querétaro | 84 |
| `profepa-jal-mich.csv` | PROFEPA filtrado a Jalisco + Michoacán (secundario) | 176 |
| `raw/denue_11_csv.zip` / `raw/denue_22_csv.zip` (+`.meta.json`) | DENUE crudo INEGI (versión 2026-05-20): Gto 296,441 / Qro 108,868 unidades | — |
| `denue-gto-qro-manufactura-grande.csv` | DENUE SCIAN 31-33, estratos 101-250 y 251+, ambos estados | 1,297 |
| `cruce-semillas.csv` | Las 27 semillas del directorio vs PROFEPA y DENUE | 27 |
| `parques-industriales.csv` | Inquilinos de los 7 parques objetivo (4 fuentes) | 422 |
| `parques/piq_directorio_2024.pdf` / `piq_directorio.pdf` | Directorio oficial PIQ crudo | — |
| `tier1-top50.csv` | Top 50 candidatos Tier 1 con señal pública y evidencia | 50 |

## 2. PROFEPA — Programa Nacional de Auditoría Ambiental

**Fuente**: datos.gob.mx (org. PROFEPA, licencia CC-BY-4.0, metadata 2026-02-19).
- Vigentes: `https://repodatos.atdt.gob.mx/api_update/profepa/certificados_vigentes_fecha_programa_nacional_auditoria_ambiental/certificados_vigentes_pnaa.csv`
- Emitidos: `https://repodatos.atdt.gob.mx/api_update/profepa/certificados_emitidos_programa_nacional_auditoria_ambiental/certificados_emitidos_pnaa.csv`

**Conteos por estado (objetivo + secundario):**

| Estado | Vigentes | Emitidos en el año | Total |
|---|---|---|---|
| Guanajuato | 17 | 5 | 22 |
| Querétaro | 44 | 18 | 62 |
| **Subtotal objetivo** | **61** | **23** | **84** |
| Jalisco | 113 | 15 | 128 |
| Michoacán | 32 | 16 | 48 |

Vigencias del padrón vigente nacional: 2025=174, 2026=635, 2027=436. Tipos: Calidad Ambiental 739, Industria Limpia 476, Calidad Ambiental Turística 30.

**Limitación dura del dato público**: el CSV oficial solo trae `nombre_instalacion, estado, anio_vigencia, tipo_certificado`. NO trae municipio, giro ni fechas exactas — esas columnas van vacías en `profepa-gto-qro.csv` (no se inventaron). El municipio se resolvió por cruce contra DENUE (ver §6).

## 3. DENUE (INEGI, versión 2026-05-20)

**Fuente**: descarga masiva por entidad — `https://www.inegi.org.mx/contenidos/masiva/denue/denue_11_csv.zip` (Gto) y `denue_22_csv.zip` (Qro), desde `https://www.inegi.org.mx/app/descarga/`. No hizo falta la API con token: la descarga por archivo trae el universo completo.

**Filtro**: SCIAN sector 31-33 (manufactura) + estrato de personal 251+ (y 101-250 por volumen manejable).

| Estado | 251+ | 101-250 | Total |
|---|---|---|---|
| Guanajuato | 421 | 384 | 805 |
| Querétaro | 255 | 237 | 492 |
| **Total** | **676** | **621** | **1,297** |

**Corredor (conteo por municipio):**

| Municipio | 251+ | 101-250 |
|---|---|---|
| León | 114 | 171 |
| Querétaro | 106 | 98 |
| El Marqués | 76 | 66 |
| Silao de la Victoria | 66 | 47 |
| Irapuato | 64 | 38 |
| Celaya | 38 | 42 |
| Apaseo el Grande | 30 | 9 |
| Salamanca | 13 | 5 |
| Colón | 10 | 14 |
| Apaseo el Alto | 2 | 1 |
| **Total corredor** | **519** | **491** |

Nota técnica: los CSV del DENUE vienen en Latin-1, no UTF-8 (el primer filtro perdió el estrato "251 y más" por eso; corregido y re-verificado).

## 4. Cruce con las 27 semillas (`cruce-semillas.csv`)

- **21 de 27** tienen registro localizable en DENUE (señal pública "DENUE").
- **0 de 27** aparecen en el padrón PROFEPA (ni vigentes ni emitidos, a nivel nacional). El copy NO puede afirmar certificado PROFEPA de ninguna semilla.
- Sin match (6): Hope Global, Villaserre Invernaderos, WELDCOAT de México, Agrícola Zarattini, 4AP de México, HEWELDCOAT de México.
- Hallazgos que corrigen a las semillas: NPAMX = Nippon Pain(t) Automotive Coating México (101-250, Silao); Mitsui Kinzoku ACT Mexicana está en Silao, no Irapuato; Conecel aparece como "Manufacturera Conecel" (Celaya); Grupo Ameristeel lo ubica DENUE en municipio Querétaro; Plastic Omnium opera hoy como OPmobility (unidad Inergy León 11-30; hay otra unidad 251+ en Silao); el "Instituto IECA-AAM" es un centro educativo del Gobierno de Guanajuato, no planta.

## 5. Parques industriales (`parques-industriales.csv`, 422 filas)

| Parque | Filas | Fuente primaria |
|---|---|---|
| Parque Industrial Querétaro | 181 | Directorio oficial PDF 2024 (`https://piq.com.mx/files/DIRECTORIO_EMPRESAS_PIQ_2024.pdf`, ~151 empresas con giro y nacionalidad) + DENUE |
| Guanajuato Puerto Interior | 99 | Blog oficial GPI gob. Gto 2024-07-12 (36 nombradas de ~130) + DENUE (colonia) |
| Castro del Río (Irapuato) | 41 | Sin directorio primario público → DENUE (colonia) |
| El Marqués (zona industrial) | 34 | Sin directorio primario público → DENUE (colonia) |
| Bernardo Quintana | 30 | Sin directorio primario público → DENUE (colonia) |
| Colinas de León | 29 | Municipio de León (`https://investment.leon.gob.mx/es/colinas-de-leon.php`, 17 empresas) + DENUE |
| FIPASI (Silao) | 8 | fipasi.com NO publica directorio de inquilinos (verificado 2026-08-26) → DENUE (colonia) |

Método DENUE→parque: el campo `nomb_asent` (colonia) del DENUE nombra el parque; es fuente oficial y uniforme. Accesibilidad anotada: FIPASI, Castro del Río, El Marqués y Bernardo Quintana no tienen directorio propio público de primera mano (solo agregadores de terceros, que NO se usaron).

## 6. Solapamiento estimado

- PROFEPA (Gto+Qro, 84 certificados) ∩ DENUE 101+ manufactura: **20 instalaciones** identificadas con match estricto (≥0.80). El resto son instalaciones de servicios/turismo, plantas <101 empleados, o razón social divergente entre padrones.
- De esas 20, **10 están en el corredor** y encabezan el Tier 1.
- Varios certificados Qro caen fuera del corredor (San Juan del Río, San José Iturbide, Pedro Escobedo): Clarion, Cartones Ponderosa, Imbera, Mitsubishi Electric, PPG, Thor Químicos, Hella, International Paper, Flex N Gate — segundo anillo útil.
- Semillas ∩ parques: las 27 semillas provienen mayormente de Colinas de León, FIPASI, Puerto Interior, Castro del Río y Amistad Bajío; el cruce por parque está implícito en `parques-industriales.csv`.

## 7. Tier 1 — Top 50 (`tier1-top50.csv`)

Universo: 497 empresas únicas 251+ del corredor. Score: certificado PROFEPA (+4), SCIAN intensivo en energía 322/325/326/327/331/336 (+2), parque industrial identificado (+1). Los 10 primeros (señal más fuerte = certificado PROFEPA vigente + 251+ empleados + corredor):

1. STEERINGMEX (El Marqués, 336330, Industria Limpia vigente)
2. VENTRAMEX (El Marqués, 336340, Industria Limpia vigente)
3. CIMA — Consorcio Industrial Mexicano de Autopartes (Silao, 336360, Industria Limpia vigente)
4. PROCTER & GAMBLE MARISCALA (Apaseo el Grande, 325620, Industria Limpia vigente)
5. AUTOLIV (El Marqués, 336390, Industria Limpia vigente)
6. LEAR CORPORATION PLANTA LEÓN (León, 336360, Industria Limpia vigente)
7. KIRCHHOFF AUTOMOTIVE MÉXICO (Querétaro, 336370, Industria Limpia vigente)
8. TROQUELADORA BATESVILLE (Querétaro, 332110, Industria Limpia vigente)
9. EATON / Bussmann (Querétaro, 335999, Industria Limpia vigente)
10. INDUSTRIA ENVASADORA DE QUERÉTARO (Querétaro, 312111, Industria Limpia vigente)

Los 40 restantes: 251+ del corredor con SCIAN intensivo en energía (metálicas básicas, plástico/hule, química, papel, autopartes) — Hanwa, Beta Procesos, Faist Alucast, ThyssenKrupp Materials Silao, Usui, Mubea, Yorozu, Arbomex, CIE Celaya, Monroe, Irizar, TRW, Graham Packaging, Kasai, etc. Cada fila trae `senales_publicas` + `source_urls` + `source_date`.

## 8. Exclusiones Anexo A

- **LAPROBA EL ÁGUILA** (León, 251+) → marcada `EXCLUIDO_ANEXO_A` en el DENUE filtrado; fuera del Tier 1.
- **POSCO MPPC** (Celaya, 101-250) → marcada `EXCLUIDO_ANEXO_A`.
- **MPE / Materias Plásticas y Elastómeros de México** (León, 51-100): está por DEBAJO del corte 101+, así que no aparece en los CSV filtrados, pero existe en el DENUE completo — si alguna fase posterior baja el corte, hay que excluirla.
- OJO: existe **POSCO MVWPC** (Villagrán, 101-250), entidad relacionada pero distinta a POSCO MPPC. NO se marcó como excluida (el Anexo A nombra solo a MPPC); decidir con ENNCO si la exclusión alcanza a todo el grupo POSCO.

## 9. Qué faltó por conseguir

1. **Municipio/giro/vigencia exacta en PROFEPA**: el dataset público no los trae; el histórico con más campos vivía en el portal viejo (innovaportal) y no está publicado como dataset. Mitigado vía cruce con DENUE (20/84 resueltas).
2. **Demanda eléctrica real**: no existe padrón público de CFE de grandes consumidores (GDMTH). El estrato de personal 251+ es proxy, no confirmación de >100 kWp.
3. **RENE (Registro Nacional de Emisiones, SEMARNAT)**: siguiente fuente pública fuerte (obligadas >25,000 tCO2e = grandes consumidores de energía casi por definición). No descargado en esta pasada — recomendado como siguiente paso.
4. **Directorios primarios de FIPASI, Castro del Río, El Marqués y Bernardo Quintana**: no existen públicos; cubierto vía DENUE (colonia). El de GPI solo nombra 36 de ~130 empresas en su blog oficial.
5. **Teléfono/web en DENUE**: vienen solo cuando el establecimiento los reportó; muchos campos vacíos (correcto: no se rellenaron).
6. Emails y personas: fuera de alcance por diseño (fase Apollo posterior).
