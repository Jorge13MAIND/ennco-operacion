# Definition of Enterprise Ready

Un componente sólo está listo cuando tiene:

- Requisito trazado.
- Owner.
- Código revisado.
- Unitarias.
- Integración.
- E2E relevante.
- Escenarios de fallo.
- Seguridad.
- Observabilidad.
- Runbook.
- Evidencia.
- Rollback.
- UAT cuando corresponda.

Producción requiere además:

- SAST, DAST, secret y dependency scan.
- SBOM.
- Backup y restore.
- SLO instrumentado.
- Canary PASS.
- Cero P0/P1.
- Autorización explícita.

Toda evidencia de release debe registrar commit, tree y checksum. La captura aborta si el árbol no estaba limpio antes de generar artefactos. Un gate `PASS_LOCAL`, una fixture `synthetic_demo` o una configuración CI válida mantienen el requisito operativo en `EXTEND` hasta existir la ejecución remota, staging o revisión humana que corresponda.

Un build exitoso o un documento creado es setup, no resultado comercial.
