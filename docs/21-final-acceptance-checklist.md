# Checklist de aceptacion final

Este checklist es un contrato de evidencia, no un acta firmada.

## Identidad del paquete

- Commit fuente de 40 caracteres.
- Manifest SHA256.
- Lista de artefactos con SHA256.
- Evidence class `live`.
- Version de migraciones y rollback.
- Fecha de corte en `America/Mexico_City`.

## Gates obligatorios

- [ ] M0 sin bloqueos P0.
- [ ] M2 a M8 con gates live en PASS.
- [ ] Propiedad del repositorio confirmada por ENNCO.
- [ ] Accesos de produccion transferidos y recertificados.
- [ ] Proveedores, costos, region, DPA y retencion aceptados.
- [ ] Segunda restauracion live aprobada.
- [ ] Auditoria de seguridad live aprobada.
- [ ] Export y reimport live conciliados.
- [ ] UAT realizado por operador ENNCO.
- [ ] Capacitacion realizada con operador y suplente.
- [ ] Runbooks recorridos.
- [ ] Cero P0/P1.
- [ ] Manuales y evidencia accesibles para ENNCO.
- [ ] Rechazos y pendientes registrados.

## Aceptacion

La aceptacion final solo puede registrarse por un usuario autenticado con rol `ennco_admin`. Debe referir el ID del paquete y su manifest SHA256. La aprobacion y el registro final son append-only.

Si un criterio es `UNKNOWN`, `EXTEND` o `KILL`, el paquete no queda aceptado. Si el cliente rechaza el paquete, se conserva la evidencia, se documenta la causa y se emite una nueva version después de corregir.
