# Paquete de aprobación del aviso de privacidad

Fecha de corte: 20 de agosto de 2026.

Estado: `AWAITING_ENNCO_AND_LEGAL_REVIEW`.

Este paquete no constituye asesoría legal ni autoriza publicación, indexación o envío. Congela el texto exacto que ENNCO y su revisor legal deben aprobar o devolver con cambios.

## Artefacto exacto

- Vista de revisión: <https://ennco-operacion.vercel.app/privacidad>
- Versión: `2026-08-11-v1`
- SHA256 canónico: `d4a24f23350d8a3522f75a169938afe7bcd868c9c812b46aadcbc52681fc718e`
- Fuente canónica: `src/lib/privacy/notice.ts`
- Estado de la vista: `NOINDEX_SYNTHETIC_DEMO`

La aprobación sólo aplica a esa versión y a ese SHA256. Cualquier cambio de texto obliga a emitir un nuevo paquete.

## Ocho decisiones que deben quedar explícitas

1. Confirmar que Francisco Javier Cuellar Orozco, ENNCO y el domicilio mostrado son la identidad responsable correcta.
2. Confirmar las categorías de datos y que el flujo no solicita datos personales sensibles.
3. Confirmar finalidades primarias y la finalidad secundaria de comunicaciones comerciales.
4. Confirmar proveedores, transferencias, contratos de encargado y DPA aplicables.
5. Confirmar plazos operativos de 90 días, 12 meses y 24 meses, o devolver plazos corregidos.
6. Confirmar `francisco.cuellar@ennco.com.mx` como canal ARCO y el proceso de acreditación de identidad.
7. Definir y aprobar la base jurídica para prospección B2B antes de cualquier contacto real.
8. Designar responsable de privacidad y proceso de respuesta.

## Respuesta de aprobación sugerida

> ENNCO aprueba el aviso de privacidad versión 2026-08-11-v1, SHA256 d4a24f23350d8a3522f75a169938afe7bcd868c9c812b46aadcbc52681fc718e, sujeto a la revisión legal documentada. Confirmamos identidad responsable, domicilio, finalidades, retención, canal ARCO, base jurídica de prospección B2B y responsable de privacidad. Esta aprobación no autoriza por sí sola publicar ni enviar campañas.

Si existe cualquier corrección, debe señalarse por sección. No se aceptará una aprobación genérica sin versión y SHA256.

## Gate posterior

Después de recibir aprobación válida:

1. Registrar sponsor, revisor y timestamp.
2. Ejecutar `npm run verify:privacy-notice`.
3. Ejecutar `npm run verify:privacy-approval-pack` con el paquete actualizado.
4. Configurar versión y SHA únicamente en staging aislado.
5. Revalidar diagnóstico, privacidad, robots, sitemap, persistencia y alertas.
6. Mantener `ENNCO_PUBLIC_SURFACE_RELEASED=false` y outreach en HOLD hasta los demás gates.
