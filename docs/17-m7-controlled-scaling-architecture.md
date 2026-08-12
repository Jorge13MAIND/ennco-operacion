# M7 Controlled Scaling Architecture

## Veredicto

- Implementacion local M7: `PASS`.
- Gate global M7: `EXTEND`.
- Estado de M6: `EXTEND`.
- Olas reales liberadas: `0`.
- Primeras entregas validas: `0 de 100`.
- T0 comercial: `NOT_AVAILABLE`.
- Efectos externos: `0`.

M7 queda construido y comprobado para operar cuando M6 pase. Esto no declara que exista una campaña, una entrega, una respuesta, un lead o un baseline real.

## Contrato de escalamiento

Cada ola exige, en este orden:

1. Fuente previa liberada y observacion live de al menos 24 horas.
2. Salud `PASS`, sin P0, P1, rebote duro, baja, queja, duplicado, violacion de supresion o señal desconocida.
3. Los 30 gates de campaña vigentes.
4. Manifiesto, secuencia, buzón, cuenta, contacto y hashes sin deriva.
5. Supresion actual dentro de la transaccion.
6. Aprobacion append-only de la ola exacta.
7. Ventana operativa y runtime abiertos.

Una queja, doble entrega, violacion de supresion o P0 produce `KILL`. Una señal incompleta o degradada produce `EXTEND`. Solamente evidencia live completa produce `PASS`.

## Limite de volumen

El siguiente lote no puede superar:

`min(25, max(5, entregas_validas_previas * 2))`

El sistema nunca incrementa volumen por falta de conversión. El volumen maximo de una ola es 25. Cada cuenta, contacto e inscripción puede pertenecer a una sola fuente de primer contacto.

## Seguimientos

Los contactos 2 a 8 requieren:

- Fuente inicial liberada.
- Ultima observacion live en `PASS` o ola previa en `PASSED`.
- Gates actuales.
- Supresion actual.
- Mailbox saludable.
- Secuencia vigente.
- Fecha de contacto alcanzada.
- Ventana martes a jueves, 09:30 a 11:30, `America/Mexico_City`.

Una respuesta, rebote, baja o pausa de enrollment conserva las stop rules existentes.

## Baseline T0

T0 se congela una sola vez por campaña y usa exactamente las primeras 100 entregas validas del primer contacto, ordenadas por `sent_at` e ID. Exige provider message ID y funnel consistente:

`entregas >= respuestas >= respuestas positivas >= leads estrictos >= reuniones realizadas >= oportunidades calificadas`

Una oportunidad cuenta solamente en `QUALIFIED` o una etapa posterior, con comprador, dolor, impacto, plazo menor a 90 dias, valor y siguiente accion fechada. Si la tasa de lead estricto es cero, el sistema devuelve forecast `null` en vez de inventar el inventario requerido.

## Persistencia y seguridad

La migracion `202608110009_controlled_scaling.sql` agrega:

- `rollout_health_observations`.
- `rollout_waves`.
- `rollout_wave_enrollments`.
- `commercial_baselines`.
- Evaluacion y finalizacion service-only.
- Release source unico por enrollment.
- Audit allowlist sin correo ni cuerpo de mensaje.
- RLS read only para miembros.
- Rollback y reaplicacion probados.

El portal muestra salud, ola y T0 sin sustituir una falla live con fixtures.

## Lo que sigue bloqueado

- M6 completo y cinco primeros envios reales.
- Inventario elegible y conciliado.
- 24 horas reales por observacion.
- Primeras 100 entregas validas.
- Provider reconciliation en Supabase y Gmail autorizados.
- Aprobacion exacta de cada ola.

Hasta resolverlo, el Control Room muestra M7 `BLOCKED`, gate `EXTEND` y T0 inexistente.
