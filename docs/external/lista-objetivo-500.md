# Los primeros 500 correos: a quién y por qué

Versión 3-sep-2026. Artefacto:
`data/imports/research/target-list-2026-09-03/target-list-v1.json`.
Compuerta: `npm run verify:target-list` (11 checks).
Constructor determinista: `scripts/build-target-list-2026-09-03.py`.

Medido en vivo contra Apollo el 3-sep con **cero créditos** (la búsqueda de
personas es gratis; la de empresas cuesta y no se usó).

## Qué hay

| | |
|---|---|
| Empresas priorizadas | **108** |
| Contactos seleccionados | **160** |
| Correos estimados (3 toques) | **480** |
| Universo alcanzable medido | 343 contactos con correo verificado |

Desglose del universo por perfil: mantenimiento 181 · dirección 75 · compras 53
· **seguridad e higiene 34**. Ese último número es el que justifica que seguridad
no sea una categoría obligatoria: es el perfil más escaso del corredor.

## El segmento

Filtro base en Apollo, idéntico al de `segmentacion-apollo.md` pero restringido
al tramo premium:

- `organization_naics_codes`: 322, 325, 326, 327, 331, 336 (papel, química,
  plástico, minerales no metálicos, metálicas básicas, autopartes)
- `person_locations`: Guanajuato y Querétaro
- `organization_num_employees_ranges`: de 201 en adelante
- `contact_email_status`: **verified**, no "likely"

## El score v2, y qué cambió

| Señal | Puntos |
|---|---:|
| **Contacto decisor con correo verificado** | **+5** |
| Certificado PROFEPA-PNAA vigente | +4 |
| Sector intensivo en energía | +2 |
| 201+ empleados | +2 |
| Dos o más contactos alcanzables | +1 |
| Dos o más perfiles distintos | +1 |

**El cambio de fondo está en el primer renglón.** El score anterior ordenaba por
señal pública y después buscaba contactos. Éste hace lo contrario: una empresa sin
contacto alcanzable vale cero por perfecta que sea su señal, así que sólo entran
empresas donde ya sabemos a quién escribirle.

Efecto secundario que vale la pena notar: **la mayoría de estas 108 empresas no
estaban en el sourcing público**. Nexteer, Martinrea, Shape, Bosal, Condumex,
DEACERO y compañía cumplen el ICP y tienen contacto alcanzable, pero no salieron
de PROFEPA ni de los directorios de parques. El padrón público y Apollo se
complementan; ninguno de los dos basta solo.

## Las cuatro olas

| Ola | Contactos | Correos | Qué decide |
|---|---:|---:|---|
| **1** | 10 | 30 | Una sola persona por empresa, sólo mantenimiento, las de mejor score. Prueba que Gmail entrega y que las respuestas llegan al Control Room |
| **2** | 30 | 90 | Multi-contacto en las mejores cuentas. Mide qué variante responde |
| **3** | 60 | 180 | Cobertura amplia del segmento |
| **4** | 60 | 180 | Cola larga |

Entre olas, 48 horas de observación. Si la ola 1 no entrega, se para: eso es
infraestructura, no targeting.

## Reglas que el gate hace cumplir

- **Máximo 3 contactos por empresa**, contados en total y no por ola. Si se
  cuentan por ola, una cuenta buena acumula uno en cada una y terminan cinco
  personas de la misma planta recibiendo correo. Pasó al construir esta lista y
  lo atrapó la compuerta.
- **Separación de 48 horas** entre contactos de la misma empresa.
- Cada contacto trae su **variante de copy asignada por cargo**, nunca por empresa.
- Ningún contacto puede pertenecer a una empresa que no lo tenga en su inventario.
- Los ids de Apollo deben tener forma válida y ser únicos.
- Ninguna empresa del Anexo A, ni sus alias.

## Exclusiones, con marcador

**POSCO HOLDINGS** apareció en la búsqueda de compras y **no se contacta**. El
Anexo A nombra a POSCO MPPC; HOLDINGS es la matriz. Sin aclaración de ENNCO sobre
si la exclusión alcanza al grupo, se deja fuera. Es la misma duda que quedó
abierta con POSCO MVWPC en el sourcing del 26-ago y sigue sin resolverse.

## Lo que este artefacto NO garantiza

- **Los ids de Apollo se transcribieron a mano** desde los resultados de
  búsqueda. Al construir la lista encontré un contacto asignado a la empresa
  equivocada y dos ids inventados; los corregí y por eso existe el gate. Aun así,
  **antes de cargar conviene validar los ids contra Apollo**: el gate verifica
  forma y unicidad, no existencia.
- **Ningún correo está revelado.** La lista trae ids y cargos; los correos se
  revelan en la fase de verificación con su tope de créditos aprobado.
- **Ninguna cuenta tiene kWp verificado.** El tamaño sigue siendo un proxy.
- Las tasas de conversión que sustentan el plan son supuestos de industria. Las
  olas 1 y 2 existen para sustituirlos por datos propios.
