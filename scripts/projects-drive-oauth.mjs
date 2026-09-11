import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OWNER = "contacto@ennco.com.mx";
export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
];
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
class SetupError extends Error {}
const fail = (message) => {
  throw new SetupError(message);
};
const within = (parent, child) => {
  const path = relative(parent, child);
  return !path || (!path.startsWith("..") && !isAbsolute(path));
};

export function validateRedirect(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("El redirect debe ser una URL loopback válida.");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) < 1024 ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value
  )
    fail(
      "Usa un redirect exacto http://127.0.0.1:PUERTO/ruta, sin query ni fragmento; puerto 1024–65535.",
    );
  return url;
}
export function stateMatches(expected, received) {
  return (
    typeof received === "string" &&
    /^[A-Za-z0-9_-]+$/.test(received) &&
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
async function privateFile(path) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    fail(
      "El archivo de configuración debe pertenecer al operador, ser regular y tener permisos 600.",
    );
  const canonical = await realpath(path);
  if (within(REPOSITORY, canonical))
    fail("La configuración y los tokens deben quedar fuera del repositorio.");
  return canonical;
}
async function outputLocation(path, create = false) {
  const output = resolve(path);
  if (within(REPOSITORY, output))
    fail("El archivo de tokens debe quedar fuera del repositorio.");
  if (create) await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const directory = await realpath(dirname(output));
  if (within(REPOSITORY, directory))
    fail("La carpeta de tokens apunta al repositorio.");
  const info = await stat(directory);
  if (
    !info.isDirectory() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    fail(
      "La carpeta de tokens debe pertenecer al operador y tener permisos 700.",
    );
  try {
    await lstat(output);
    fail(
      "El archivo de salida ya existe. Elige otra ruta; no se sobrescriben credenciales.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return resolve(directory, relative(dirname(output), output));
}
export async function readConfiguration(configPath, redirectValue, outputPath) {
  const redirect = validateRedirect(redirectValue);
  const path = await privateFile(resolve(configPath));
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("El archivo de cliente OAuth no contiene JSON válido.");
  }
  const client = value.web;
  if (
    !client ||
    typeof client.client_id !== "string" ||
    !client.client_id.endsWith(".apps.googleusercontent.com") ||
    typeof client.client_secret !== "string" ||
    !client.client_secret
  )
    fail(
      "Se requiere el JSON de un cliente OAuth independiente de tipo Aplicación web.",
    );
  if (
    !Array.isArray(client.redirect_uris) ||
    !client.redirect_uris.includes(redirect.href)
  )
    fail(
      "El redirect exacto debe estar autorizado en el cliente OAuth y en su JSON descargado.",
    );
  const output = await outputLocation(outputPath);
  return {
    clientId: client.client_id,
    clientSecret: client.client_secret,
    redirect,
    output,
  };
}
async function providerJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    fail(
      "Google rechazó la verificación. Revisa cliente, consentimiento, cuenta y permisos; no se guardaron tokens.",
    );
  const text = await response.text();
  if (text.length > 128_000)
    fail("Respuesta inesperada de Google; no se guardaron tokens.");
  try {
    return JSON.parse(text);
  } catch {
    fail("Google devolvió una respuesta no válida; no se guardaron tokens.");
  }
}
export async function exchangeAndVerify(
  config,
  code,
  verifier,
  fetchImpl = fetch,
) {
  const tokens = await providerJson(
    fetchImpl,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: config.redirect.href,
      }),
    },
  );
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string" ||
    !tokens.refresh_token
  )
    fail(
      "No se recibió refresh token. Repite el consentimiento del cliente independiente; no reutilices el token de Gmail.",
    );
  const scopes = new Set(String(tokens.scope ?? "").split(" "));
  if (
    !scopes.has(SCOPES[0]) ||
    !scopes.has("openid") ||
    (!scopes.has("email") &&
      !scopes.has("https://www.googleapis.com/auth/userinfo.email"))
  )
    fail(
      "Faltan los scopes Drive y de identidad solicitados; no se guardaron tokens.",
    );
  const auth = { headers: { Authorization: `Bearer ${tokens.access_token}` } };
  const identity = await providerJson(
    fetchImpl,
    "https://openidconnect.googleapis.com/v1/userinfo",
    auth,
  );
  const drive = await providerJson(
    fetchImpl,
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    auth,
  );
  if (
    identity.email_verified !== true ||
    identity.email?.toLowerCase() !== OWNER ||
    drive.user?.emailAddress?.toLowerCase() !== OWNER
  )
    fail(
      "La cuenta autorizada no es contacto@ennco.com.mx; no se guardaron tokens.",
    );
  // Verify offline access before persisting the credential; do not save short-lived access/ID tokens.
  const refreshed = await providerJson(
    fetchImpl,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: tokens.refresh_token,
      }),
    },
  );
  if (typeof refreshed.access_token !== "string" || !refreshed.access_token)
    fail("No se pudo verificar la renovación offline; no se guardaron tokens.");
  return tokens.refresh_token;
}
export async function writeCredentials(config, refreshToken) {
  const output = await outputLocation(config.output, true);
  const values = {
    ENNCO_DRIVE_CLIENT_ID: config.clientId,
    ENNCO_DRIVE_CLIENT_SECRET: config.clientSecret,
    ENNCO_DRIVE_REFRESH_TOKEN: refreshToken,
  };
  if (
    Object.values(values).some(
      (value) => typeof value !== "string" || !/^[\x21-\x7e]+$/.test(value),
    )
  )
    fail("Formato de credencial inesperado; no se guardaron tokens.");
  const content =
    "# OAuth independiente de Proyectos ENNCO. Sólo servidor.\n" +
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") +
    "\n";
  const file = await open(output, "wx", 0o600);
  try {
    await file.writeFile(content, "utf8");
    await file.sync();
  } catch {
    await file.close();
    await unlink(output);
    fail("No se pudo guardar el archivo de credenciales.");
  }
  await file.close();
  return output;
}
function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (["--help", "--check"].includes(key)) values[key] = true;
    else if (
      ["--config", "--redirect", "--output"].includes(key) &&
      argv[index + 1] &&
      !argv[index + 1].startsWith("--")
    )
      values[key] = argv[++index];
    else
      fail(
        "Argumento no válido. Usa --help; nunca pases secretos como argumentos.",
      );
  }
  return values;
}
export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args["--help"]) {
    process.stdout.write(
      "Uso: node scripts/projects-drive-oauth.mjs --config /ruta/cliente.json --redirect http://127.0.0.1:8765/oauth2callback --output /ruta/privada/projects-drive.env [--check]\n--check valida configuración y permisos sin red, servidor ni escritura.\n",
    );
    return;
  }
  if (!args["--config"] || !args["--redirect"] || !args["--output"])
    fail("Faltan --config, --redirect o --output. Consulta --help.");
  const config = await readConfiguration(
    args["--config"],
    args["--redirect"],
    args["--output"],
  );
  if (args["--check"]) {
    process.stdout.write(
      "Configuración local válida. No se conectó a Google ni se crearon archivos.\n",
    );
    return;
  }
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({
    client_id: config.clientId,
    redirect_uri: config.redirect.href,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    login_hint: OWNER,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }))
    authorization.searchParams.set(key, value);
  await new Promise((resolveDone, reject) => {
    let consumed = false;
    const close = (error) => {
      clearTimeout(timer);
      server.close();
      server.closeIdleConnections();
      if (error) reject(error);
      else resolveDone();
    };
    const server = createServer(async (request, response) => {
      response.setHeader("Connection", "close");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", "default-src 'none'");
      let url;
      try {
        url = new URL(request.url ?? "/", config.redirect.origin);
      } catch {
        response.writeHead(400).end("Solicitud no válida.");
        return;
      }
      if (
        request.method !== "GET" ||
        request.headers.host !== config.redirect.host ||
        url.pathname !== config.redirect.pathname
      ) {
        response.writeHead(404).end("Ruta no disponible.");
        return;
      }
      if (
        consumed ||
        url.searchParams.getAll("state").length !== 1 ||
        !stateMatches(state, url.searchParams.get("state"))
      ) {
        response.writeHead(400).end("Solicitud de autorización no válida.");
        return;
      }
      consumed = true;
      clearTimeout(timer);
      if (
        url.searchParams.has("error") ||
        url.searchParams.getAll("code").length !== 1 ||
        !url.searchParams.get("code")
      ) {
        response
          .writeHead(400)
          .end("No se completó el consentimiento. Puedes cerrar esta pestaña.");
        close(
          new SetupError(
            "Autorización cancelada o incompleta; no se guardaron tokens.",
          ),
        );
        return;
      }
      try {
        const token = await exchangeAndVerify(
          config,
          url.searchParams.get("code"),
          verifier,
        );
        const path = await writeCredentials(config, token);
        response.end(
          "Cuenta verificada y credencial guardada localmente. Puedes cerrar esta pestaña. No se crearon carpetas en Drive.",
        );
        process.stdout.write(
          `Cuenta ENNCO verificada; archivo privado guardado en ${path}. No se crearon carpetas en Drive.\n`,
        );
        close();
      } catch (error) {
        response
          .writeHead(400)
          .end(
            "No se completó la conexión. Consulta la terminal; no se muestran credenciales.",
          );
        close(error);
      }
    });
    const timer = setTimeout(
      () =>
        close(
          new SetupError(
            "Se agotaron 5 minutos. Reinicia el asistente para generar otro consentimiento.",
          ),
        ),
      300_000,
    );
    server.headersTimeout = 5000;
    server.requestTimeout = 10000;
    server.on("error", () =>
      close(
        new SetupError(
          "No se pudo abrir el puerto loopback. Revisa que esté libre y que el redirect coincida.",
        ),
      ),
    );
    server.listen(Number(config.redirect.port), "127.0.0.1", () => {
      process.stdout.write(
        `Abre esta URL en un navegador de este equipo y elige ${OWNER}:\n${authorization.href}\nLa URL no contiene client_secret ni tokens. No compartas la URL de retorno.\n`,
      );
    });
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof SetupError ? error.message : "Falló la configuración local o la conexión. No se muestran detalles que puedan contener secretos."}\n`,
    );
    process.exitCode = 1;
  });
