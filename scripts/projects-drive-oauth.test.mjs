import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  OWNER,
  SCOPES,
  exchangeAndVerify,
  readConfiguration,
  stateMatches,
  validateRedirect,
  writeCredentials,
} from "./projects-drive-oauth.mjs";

const redirect = "http://127.0.0.1:8765/oauth2callback";
const clientId = "synthetic-projects-client.apps.googleusercontent.com";
const clientSecret = "synthetic-client-secret-for-offline-test";
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "ennco-drive-setup-test-"));
  try {
    await chmod(directory, 0o700);
    const path = join(directory, "client.json"),
      output = join(directory, "drive.env");
    await writeFile(
      path,
      JSON.stringify({
        web: {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uris: [redirect],
        },
      }),
      { mode: 0o600 },
    );
    await run({
      path,
      output,
      directory,
      config: await readConfiguration(path, redirect, output),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function providerFixture(
  email = OWNER,
  scope = `${SCOPES[0]} openid https://www.googleapis.com/auth/userinfo.email`,
) {
  const calls = [];
  const responses = [
    {
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
      scope,
    },
    { email, email_verified: true },
    { user: { emailAddress: email } },
    { access_token: "synthetic-renewed-access-token" },
  ];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json(responses[calls.length - 1]);
    },
  };
}

test("el callback admite sólo loopback exacto y rechaza estados ajenos incluso Unicode", () => {
  assert.equal(validateRedirect(redirect).href, redirect);
  for (const value of [
    "https://example.com/oauth2callback",
    "http://0.0.0.0:8765/cb",
    "http://127.0.0.1:80/cb",
    `${redirect}?x=1`,
    "http://user@127.0.0.1:8765/cb",
    "http://127.0.0.1:8765/a/../cb",
  ])
    assert.throws(() => validateRedirect(value));
  assert.equal(stateMatches("abc123", "abc123"), true);
  for (const value of ["abc12", "abc124", "ñbc123", null])
    assert.equal(stateMatches("abc123", value), false);
});

test("verifica cuenta, scopes y renovación antes de persistir únicamente credenciales de Drive", async () =>
  fixture(async ({ config, output }) => {
    const provider = providerFixture();
    const token = await exchangeAndVerify(
      config,
      "synthetic-code",
      "synthetic-verifier",
      provider.fetch,
    );
    assert.equal(provider.calls.length, 4);
    assert.equal(
      provider.calls[0].init.body.get("code_verifier"),
      "synthetic-verifier",
    );
    assert.equal(
      provider.calls[3].init.body.get("grant_type"),
      "refresh_token",
    );
    assert.equal(
      provider.calls.some((call) => /gmail|files\//.test(call.url)),
      false,
    );
    await writeCredentials(config, token);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const content = await readFile(output, "utf8");
    assert.match(content, /ENNCO_DRIVE_REFRESH_TOKEN=/);
    assert.doesNotMatch(
      content,
      /synthetic-access-token|synthetic-code|synthetic-renewed-access-token|GOOGLE_OAUTH_/,
    );
    await assert.rejects(
      () => writeCredentials(config, "replacement-synthetic-token"),
      /ya existe/,
    );
    assert.equal(await readFile(output, "utf8"), content);
  }));

test("rechaza cuenta equivocada, consentimiento parcial y respuestas fallidas sin mostrar tokens", async () =>
  fixture(async ({ config, output }) => {
    await assert.rejects(
      () =>
        exchangeAndVerify(
          config,
          "synthetic-code",
          "synthetic-verifier",
          providerFixture("other@example.invalid").fetch,
        ),
      /cuenta autorizada/,
    );
    await assert.rejects(
      () =>
        exchangeAndVerify(
          config,
          "synthetic-code",
          "synthetic-verifier",
          providerFixture(OWNER, "openid email").fetch,
        ),
      /Faltan los scopes/,
    );
    await assert.rejects(
      () =>
        exchangeAndVerify(
          config,
          "synthetic-code",
          "synthetic-verifier",
          async () =>
            new Response("do-not-print-synthetic-provider-secret", {
              status: 400,
            }),
        ),
      (error) => !error.message.includes("do-not-print"),
    );
    await assert.rejects(() => stat(output), { code: "ENOENT" });
  }));

test("impide configuración pública, salida dentro del repositorio y redirects no registrados", async () =>
  fixture(async ({ path, directory }) => {
    await assert.rejects(
      () =>
        readConfiguration(
          path,
          "http://127.0.0.1:8766/oauth2callback",
          join(directory, "other.env"),
        ),
      /redirect exacto/,
    );
    await assert.rejects(
      () => readConfiguration(path, redirect, "./drive-secret-test.env"),
      /fuera del repositorio/,
    );
    await chmod(path, 0o644);
    await assert.rejects(
      () => readConfiguration(path, redirect, join(directory, "other.env")),
      /permisos 600/,
    );
  }));

test("--check no abre conexión, no escribe credenciales ni muestra secretos", async () =>
  fixture(async ({ path, output }) => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/projects-drive-oauth.mjs",
        "--config",
        path,
        "--redirect",
        redirect,
        "--output",
        output,
        "--check",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No se conectó a Google/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      new RegExp(clientSecret),
    );
    await assert.rejects(() => stat(output), { code: "ENOENT" });
  }));
