# NFR y SLO

## Confiabilidad

- Captura y portal: 99.9% mensual después de producción.
- Ninguna solicitud aceptada puede perderse silenciosamente.
- Alertas críticas: p95 menor a dos minutos.
- Reply sync: p95 menor a cinco minutos.
- Supresión: evaluada en 100% de intentos.
- Doble envío por retry: cero.
- RPO: 15 minutos únicamente con PITR y backup de Storage.
- RTO: cuatro horas, validado por drill.

## Seguridad

- OWASP ASVS 5.0 Level 2 como objetivo de verificación.
- MFA, menor privilegio, RLS y secrets scan.
- PII fuera de logs y fixtures.
- Webhooks firmados con replay protection.
- Archivos privados, validados y con checksum.

## Performance inicial

- API pública p95 menor a 800 ms sin generación de PDF.
- Portal p75 LCP menor a 2.5 s en red móvil razonable.
- Cola operativa p95 menor a 120 segundos.
- Load test inicial: 20 solicitudes por segundo durante cinco minutos sin pérdida.

## Error budget

Si se consume el error budget mensual, se congelan funciones nuevas y el siguiente trabajo es confiabilidad. Unknown nunca es verde.

El contrato M023 vive en `src/lib/slo/enterprise-slo.ts`. Modela exactamente seis SLI canónicos:

1. Disponibilidad pública mensual de captura y portal, cada superficie evaluada por separado contra 99.9%.
2. Cero pérdida silenciosa de solicitudes aceptadas.
3. Alertas críticas con p95 menor a dos minutos.
4. Reply sync con p95 menor a cinco minutos.
5. Supresión evaluada en 100% de intentos.
6. Cero doble envío causado por retry.

Cada SLI requiere una ventana corta de una hora, una ventana larga de seis horas y el mes calendario en `America/Mexico_City`. El evaluador exige denominador, contador de eventos malos, referencia de fuente, SHA256 de la consulta, commit, tree, timestamps actuales y p95 cuando aplica. Un conjunto incompleto, stale, con ventana inválida, sin denominador o con procedencia malformada devuelve `UNKNOWN` y activa `featureFreeze`.

El burn rate es la tasa de eventos malos dividida entre el error permitido. Un burn rate mayor a uno en ventana corta o larga marca `AT_RISK`. El consumo mensual, un p95 mensual fuera del objetivo o cualquier fallo de un SLI de tolerancia cero marca `EXHAUSTED`. Tanto `AT_RISK` como `EXHAUSTED` congelan funciones nuevas.

`synthetic_demo` y `local` nunca satisfacen el SLO operativo. El script `scripts/slo-local-evidence.mts` prueba negativos y hash canónico, pero sólo escribe evidencia ligada a commit y tree cuando el commit solicitado es `HEAD` y el worktree está limpio. El artefacto local debe conservar `operational_slo_status=UNKNOWN`, `feature_freeze=true`, cero registros live y cero efectos externos.

La telemetría administrada, el scheduler, las alertas de burn rate y los denominadores live siguen bloqueados hasta contar con infraestructura autorizada. RPO de 15 minutos y RTO de cuatro horas se verifican por drills separados y no se infieren de este evaluador.
