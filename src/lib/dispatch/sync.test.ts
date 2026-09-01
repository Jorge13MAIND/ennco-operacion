import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M036: el invariante que impide que vuelva el bucle exponencial de incidentes.
 *
 * Todo evento que el consumidor RECLAMA del outbox tiene que salir del limbo:
 * completado o fallado. Si uno se abandona, queda PENDING para siempre, el
 * watchdog lo ve detenido y abre un incidente, que genera otro evento, que
 * genera otro incidente. El 26-27 de agosto eso produjo 2,522 incidentes P1 y,
 * como el release exige open_p1 = 0, dejó el canal incapaz de enviar nada.
 */

const completado: string[] = [];
const fallado: string[] = [];
let eventos: unknown[] = [];
// Por default la credencial revienta (las pruebas del bucle nunca deben llegar
// a Gmail); la prueba del conteo de respuestas la habilita explícitamente.
let leerCredencial: () => Promise<unknown> = async () => { throw new Error("no debe llamarse en estas pruebas"); };
let mensajesHistoria: Array<{ id: string; kind: string }> = [];

vi.mock("@/lib/dispatch/client", () => ({
  claimDispatchOutbox: async () => ({ events: eventos }),
  completeDispatchOutboxEvent: async (_c: unknown, id: string) => { completado.push(id); },
  failDispatchOutboxEvent: async (_c: unknown, id: string) => { fallado.push(id); },
  readHybridDispatchCredential: async () => leerCredencial(),
  updateDispatchSyncCursor: async () => undefined,
  applyDispatchProviderEvent: async () => undefined,
}));

vi.mock("@/lib/gmail/oauth-server", () => ({
  createGoogleKmsEnvelopeClient: () => ({ decryptText: async () => "refresh" }),
}));

vi.mock("@/lib/dispatch/gmail-token", () => ({
  getGmailAccessToken: async () => "token-de-prueba",
}));

vi.mock("@/lib/gmail/history", () => ({
  GmailHistoryResetRequiredError: class GmailHistoryResetRequiredError extends Error {},
  collectGmailHistory: async () => ({ historyId: "200", messages: mensajesHistoria }),
  classifyGmailMessage: (message: { kind: string }) => message.kind,
  extractGmailEventContext: () => ({
    relatedOutboundMessageId: null,
    normalizedFrom: "prospecto@planta.mx",
    subject: "Re: Lo que le costó un apagón a un cliente",
    internalDateEpoch: 1_756_700_000,
    failedRecipient: null,
  }),
}));

const { runGmailSync } = await import("@/lib/dispatch/sync");

const config = {
  organizationId: "e0000000-0000-4000-8000-000000000001",
  googleKmsKeyName: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
  googleOauthClientId: "id",
  googleOauthClientSecret: "secret",
} as never;

describe("drenado del outbox (M036)", () => {
  beforeEach(() => {
    completado.length = 0;
    fallado.length = 0;
    leerCredencial = async () => { throw new Error("no debe llamarse en estas pruebas"); };
    mensajesHistoria = [];
  });

  it("completa los eventos que no le tocan, en vez de abandonarlos", async () => {
    eventos = [
      { id: "11111111-1111-4111-8111-111111111111", event_type: "incident.opened", payload_json: { incident_id: "x" } },
      { id: "22222222-2222-4222-8222-222222222222", event_type: "control_cadence.unknown", payload_json: {} },
      { id: "33333333-3333-4333-8333-333333333333", event_type: "suppression.annex_a_applied", payload_json: {} },
    ];

    await runGmailSync(config);

    // Los tres eran justamente los tipos que alimentaban el bucle.
    expect(completado).toHaveLength(3);
    expect(fallado).toHaveLength(0);
  });

  it("falla el evento de gmail cuyo payload no sirve, en vez de abandonarlo", async () => {
    eventos = [
      { id: "44444444-4444-4444-8444-444444444444", event_type: "gmail.history_sync_requested", payload_json: { falta: "todo" } },
    ];

    const resumen = await runGmailSync(config);

    expect(fallado).toEqual(["44444444-4444-4444-8444-444444444444"]);
    expect(resumen.failedEvents).toBe(1);
  });

  it("ningún evento reclamado se queda sin marcar", async () => {
    eventos = [
      { id: "55555555-5555-4555-8555-555555555555", event_type: "incident.opened", payload_json: {} },
      { id: "66666666-6666-4666-8666-666666666666", event_type: "gmail.history_sync_requested", payload_json: { mailbox_id: "no-es-uuid" } },
      { id: "77777777-7777-4777-8777-777777777777", event_type: "control_cadence.heartbeat_stale", payload_json: {} },
    ];

    await runGmailSync(config);

    const marcados = new Set([...completado, ...fallado]);
    expect(marcados.size).toBe(eventos.length);
  });

  it("drena lo ajeno a Gmail aunque NO haya credenciales configuradas", async () => {
    // El caso real del 31-ago-2026: sin client secret, runGmailSync se rendía
    // antes de reclamar el outbox. No se drenaba nada, el watchdog veía los
    // eventos detenidos y abría ~60 incidentes al día. Con incidentes P1
    // abiertos ningún envío externo puede salir.
    const sinCredenciales = { organizationId: "e0000000-0000-4000-8000-000000000001" } as never;
    eventos = [
      { id: "88888888-8888-4888-8888-888888888888", event_type: "control_cadence.unknown", payload_json: {} },
      { id: "99999999-9999-4999-8999-999999999999", event_type: "incident.opened", payload_json: {} },
    ];

    await runGmailSync(sinCredenciales);

    expect(completado).toHaveLength(2);
  });

  it("cuenta solo los REPLY humanos para la alerta de SLA de respuesta", async () => {
    // docs/external/sla-de-respuesta.md: la alerta de Telegram del cron dispara
    // con appliedReplyEvents > 0. Un auto-reply (out of office) no arranca SLA.
    leerCredencial = async () => ({ ciphertext: "c", kms_key_name: "k", credential_sha256: "s" });
    mensajesHistoria = [
      { id: "m1", kind: "REPLY" },
      { id: "m2", kind: "AUTO_REPLY" },
      { id: "m3", kind: "UNKNOWN" },
    ];
    eventos = [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", event_type: "gmail.history_sync_requested", payload_json: { mailbox_id: "11111111-1111-4111-8111-111111111111", history_id: "123" } },
    ];

    const resumen = await runGmailSync(config);

    // UNKNOWN se descarta antes de aplicar; REPLY y AUTO_REPLY sí se aplican.
    expect(resumen.appliedProviderEvents).toBe(2);
    expect(resumen.appliedReplyEvents).toBe(1);
    expect(resumen.failedEvents).toBe(0);
  });

  it("devuelve a la cola el evento de gmail cuando faltan credenciales, con razón", async () => {
    const sinCredenciales = { organizationId: "e0000000-0000-4000-8000-000000000001" } as never;
    eventos = [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", event_type: "gmail.history_sync_requested", payload_json: { mailbox_id: "11111111-1111-4111-8111-111111111111", history_id: "123" } },
    ];

    const resumen = await runGmailSync(sinCredenciales);

    expect(fallado).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(resumen.failedEvents).toBe(1);
  });
});
