# Conectar el Drive de Proyectos ENNCO

Este procedimiento prepara una autorización **independiente de Gmail** para `contacto@ennco.com.mx`. El repositorio incluye el asistente local, pero esta documentación no acredita una conexión ni carpetas creadas. No se usaron credenciales existentes para ejecutarlo.

## Preparar un cliente independiente

Responsable: operador de infraestructura autorizado por ENNCO, con acceso a la cuenta propietaria.

1. Utiliza un proyecto de Google Cloud dedicado a esta integración; habilita Google Drive API. No modifiques el proyecto, cliente OAuth, callbacks ni variables `GOOGLE_OAUTH_*` que utiliza Gmail.
2. Configura el consentimiento para ENNCO y crea un cliente OAuth de tipo **Aplicación web**. Registra exactamente `http://127.0.0.1:8765/oauth2callback` como URI de redirección autorizado. Si eliges otro puerto o ruta, utiliza esa misma URI en el asistente y descarga otra vez el JSON del cliente.
3. Habilita estos permisos: `https://www.googleapis.com/auth/drive.file`, `openid` y `email`. El primer permiso permite operar archivos creados o autorizados para esta aplicación; no se pide acceso global a Drive. La API `about.get` también acepta `drive.file`. [Scopes de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [permisos de about.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get).
4. La identidad se comprueba con UserInfo y con la cuenta que reporta Drive. Se requiere que ambas identifiquen exactamente `contacto@ennco.com.mx`, con email verificado. Una lista de distribución o un alias de otra cuenta no satisface esta comprobación. [Identidad OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
5. Si el consentimiento es interno, la cuenta debe pertenecer a la organización configurada. Si es externo en modo de prueba, agrega la cuenta como usuario de prueba. No uses ese estado como conexión permanente: Google puede emitir refresh tokens de siete días para aplicaciones externas en Testing con estos permisos. Atiende el estado de publicación y los requisitos que muestre Google antes de liberar la integración. [Vigencia de refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration).

La redirección distingue esquema, host, puerto, ruta y slash final. El asistente solicita acceso offline y consentimiento explícito; usa estado aleatorio, PKCE S256 y un único callback. [Flujo de autorización de Google](https://developers.google.com/identity/protocols/oauth2/web-server), [implementación de PKCE en la biblioteca oficial](https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/oauth2client.ts).

## Obtener la credencial con el asistente local

Requiere Node.js 22 o posterior y un navegador en el mismo equipo. No abras este callback a Internet. En un servidor remoto, ejecuta el asistente en el equipo del operador o utiliza un túnel SSH local previamente autorizado; ambos extremos deben conservar el puerto y la URI exactos. El asistente sólo escucha en `127.0.0.1`.

Guarda el JSON descargado del **nuevo** cliente fuera del repositorio, por ejemplo en `$HOME/.config/ennco/projects-drive-client.json`. El JSON debe contener el objeto `web` y sus `redirect_uris`. Prepara el directorio y restringe el archivo una vez descargado:

```bash
install -d -m 700 "$HOME/.config/ennco"
chmod 600 "$HOME/.config/ennco/projects-drive-client.json"
```

Desde la raíz del repositorio, valida sin red ni escritura:

```bash
node scripts/projects-drive-oauth.mjs \
  --config "$HOME/.config/ennco/projects-drive-client.json" \
  --redirect http://127.0.0.1:8765/oauth2callback \
  --output "$HOME/.config/ennco/projects-drive.env" \
  --check
```

Después, el operador inicia la autorización quitando `--check`:

```bash
node scripts/projects-drive-oauth.mjs \
  --config "$HOME/.config/ennco/projects-drive-client.json" \
  --redirect http://127.0.0.1:8765/oauth2callback \
  --output "$HOME/.config/ennco/projects-drive.env"
```

Abre la URL que muestra la terminal, elige `contacto@ennco.com.mx` y revisa el consentimiento. El asistente tiene cinco minutos para recibirlo. Comprueba los permisos concedidos, la identidad de Google, la cuenta de Drive y una renovación offline. Sólo entonces guarda las tres variables `ENNCO_DRIVE_*` en el archivo indicado, con permisos `600`. No imprime client_secret, códigos de autorización ni tokens; no guarda access tokens o ID tokens. No crea carpetas, mueve documentos ni cambia permisos de Drive.

El archivo de salida no puede existir previamente y su directorio debe tener permisos `700`. Para renovar la conexión, usa otro nombre de salida y sustituye después la credencial del entorno mediante su gestor de secretos. El asistente nunca sobrescribe una credencial anterior. No revoques indiscriminadamente el acceso de Gmail si Google no devuelve un refresh token: comprueba que estás utilizando el cliente independiente correcto.

## Configurar el entorno del dashboard

Configura sólo en el servidor del destino autorizado:

| Variable                    | Contenido                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ENNCO_DRIVE_CLIENT_ID`     | ID del cliente independiente validado.                                                                    |
| `ENNCO_DRIVE_CLIENT_SECRET` | Secreto del mismo cliente.                                                                                |
| `ENNCO_DRIVE_REFRESH_TOKEN` | Token de `contacto@ennco.com.mx` emitido para ese cliente.                                                |
| `ENNCO_BANXICO_TOKEN`       | Token de consulta Banxico del operador, si se habilita la consulta FIX. No se obtiene por OAuth de Drive. |
| `ENNCO_PROJECTS_DEMO_WRITE` | `false` en despliegues. `true` únicamente para pruebas locales temporales con datos sintéticos.           |

En Vercel, registra las tres credenciales como variables protegidas de servidor en el proyecto y ambiente autorizados. No las prefijes con `NEXT_PUBLIC_`, no pegues valores en tickets, logs o comandos de terminal, y no importes las variables de Gmail. La aplicación desplegada sólo recibe las tres variables de Drive; la URI de loopback se utiliza en el asistente local, no en Vercel. Esta preparación no ejecuta ningún despliegue.

Para un arranque local autorizado que necesite las credenciales, Node puede cargar directamente el archivo privado sin imprimirlo:

```bash
node --env-file="$HOME/.config/ennco/projects-drive.env" \
  node_modules/next/dist/bin/next dev --port 3017
```

La base dedicada, organización y sesión del entorno también deben estar configuradas. La demostración nunca sincroniza Drive, aunque existan credenciales. La mera presencia de variables produce el estado **Conexión configurada**, no una prueba de conexión.

## Crear y comprobar un expediente conectado

En el entorno conectado y autorizado, Administración o Dirección abre un proyecto y utiliza **Documentos → Crear o sincronizar carpeta**. Esta acción sí crea recursos externos. El código reserva identificadores y conserva `drive_setup` para reintentar sobre la misma estructura:

```text
Proyectos ENNCO/
  <folio del proyecto>/
    01. Información del cliente/
    02. Levantamiento técnico/
    03. Ingeniería/
    04. Propuesta económica/
    05. Contrato y pagos/
    06. Compras/
    07. Ejecución/
    08. Cierre del proyecto/
```

La implementación actual utiliza **Mi unidad** de la cuenta propietaria. Exige propietario `contacto@ennco.com.mx`, identidad interna del expediente y permisos exclusivos de esa cuenta. Rechaza acceso público, de dominio, grupos u otros usuarios; no añade colaboradores automáticamente. No está diseñada para unidades compartidas ni para adoptar una carpeta existente creada a mano. Un conflicto de permisos debe revisarse con ENNCO antes de corregirlo; el código no elimina permisos ajenos por su cuenta.

Los enlaces directos de Drive requieren la sesión de la cuenta propietaria. Para el resto del equipo, el dashboard ofrece descargas mediadas por sesión, organización y permisos del registro mediante `/api/v1/projects/:id/documents/:recordId`. Esa ruta descarga el respaldo del bucket privado; no convierte el archivo de Drive en público. Drive es el repositorio documental oficial, mientras que la base conserva índices, revisiones y datos financieros.

Verifica con un expediente de prueba autorizado: cuenta correcta, ocho carpetas, rechazo de permisos adicionales, carga y descarga permitidas, acceso denegado para otra organización y reintento sin duplicación. Registra la evidencia de esa validación sin secretos. Hasta realizarla, el estado de Drive permanece pendiente de validación real.

## Incidencias habituales

| Resultado                                   | Acción concreta                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Redirect no coincide                        | Compara la URI completa en Google, JSON y comando; vuelve a descargar el cliente.                   |
| Puerto ocupado                              | Usa un puerto libre y actualiza tanto Google como el JSON y el comando.                             |
| Cuenta diferente                            | Repite el consentimiento con la cuenta propietaria exacta; no se guarda su token.                   |
| Faltan permisos / Drive API no disponible   | Comprueba API habilitada, los tres scopes y políticas de Workspace para este cliente.               |
| No hay refresh token / renovación rechazada | Revisa cliente, consentimiento, estado Testing y revocaciones. Obtén otra credencial independiente. |
| Conflicto de permisos en carpeta            | Examina el recurso con la cuenta propietaria; no lo hagas público para resolver el error.           |
| Archivo privado existente                   | Elige una ruta nueva; no se sobrescribe el token anterior.                                          |

Verificación local del asistente, sin conexión a Google:

```bash
node --check scripts/projects-drive-oauth.mjs
node --test scripts/projects-drive-oauth.test.mjs
```
