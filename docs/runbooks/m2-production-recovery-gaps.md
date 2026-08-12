# Runbook M2: gaps para recuperación de producción

## Veredicto actual

El PASS del drill local prueba portabilidad lógica y consistencia de objetos sintéticos. No prueba recuperación de producción.

En particular, no demuestra:

- PITR de Supabase.
- RPO de 15 minutos.
- RTO de cuatro horas.
- Recuperación de Supabase Storage.
- Restauración de secretos, KMS, OAuth, DNS o proveedores.
- Capacidad de reconstruir producción bajo una cuenta controlada por ENNCO.
- Respuesta humana dentro del tiempo objetivo.

Por lo tanto, esos objetivos permanecen `UNKNOWN` y no deben reportarse como cumplidos.

## Gate para probar PITR y RPO

Este gate sólo puede ejecutarse después de aprobar y crear staging administrado bajo ENNCO.

1. Confirmar plan de Supabase con PITR habilitado y documentar su granularidad real.
2. Crear datos y objetos sintéticos versionados en staging.
3. Registrar timestamp de la última transacción protegida.
4. Provocar una pérdida controlada únicamente en staging.
5. Restaurar la base a un proyecto o destino separado.
6. Restaurar Storage mediante el backup independiente, porque el backup de Postgres no contiene los objetos.
7. Reconciliar filas, hashes, relaciones, RLS, Auth y URLs de objetos.
8. Medir pérdida máxima observada para RPO.
9. Medir desde declaración de incidente hasta servicio validado para RTO.
10. Adjuntar evidencia del proveedor y revisión humana.

## Criterios de producción

El objetivo RPO 15 minutos sólo puede pasar si la pérdida máxima medida es menor o igual a 15 minutos en un ejercicio representativo. El objetivo RTO cuatro horas sólo pasa si aplicación, base, objetos, autenticación y operación quedan restaurados y validados dentro de cuatro horas.

Una restauración parcial de Postgres no cuenta como recuperación del sistema.

## Bloqueos actuales

- Aprobación y compra de infraestructura administrada.
- Proyecto Supabase dedicado de staging.
- Política y almacenamiento independiente de backups de objetos.
- Acceso ENNCO con MFA.
- Inventario de secretos y procedimiento de recuperación.
- Ventana autorizada para simulacro destructivo en staging.

Hasta cerrar esos bloqueos, el estado correcto es:

- Backup lógico local: `VERIFIED`.
- Restore local separado: `VERIFIED`.
- Restore de objetos sintéticos: `VERIFIED`.
- PITR de producción: `UNKNOWN`.
- RPO 15 minutos: `UNKNOWN`.
- RTO cuatro horas: `UNKNOWN`.
