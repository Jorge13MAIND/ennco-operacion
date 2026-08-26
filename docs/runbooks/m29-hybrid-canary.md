# Runbook M29. Canary híbrido

## Regla de inicio

No se carga un destinatario hasta que el read model del buzón exacto sea `READY` y el runtime continúe en `HOLD`. Primero se genera y revisa el manifiesto. La aprobación de un buzón nunca habilita los demás.

## Orden operativo

1. Verificar identidad `Francisco Cuellar <contacto@ennco.com.mx>`.
2. Registrar evidencia live de SPF, DKIM, DMARC, TLS y blocklist.
3. Enviar seeds controladas a Gmail, Outlook y Yahoo.
4. Conectar Gmail OAuth con permisos mínimos y probar reply sync.
5. Aplicar Anexo A y ejecutar reconciliación.
6. Seleccionar cinco empresas Tier 1 y un contacto por empresa.
7. Verificar cada correo con evidencia de menos de 30 días.
8. Congelar copy, secuencia, supresión, ruta y manifiesto por SHA256.
9. Ejecutar dry run exacto.
10. Obtener aprobación explícita del release de cinco empresas.
11. Abrir runtime sólo durante la ventana aprobada.
12. Observar proveedor, inbox, replies, rebotes, bajas y ledger por 24 horas.
13. Volver a `HOLD` ante cualquier unknown o regla de pausa.

## Criterios de mensaje

- menos de 100 palabras;
- texto plano;
- sin imagen;
- sin PDF;
- sin enlace en el primer touch;
- CTA de bajo compromiso;
- máximo tres touches;
- WhatsApp frío prohibido;
- LinkedIn manual solamente.

## Pausa o kill

Kill inmediato:

- una queja de spam;
- un rebote duro antes de 20 entregas válidas.

Pausa inmediata:

- rebote duro de 2 por ciento o más después de 20 entregas;
- entrega menor a 95 por ciento;
- SPF, DKIM, DMARC o TLS degradado;
- reply sync mayor a cinco minutos;
- una respuesta positiva fuera del SLA operativo;
- proveedor y ledger no coinciden;
- supresión o identidad desconocida.

## Evidencia mínima de cierre

- manifiesto y hashes;
- cinco destinatarios exactos;
- headers de seeds;
- estado DNS;
- captura de inbox;
- estado de reply sync;
- observación acumulativa;
- respuestas y siguiente acción;
- decisión `PASS`, `EXTEND` o `KILL`.
