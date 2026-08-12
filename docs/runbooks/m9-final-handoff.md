# Runbook M9 de entrega final

## Objetivo

Transferir un paquete verificable a ENNCO sin perder trazabilidad, acceso, datos o capacidad de recuperacion.

## Precondiciones

- M0 y M2 a M8 live en PASS.
- Cero P0/P1.
- Manifest y commit congelados.
- Source control bajo propiedad ENNCO.
- Inventario de proveedores aprobado.
- Operador y suplente designados.
- Ventana de UAT y capacitacion acordada.

Si falta una precondicion, registrar `EXTEND`. No completar el checklist de memoria.

## Procedimiento

1. Verificar el commit y ejecutar el pipeline completo.
2. Generar archivo fuente, SBOM, exports y manifest.
3. Comparar SHA256 contra el manifest.
4. Exportar datos live por organizacion.
5. Reimportar en destino aislado y conciliar conteos e invariantes.
6. Restaurar base y Storage en destino separado.
7. Probar login, MFA, roles, RLS, portal, reply sync, kill switch y alertas.
8. Recertificar cada acceso del inventario.
9. Ejecutar UAT con el operador ENNCO.
10. Ejecutar capacitacion con operador y suplente.
11. Recorrer incident response, recovery y first send HOLD.
12. Registrar cada check con evidence class live y SHA256.
13. Sellar el paquete como `READY_FOR_ACCEPTANCE`.
14. El admin ENNCO revisa y emite aprobacion exacta.
15. Registrar aceptacion final append-only.

## Verificacion

- El paquete aceptado conserva el manifest original.
- Existe una sola aceptacion por paquete.
- El actor es `ennco_admin` y pertenece a la misma organizacion.
- No hay secreto ni PII en audit logs o paquete publico.
- Los exports reimportados conservan conteos y relaciones.
- El restore live cumple el RPO y RTO declarados.
- Las credenciales Teckel quedan en el nivel de soporte aceptado o se revocan.

## Rechazo y rollback

Un rechazo no borra el paquete. Se registra la causa, se corrige en una nueva version y se repiten los gates afectados. Si falla restore, RLS, export, MFA o propiedad, detener entrega y marcar `KILL` o `EXTEND` según impacto.
