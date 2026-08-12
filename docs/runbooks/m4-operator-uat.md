# UAT de Operador ENNCO

## Estado

Checklist preparado. UAT humano no ejecutado porque no existe staging compartido ni operador designado.

## Escenarios obligatorios

| ID | Escenario | Resultado esperado |
|---|---|---|
| UAT-01 | Abrir Hoy | Ver resultados reales, salud y acciones sin mezclar simulacion |
| UAT-02 | Revisar respuesta humana | Enrollment detenido y clasificacion pendiente |
| UAT-03 | Marcar respuesta positiva | Lead CAPTURED, tarea y audit event |
| UAT-04 | Intentar contar lead incompleto | Gate rechaza la calificacion |
| UAT-05 | Calificar lead completo | Lead contractual con evidencia |
| UAT-06 | Registrar reunion no realizada | No cuenta como realizada |
| UAT-07 | Registrar reunion realizada | Hora, asistencia y notas persistidas |
| UAT-08 | Saltar etapa de pipeline | Gate rechaza el salto |
| UAT-09 | Completar tarea | Tarea cerrada y auditada |
| UAT-10 | Descargar CSV | Archivo privado, checksum y export run |
| UAT-11 | Simular rebote duro | Correo exacto suprimido y secuencia detenida |
| UAT-12 | Simular baja | Correo exacto suprimido y secuencia detenida |
| UAT-13 | Duplicar webhook | Cero mensajes, leads o tareas duplicados |
| UAT-14 | Caer la base | Portal muestra falla, nunca fixtures como live |
| UAT-15 | Revisar auditoria | No contiene cuerpo, asunto, correo ni notas |

## Evidencia por escenario

- Usuario y rol.
- Timestamp.
- Correlation ID.
- Registros antes y despues.
- Captura de pantalla.
- Resultado esperado y observado.
- PASS, EXTEND o KILL.
- Defecto vinculado si falla.

## Cierre

M4 global requiere 15 de 15 escenarios, cero P0 o P1 abiertos y firma del operador ENNCO. La ejecucion local automatizada no sustituye este UAT.
