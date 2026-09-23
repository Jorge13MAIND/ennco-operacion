import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileDirectMailbox } from "@/lib/correos/reconcile";
import type { RuntimeConfig } from "@/lib/runtime/config";
const mocks = vi.hoisted(() => ({ health: vi.fn(), credential: vi.fn(), resolve: vi.fn(), record: vi.fn(), collect: vi.fn(), replay: vi.fn(), apply: vi.fn(), cursor: vi.fn() }));
vi.mock("@/lib/correos/client", () => ({ readDirectLaneHealth: mocks.health, readDirectLaneCredential: mocks.credential, resolveDirectLaneOutbound: mocks.resolve, recordEmailRecovery: mocks.record }));
vi.mock("@/lib/correos/vault", () => ({ openDirectLaneSecret: () => "synthetic" }));
vi.mock("@/lib/dispatch/gmail-token", () => ({ getGmailAccessToken: async () => "synthetic" }));
vi.mock("@/lib/correos/gmail-recovery", () => ({ collectGmailRecovery: mocks.collect, gmailRecoveryTransport: () => ({}) }));
vi.mock("@/lib/correos/sync", () => ({ gmailTransport: () => ({}) }));
vi.mock("@/lib/dispatch/client", () => ({ applyDispatchProviderEvent: mocks.apply, updateDispatchSyncCursor: mocks.cursor }));
vi.mock("@/lib/gmail/history", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/gmail/history")>(), collectGmailHistory: mocks.replay }));
const config = { organizationId: "org", directLaneVaultKey: "synthetic", googleOauthClientId: "synthetic", googleOauthClientSecret: "synthetic" } as RuntimeConfig;
const message = { id: "m", threadId: "t", internalDate: "1790164800000", payload: { mimeType: "text/plain", body: { data: Buffer.from("¿Me explicas el servicio?").toString("base64url") }, headers: [{ name: "From", value: "buyer@example.test" }, { name: "In-Reply-To", value: "<sent@example.test>" }, { name: "Message-ID", value: "<reply@example.test>" }] } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.health.mockResolvedValue({ mailboxes: [{ mailbox_id: "mb", normalized_email: "sender@example.test", credential_active: true }] });
  mocks.credential.mockResolvedValue({ normalized_email: "sender@example.test" });
  mocks.resolve.mockResolvedValue("out");
  mocks.collect.mockResolvedValue({ listedCount: 1, messages: [message], historyFence: "10", untilEpochMs: 1790164800000 });
  mocks.replay.mockResolvedValue({ historyId: "12", messages: [] });
  mocks.apply.mockResolvedValue({ status: "DUPLICATE", provider_event_id: "61000000-0000-4000-8000-000000000001" });
  mocks.record.mockImplementation(async (_c, _m, p) => ({ status: p.kind === "COMPLETE" ? "RECONCILED" : "RECORDED" }));
  mocks.cursor.mockResolvedValue({ status: "ADVANCED" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "t", messages: [message] })));
});
describe("bounded reconciliation", () => {
  it("recovers duplicate event bodies and full threads before recording a complete replay and moving the cursor", async () => {
    const result = await reconcileDirectMailbox(config, "mb", "2026-09-08T00:00:00-06:00");
    expect(result.counts.duplicates).toBe(1);
    expect(mocks.record.mock.calls.map(c => c[2].kind)).toEqual(["MESSAGE", "COMPLETE"]);
    expect(mocks.cursor).toHaveBeenCalledOnce();
    expect(mocks.replay.mock.invocationCallOrder[0]).toBeLessThan(mocks.cursor.mock.invocationCallOrder[0]!);
  });
  it.each(["body", "replay", "persist", "identity"])("never moves the cursor when %s is unresolved", async issue => {
    if (issue === "body") mocks.collect.mockResolvedValue({ messages: [{ ...message, payload: { ...message.payload, body: {} } }] });
    if (issue === "replay") mocks.replay.mockRejectedValue(new Error("HISTORY_GAP"));
    if (issue === "persist") mocks.record.mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    if (issue === "identity") mocks.credential.mockResolvedValue({ normalized_email: "other@example.test" });
    await expect(reconcileDirectMailbox(config, "mb", "2026-09-08T00:00:00-06:00")).rejects.toThrow();
    expect(mocks.cursor).not.toHaveBeenCalled();
  });
});
