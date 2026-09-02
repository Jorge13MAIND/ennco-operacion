# M42. Capa de inteligencia: prioridad ICP, lectura sugerida y brief

Fecha del control local: 2 de septiembre de 2026.

Estado global: `EXTEND`.
Estado del control local: `EVIDENCE_READY`.
Efectos externos: **ninguno**. Esta capa no envía, no clasifica y no inscribe.

## Decisión vigente

Traduce tres patrones del motor Atlas al stack de ENNCO, sin portar código: los
stacks no son compatibles (Atlas corre agentes LLM sobre Claude CLI en Docker;
ENNCO es Next.js sobre Vercel y Supabase).

| Patrón Atlas | Aquí | Diferencia deliberada |
|---|---|---|
| Agente 05 · ICP scoring | Cola de prioridad ICP | Determinista, no LLM: el contrato define lead por cláusula y una cifra que cambia entre corridas no se defiende ante el cliente |
| Agente 03 · Reply classifier | Lectura sugerida | **Propone, nunca clasifica.** Atlas escribe la categoría; aquí la decisión sigue siendo de una persona |
| Agentes 11 y 12 · Morning brief y EOD | Brief de operación | Una sola función con dos momentos, ordenada por consecuencia en vez de por tabla |

La razón de que todo sea determinista no es ideológica: sin proveedor LLM no
hay costo por cuenta ni por respuesta, las 1,831 empresas se puntúan completas,
la bandeja no espera a una API, y cada regla se prueba con pruebas unitarias.

## La invariante que no se negocia

`provider_events.reply_classification` sigue siendo la única verdad y sólo la
mueve `review_reply_and_route` con un humano detrás. M042 escribe en una tabla
aparte de propuestas y no concede permiso para tocar esa columna.

El motivo es el radio de daño: marcar `POSITIVE` crea un lead, asigna una tarea
con vencimiento a las 18:00 y abre un caso SLA P1; si ese caso vence, congela
todo el outbound. Una decisión irreversible con esa consecuencia no se
automatiza.

Lo que sí resuelve la capa es el defecto de interfaz documentado como hueco en
el handover del 1-sep: el select de clasificar viene con "Positiva"
preseleccionada. Con la sugerencia y su evidencia al lado, el operador llega a
la decisión leyendo en vez de adivinando.

## Rúbrica ICP `icp-v1-2026-09-02`

El estado es **compuerta, no factor**: fuera de los cuatro estados de la
cláusula 01 la cuenta devuelve 0 y banda `FUERA_DE_CONTRATO`, en vez de un
número que invite a contactarla.

| Factor | Máximo | De dónde sale |
|---|---:|---|
| Tamaño (proxy de >100 kWp) | 30 | Banda de personal ocupado de DENUE. No existe padrón público de grandes consumidores de CFE |
| Certificado PROFEPA-PNAA | 25 | Evidencia de origen (`source_evidence`). Señal más fuerte del sourcing |
| Giro intensivo en energía | 25 | SCIAN 322, 325, 326, 327, 331, 336. Manufactura general suma 12 |
| Parque industrial | 10 | Campo del padrón |
| Ciudad del corredor | 10 | León-Querétaro efectivamente trabajado |

Bandas: A ≥75, B 55-74, C 35-54, D <35.

Traduce a 100 puntos el esquema /7 del sourcing del 26-ago (PROFEPA +4, SCIAN
intensivo +2, parque +1), conservando a PROFEPA como señal dominante.

**Sin evidencia nunca se pinta verde.** Una señal que no se pudo leer suma cero
y queda anotada en `missing_signals`, jamás se asume.

**Jalisco y Michoacán** se puntúan y se marcan `contract_only_state`: el
contrato los incluye y el módulo de investigación todavía no, con 176 filas de
PROFEPA descargadas sin usar. El hueco queda visible en la pantalla en vez de
desaparecer en silencio.

## Clasificador `clasificador-v1-2026-09-02`

Nueve intents del response playbook v1, con precedencia explícita:

1. `UNSUBSCRIBE` gana sobre todo, incluso sobre señales positivas en el mismo
   correo. Es obligación LFPDPPP, no cortesía.
2. `REFERRAL`, `COMMERCIAL_COMMITMENT`, `POSITIVE` marcan trato humano.
3. Objeciones y aplazamientos quedan neutrales.
4. Un rechazo explícito cancela una lectura positiva.
5. Las respuestas automáticas se detectan y no marcan trato humano, para que no
   disparen SLA.

Cada sugerencia guarda las frases exactas que la dispararon: es la evidencia que
el operador lee antes de decidir. Bajo 0.5 de confianza la interfaz pide lectura
completa.

## Contrato de base

`202609020042_inteligencia.sql` agrega dos tablas con RLS forzado y cuatro RPC:

- `account_icp_scores` — única por (organización, cuenta, rúbrica), idempotente.
- `reply_classification_suggestions` — única por (organización, evento, versión).
- `upsert_account_icp_scores` y `upsert_reply_suggestions` exigen rol operador y
  descartan filas de otro tenant, cuentas borradas y respuestas ya clasificadas.
- `read_icp_priority_queue` marca cuentas suprimidas (Anexo A incluido) e
  inscritas, para que una cuenta bloqueada nunca encabece la cola en silencio.
- `read_reply_suggestions` sólo devuelve propuestas de respuestas que siguen en
  `UNREVIEWED`.

Sin llave foránea compuesta contra `accounts`: esa tabla no expone índice único
sobre `(organization_id, id)`, así que el aislamiento por tenant se hace en el
join del RPC, donde sí es verificable.

## Evidencia local

```bash
npx vitest run src/lib/inteligencia/
npm run typecheck
npm run lint
npm run build
```

Al congelar: 33 pruebas nuevas en verde, typecheck, lint y build de producción
limpios. Suite completa 428 de 429; la única roja es `governance.test`,
pre-existente y ajena a M042 (el RTM canónico referencia rutas absolutas de la
máquina de Jorge y sólo valida ahí).

## Estado real

- Cuentas puntuadas: **0**, porque no hay empresas cargadas todavía.
- Sugerencias generadas: **0**, porque no hay respuestas.
- Ambas pantallas funcionan con datos sintéticos marcados para capacitación.

Un PASS local demuestra la lógica y sus negativos. No demuestra resultado
comercial: eso llega cuando entren las 1,831 empresas y la primera respuesta.
