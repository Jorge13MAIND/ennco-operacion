# Plantilla contractual y documentos de Proyectos ENNCO

Versión: `ENNCO-CONTRACT-DRAFT-1`. Fecha de investigación: 10 de septiembre de 2026.

La plantilla se creó a partir del proceso administrativo de ENNCO y de la autorización para proponer un contrato nuevo. Es un **borrador para revisión de Administración y asesoría legal de ENNCO**. No se ha acreditado dictamen, registro PROFECO, razón social, poderes, RFC, plazos de garantía ni jurisdicción del prestador. El generador no afirma que la plantilla esté lista para firma.

La nueva plantilla y todos los documentos se generan con `src/lib/projects/documents.ts` mediante:

```ts
buildProjectDocumentLines(bundle, kind, revisionId?) // lista explícita de contenido
await generateProjectPdf(bundle, kind, revisionId?) // Uint8Array de PDF
// kind: 'proposal' | 'technical' | 'financial' | 'contract'
```

`revisionId` identifica un registro del expediente. Un identificador inexistente o de otro tipo se rechaza; no se sustituye silenciosamente por la revisión más reciente. Para contrato puede referirse a un contrato o a la propuesta que se quiere contratar. El corte financiero admite cualquier registro y excluye revisiones posteriores.

## Contenido y decisiones contractuales

El PDF contractual contiene diez apartados y espacios de firma:

| Apartado | Contenido preparado | Información pendiente |
|---|---|---|
| Partes | Identificación y representación del prestador y del cliente | Razón social exacta, RFC, domicilios, representantes y evidencia de facultades; no se infieren a partir del nombre comercial. |
| Objeto | Suministro/instalación solar o eléctrica de la propuesta aceptada; identificación de revisión y anexos | Alcance detallado, exclusiones, lista de equipos/modelos y anexos aceptados. |
| Precio | Subtotal, IVA y total en MXN; anticipo como importe/porcentaje del total; parcialidades por fecha/condición | Datos de pago verificados y términos de crédito si existieran. No presume que factura equivale a cobro. |
| Inicio/compras | Inicio y duración pactados; liberación con anticipo confirmado y excepciones internas documentadas | Si la duración usa días hábiles/naturales, hitos de entrega y tratamiento acordado de incidencias. |
| Responsabilidades | Acceso autorizado, coordinación de trabajos, información del sitio, medidas de seguridad y comunicación de hallazgos | Coordinadores, accesos, horarios, permisos de trabajo, cortes y apoyos concretos del cliente. |
| Cambios | Autorización documentada con alcance, importe/impuestos, calendario y entregables | Representantes y medio válido para autorizar adicionales. No se usa una nota de obra como aceptación comercial automática. |
| Entrega | Pruebas, fichas, manuales, garantías y pendientes; entrega técnica separada de conciliación financiera | Criterios de aceptación, trámites incluidos, responsable y tratamiento de tiempos de CFE/terceros. |
| Garantías | Diferencia equipos/fabricación e instalación/mano de obra; procedimiento de reclamación | Duración, inicio, alcance, responsable, contacto y condiciones de cada garantía. No inserta años o meses históricos como compromiso actual. |
| Suspensión/cancelación | Documentación de avances, suministros, compromisos, pagos y saldos; conservación de obligaciones aplicables | Causas, avisos, plazos, conciliación y efectos específicos. Sin pérdida automática de anticipo ni penalizaciones predeterminadas. |
| Controversias/firma | Notificaciones, revisión de normativa aplicable, identificación de anexos y copia para ambas partes | Legislación, competencia, mecanismos de solución, lugar/fecha y firmas. |

El objetivo de compras principales de **cinco días hábiles** es una regla interna de operación ENNCO. La plantilla lo distingue de la fecha de entrega al cliente. El calendario base empresarial puede excluir sábados, domingos y los descansos nacionales del artículo 74, además de los cierres empresariales/electorales aplicables. Para un anticipo confirmado el 11 de septiembre de 2026, los cinco días son 14, 15, 17, 18 y 21 de septiembre; el 16 no se cuenta. La fuente oficial enumera también descansos móviles; no corresponde tratar todos como fechas fijas ni usar calendarios especiales de dependencias públicas para ENNCO. [PROFEDET, calendario 2026](https://www.gob.mx/profedet/articulos/sabes-cuales-son-los-dias-de-descanso-obligatorio-para-este-2026).

## Campos de integración

La identidad comercial se congela en `proposal.data.customerSnapshot`: `customerName`, `contactName`, `location`, `scope`. Una propuesta sin snapshot usa la captura actual claramente indicada y permanece borrador. Una modificación del proyecto no cambia el cliente ni alcance de una propuesta congelada.

El contrato toma precio de su registro cuando existe, o de una propuesta aceptada cuando se prepara antes de registrar el contrato. Toma `scope`, `advanceAmountMxn`, `schedule`, `startDate`, `durationDays`, `terms` y `warranties` del contrato. La fecha o evidencia de aceptación no se utiliza como firma del nuevo contrato.

Los campos principales de `contract.data.legalDetails` se alinean con el formulario/esquema del módulo:

- `legalNameEnnco`, `enncoRfc`, `enncoAddress`, `enncoRepresentative`.
- `customerLegalName`, `customerRfc`, `customerAddress`, `customerRepresentative`.
- `jurisdiction`, `workmanshipWarranty`, `equipmentWarranty`, `scopeExclusions`.

La plantilla tiene espacios adicionales para facultades, anexos, instrucciones de pago, naturaleza de días, hitos, coordinadores, seguridad, autorización de cambios, pruebas de aceptación, interconexión, procedimiento de garantías, cancelación y notificaciones. Si el expediente no los contiene, aparecen como `[POR COMPLETAR]`. Antes de activar una plantilla para firma, ENNCO debe aprobar esos términos e incorporarlos a su registro/formulario contractual o a anexos identificados; el PDF no los rellena automáticamente con datos inferidos.

La plantilla permanece **BORRADOR** incluso si ya hay un contrato firmado cargado: es una regeneración del modelo de trabajo, no una copia del instrumento firmado. El documento firmado original debe conservarse y consultarse en su archivo oficial de Drive. La futura aprobación de la plantilla necesita versión y responsable autorizados, y no debe inferirse de un booleano recibido del navegador.

## Fuentes jurídicas consultadas

Se verificaron fuentes primarias oficiales, distinguiendo el texto normativo de propuestas legislativas. La determinación del régimen concreto debe revisarse por ENNCO según partes, ubicación y naturaleza de cada operación.

- **Código Civil Federal, artículos 1794–1803:** referencia sobre objeto, consentimiento, capacidad y representación. Su consulta no determina que el contrato particular se rija íntegramente por el ámbito federal; pueden corresponder disposiciones mercantiles o civiles locales. [Texto de la Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/CCF.pdf).
- **Ley Federal de Protección al Consumidor, artículos 7 y 7 Bis, 77–78 y 85–86 Bis:** cuando aplique, revisar información de precio total, garantías claras, condiciones contractuales y autorización de adicionales. La revisión evita introducir renuncias generales o cambios unilaterales; no presupone que cada cliente industrial sea consumidor ni que esta actividad tenga determinado registro obligatorio sin verificarlo. [Texto de la Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf).
- **Registro de contratos de adhesión:** PROFECO ofrece consulta por proveedor y registro. No se consultó ni acreditó un registro a nombre de ENNCO y no se incorporó un número inventado. [RCAL de PROFECO](https://rcal.profeco.gob.mx/).

Esta sección es una guía de revisión de la plantilla, no una conclusión sobre validez, competencia, impuestos aplicables o suficiencia de garantías del proyecto.

## Documentos, confidencialidad y reproducción

| Documento | Contenido | Condición |
|---|---|---|
| Propuesta | Cliente/alcance congelados, nombre, potencia, subtotal/IVA/total, vigencia, condiciones y referencia técnica resumida | Se marca borrador salvo aceptación activa, snapshot comercial suficiente y revisión técnica aprobada cuando existe cálculo asociado. |
| Técnico | Entradas y resultados del cálculo guardado, hash, versión, fuentes, sistemas/inversores, circuitos, medidas, cantidades y faltantes | No incorpora costos ni márgenes. La revisión humana se comprueba contra el cálculo exacto, sin aprobarlo por su estado automático. |
| Financiero | Contratado, facturado, cobrado, saldo, anticipo, avance, presupuesto, costos, compromisos, pagos y movimientos del corte | Exige `canReadCosts` y `costScope === 'ALL'`. Las utilidades sólo se incluyen con `canReadMargins`. Usa el motor financiero compartido; no suma factura y pago como dos costos. |
| Contrato | Plantilla y datos explícitos del contrato/propuesta | Siempre borrador de la nueva plantilla hasta su validación; no representa firma ni registro jurídico. |

El código aplica una lista de campos permitidos por documento. **Nunca serializa el bundle, `data` completo ni JSON arbitrario**, ni inserta costos como datos ocultos, archivos adjuntos o tokens en un enlace. Las notas internas, proveedores, costos de compra y márgenes se excluyen de propuesta/contrato/técnico. Los importes históricos del recibo o del escenario de energía pueden figurar en la memoria técnica porque son datos del consumo del cliente, no costos de compra ENNCO.

Los textos comerciales expresamente escritos en alcance/condiciones o términos siguen siendo responsabilidad del autor de esa revisión: no debe colocar información interna en campos destinados al cliente. El sistema protege los campos internos separados; no intenta adivinar o censurar lo que el usuario escribe en una condición comercial.

Los PDF usan páginas carta, encabezado ENNCO, número de página y marca de borrador o uso interno. El texto se ajusta a ancho real de fuente y divide cadenas largas. Las tildes, ñ, unidades latinas y grados se conservan; símbolos fuera de WinAnsi se transliteran o sustituyen para evitar que un emoji o un carácter no soportado impida exportar. Los adjuntos/fotos siguen en el expediente y no se incrustan automáticamente sin recuperar su archivo autorizado.

## Verificación ejecutada

Las pruebas cubren las cuatro clases de documento y extraen texto de los streams reales del PDF generado, además de verificar el contenido previo a serialización. Demuestran ausencia de marcadores de costos privados en documentos no financieros, permisos de costos/utilidades, exactitud del corte, reutilización del motor de costos sin duplicar pagos, selección de revisión, reversión de aceptación, falta de snapshot, contrato incompleto, paginación y caracteres no soportados.

La validación de la plantilla con Administración/asesoría legal y su ejecución contra expedientes reales permanece pendiente. Esa validación es distinta de las pruebas automáticas de generación y confidencialidad.
