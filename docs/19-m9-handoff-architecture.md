# M9 Hardening and Handoff Architecture

Fecha de corte: 2026-08-12 `America/Mexico_City`.

## Veredicto objetivo

- Construccion local M9: puede alcanzar `EVIDENCE_READY`.
- Gate global M9: permanece `EXTEND` hasta evidencia live y aceptacion ENNCO.
- Entrega enterprise de doce semanas: no se declara terminada.
- Contacto, compras, DNS, credenciales, produccion y staging compartido: fuera de esta ejecucion.

## Separacion de estados

`EVIDENCE_READY` prueba que el paquete local, las exportaciones sinteticas, la segunda restauracion local, los runbooks y el contrato de aceptacion son reproducibles.

`READY_FOR_ACCEPTANCE` exige evidencia live de propiedad del repositorio, transferencia de accesos, inventario de proveedores, segunda restauracion administrada, auditoria de seguridad, UAT ENNCO, capacitacion, reimportacion de exports, walkthrough de runbooks y cero P0/P1.

`ACCEPTED` exige adicionalmente una aprobacion append-only ligada al manifest y emitida por un `ennco_admin` autenticado. Ningun usuario Teckel, service role, fixture sintetico o documento local puede producir ese estado.

## Contrato de base

La migracion `202608120011_handoff_acceptance.sql` agrega:

- `handoff_packages`.
- `handoff_artifacts`.
- `handoff_readiness_checks`.
- `handoff_training_records`.
- `final_acceptances`.

Los artefactos, checks, capacitaciones y aceptaciones son append-only. El paquete se sella mediante funcion service-only. La aceptacion final requiere identidad `ennco_admin`, paquete live, diez criterios live en PASS, capacitacion realizada, cero P0/P1 y aprobacion exacta por ID y hash.

## Criterios locales

1. Paquete fuente local reproducible desde un commit exacto.
2. Export y reimport local con datos sinteticos.
3. Segunda restauracion local independiente.
4. Regresion de seguridad local.
5. Indice de runbooks completo.
6. Guion de capacitacion listo.

Estos seis criterios no sustituyen ningun criterio live.

## Criterios live

1. Propiedad del source control confirmada por ENNCO.
2. Accesos de produccion transferidos y recertificados.
3. Inventario y condiciones de proveedores aceptados.
4. Segunda restauracion en infraestructura administrada.
5. Auditoria de seguridad live.
6. UAT del cliente.
7. Capacitacion real de operador y suplente.
8. Export y reimport live.
9. Walkthrough de incidentes y operacion.
10. Cero P0/P1.

## Paquete reproducible

`scripts/m9-handoff-readiness.mts` genera y verifica:

- Archivo tar de un commit exacto.
- CSV sintetico de empresas y contactos.
- CSV sintetico de pipeline y atribucion.
- Manifest con SHA256.
- Evaluacion local y global separadas.

El archivo no contiene `node_modules`, secretos ni datos reales de ENNCO. El gate de secretos y la inspeccion del manifest siguen siendo obligatorios antes de cualquier entrega real.

## Limitaciones abiertas

- La restauracion local usa PostgreSQL 16 desechable y objetos sinteticos.
- Supabase, Auth, Storage, PITR, Gmail y proveedores reales no se probaron.
- No existe UAT ni capacitacion ENNCO realizada.
- No existe transferencia de accesos.
- No existe aceptacion final.
- M0 y M2 a M8 conservan bloqueos live.

Por estas razones M9 global no puede ser `PASS` durante esta ejecucion.
