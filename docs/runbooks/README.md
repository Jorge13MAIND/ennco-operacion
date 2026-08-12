# Indice de runbooks ENNCO

## Operacion diaria

- `gmail-reply-sync.md`: ingesta, replay, cuarentena y recuperacion de respuestas.
- `m4-operator-uat.md`: recorrido del operador sobre bandeja, leads, pipeline y exports.
- `m7-controlled-scaling.md`: olas, salud, observacion y kill switch.
- `m8-contractual-reporting.md`: mes completo, reporte y recuperacion comercial.

## Captacion y release

- `prequote-release.md`: gate del modelo, PDF, privacidad y archivo.
- `m5-shadow-canary.md`: canary de catorce dias y fallas inyectadas.
- `m6-first-send-release.md`: primer lote, treinta gates y monitoreo.

## Seguridad y continuidad

- `incident-response.md`: severidades, escalamiento y playbooks.
- `m2-local-backup-restore.md`: drill local de base y objetos.
- `m2-production-recovery-gaps.md`: diferencias que impiden declarar RPO/RTO live.

## Entrega

- `m9-final-handoff.md`: sellado, transferencia, UAT y aceptacion.
- `m9-operator-training.md`: agenda, ejercicios y evidencia de capacitacion.

Cada runbook debe conservar owner, precondiciones, comandos, evidencia, rollback y criterio de salida. Un archivo presente no prueba que el procedimiento se haya ejecutado live.
