# Handoff ENNCO. Google Cloud y DKIM

Fecha: 2026-08-25, America/Mexico_City.

No compartir contraseñas, códigos MFA, cookies, client secrets ni llaves privadas por correo, chat o ticket.

## 1. Vincular facturación de Google Cloud

Proyecto destino:

```text
august-beaker-478801-t3
```

Acción del administrador de facturación de ENNCO:

1. Abrir Google Cloud Billing con una identidad autorizada por ENNCO.
2. Vincular una cuenta de facturación existente al proyecto indicado. Si no existe, ENNCO decide y crea la cuenta.
3. Confirmar por escrito únicamente:

```text
Proyecto august-beaker-478801-t3 con facturación activa: SÍ
Fecha y hora America/Mexico_City: AAAA-MM-DD HH:MM
```

No enviar datos de tarjeta, IDs de pago ni capturas con información financiera.

Después de esa confirmación, Teckel creará el CryptoKey KMS y otorgará al runtime sólo permisos de cifrado y descifrado.

## 2. Generar DKIM en Google Admin

Dominio:

```text
ennco.com.mx
```

Acción del administrador de Google Workspace ENNCO:

1. Entrar a Google Admin con una cuenta administradora del dominio.
2. Abrir Apps, Google Workspace, Gmail, Autenticar correo electrónico.
3. Seleccionar `ennco.com.mx`.
4. Generar una clave DKIM de 2048 bits.
5. Publicar en el DNS el selector y valor TXT que Google entregue.
6. Iniciar autenticación y esperar propagación.
7. Confirmar por escrito únicamente:

```text
Dominio: ennco.com.mx
Selector DKIM: <selector público>
Estado Google Admin: autenticando o autenticado
Fecha y hora America/Mexico_City: AAAA-MM-DD HH:MM
```

El selector y el registro TXT DKIM son información DNS pública. No incluir contraseñas ni códigos MFA.

## Estado mientras ENNCO completa estas acciones

- Gmail API: habilitada.
- Cloud KMS API: habilitada.
- Cliente OAuth web y callback: configurados.
- Secreto de terminación M30 en Supabase: configurado y validado sin revelar el valor.
- Envío externo: bloqueado.
- Kill switch global: activo.
- Consentimiento OAuth del buzón: no iniciado.
- Correos enviados: cero.

Estas dos acciones no autorizan el piloto. Después faltan rotación del client secret OAuth, KMS, deployment, consentimiento, seeds, headers, reply sync y aprobación exacta del manifiesto.
