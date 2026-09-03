# Paquete de ejecución: los primeros 500 correos

**Para:** Grant · **De:** Teckel · **3-sep-2026**

Todo lo que hace falta para disparar los primeros 500 correos, cuando la
infraestructura esté lista. **Nada aquí dispara nada**: los tres artefactos nacen
en `RESEARCH_ONLY_HOLD` y el primer envío externo sigue necesitando el go
explícito de Jorge (cláusula 07 del contrato).

## Los tres archivos

| Qué | Dónde | Compuerta |
|---|---|---|
| **El copy aprobado** | `docs/external/secuencia-ennco-copy.md` (lectura) · `data/campaigns/direct-lane-sequence-v1.json` (lo que carga el motor) | `npm run verify:copy` · `npm run verify:direct-lane-sequence` |
| **A quién** | `data/imports/research/target-list-2026-09-03/target-list-v1.json` | `npm run verify:target-list` |
| **En qué orden** | `data/campaigns/waves-2026-09-03.json` | `npm run verify:waves` |

Los cuatro gates en verde antes de tocar nada:

```bash
npm run verify:copy && npm run verify:direct-lane-sequence && npm run verify:target-list && npm run verify:waves
```

## El copy: qué es y qué NO se toca

**La voz es del cliente.** Francisco Cuellar escribió y aprobó el toque 1 de
dirección general, y los toques 2 al 5 también son suyos. El resto se derivó de
ese registro y Jorge lo aprobó el 3-sep.

Así abre, y es su texto palabra por palabra:

> Hola {{first_name}},
>
> Soy Francisco Cuellar, Director General de ENNCO.
>
> Te escribo porque tenemos clientes muy similares a ustedes que han obtenido
> increíbles resultados en la reducción de costos y en servicios eléctricos.
>
> Ya va a terminar el año y sé que probablemente quieran lograr sus resultados
> financieros. Nuestros proyectos aportan resultados visibles desde el momento de
> la entrega.
>
> ¿Cuándo podrías recibirme en tus oficinas para darte un análisis real de esto y
> mostrarte una estrategia de primer nivel para lograr esto?
>
> Si tú no te encargas de llevar esto, ¿podrías dirigirme con la persona
> encargada por favor?
>
> Saludos y espero saber de ti pronto.

**`verify:copy` verifica que ese texto siga intacto**, comparándolo contra sus
frases ancla. Si alguien lo edita, el gate falla. Es a propósito.

Las otras tres variantes (mantenimiento, seguridad e higiene, compras) derivan de
ahí: mismo registro corto y humilde, mismo CTA de cita presencial con rescate de
referido. Del toque 2 en adelante ninguno pasa de 87 palabras.

**Si el gate te estorba porque marca algo que Francisco sí escribiría, el que
está mal es el gate**: ajústalo y deja el porqué en el comentario. Me pasó a mí.

**Se usan los primeros 3 toques** (días 0, 3 y 7) de los 8 escritos. Con
presupuesto de 500 correos, tres toques a 160 contactos rinde mucho más que ocho
toques a 62, y es donde llega la mayor parte de la respuesta. Del 4 al 8 quedan
listos para cuando suba el volumen mensual.

## A quién: 108 empresas, 160 contactos

Medido contra Apollo el 3-sep con cero créditos. El criterio que manda es que
**haya contacto decisor con correo verificado**: una empresa sin contacto
alcanzable no entra, por buena que sea su señal pública.

Detalle y razonamiento: `docs/external/lista-objetivo-500.md`.

Reglas que el gate hace cumplir: máximo 3 contactos por empresa **en todo el
programa**, separados 48 horas; variante de copy asignada por cargo, nunca por
empresa; ninguna empresa del Anexo A.

## Las cuatro olas

| Ola | Contactos | Empresas | Correos | Qué decide |
|---|---:|---:|---:|---|
| **1 · Sonda de entrega** | 10 | 10 | 30 | ¿Gmail entrega? ¿Las respuestas llegan al Control Room? |
| **2 · Prueba de variante** | 30 | 14 | 90 | ¿Qué ángulo del copy responde mejor? |
| **3 · Cobertura** | 60 | 35 | 180 | ¿Aguanta la tasa al salir de las mejores cuentas? |
| **4 · Cola larga** | 60 | 60 | 180 | Agotar el presupuesto |
| | **160** | | **480** | de 500 |

**48 horas de observación entre olas.** Cada ola trae en el JSON su
`avanza_si` y su `para_si` explícitos.

La ola 1 no mide conversión y no hay que pedirle que la mida: con 10 contactos no
hay señal comercial. Mide que la tubería funciona. Si una respuesta no aparece en
el Control Room en 30 minutos, se para ahí.

## Lo que falta antes de disparar, y no es mío

1. **Infraestructura del carril directo** lista y verificada (tu runbook `m41`).
2. **Calentamiento** de los buzones resuelto.
3. **Go explícito de Jorge** para el primer envío externo.
4. **Validar los ids de Apollo** contra la plataforma. El gate verifica forma y
   unicidad, **no existencia**: los transcribí a mano desde los resultados de
   búsqueda y ahí ya encontré y corregí dos inventados. Un id falso no falla
   ruidosamente, falla el día del envío contra una persona que no existe.
5. **Revelar los correos** en la fase de verificación, con su tope de créditos.
   La lista trae ids y cargos, no direcciones.

## Dos cosas que te van a morder si no las sabes

**El tope de palabras subió a 120** (migración M042). El correo que Francisco
aprobó tiene 104 y los dos triggers vivos lo rechazaban en 100, así que el motor
no podía enviar el copy del cliente. Está alineado en la base y en TypeScript.

**Una respuesta positiva vencida congela todo el outbound.** Abre un incidente P1
y el release exige `open_p1 = 0`. Por eso el SLA de respuesta importa tanto como
el envío: `docs/external/sla-de-respuesta.md`.

## Cómo se reconstruye

Los tres artefactos son deterministas y se regeneran desde su fuente:

```bash
npm run build:direct-lane-sequence          # copy markdown -> JSON del motor
python3 scripts/build-target-list-2026-09-03.py
python3 scripts/build-waves-2026-09-03.py
```
