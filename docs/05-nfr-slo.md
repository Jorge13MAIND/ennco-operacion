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

El contrato local de cálculo vive en `src/lib/slo/error-budget.ts`. Sin denominador de producción devuelve `UNKNOWN` y congela funciones. La telemetría, las alertas de burn rate y los denominadores administrados siguen bloqueados hasta contar con infraestructura autorizada.
