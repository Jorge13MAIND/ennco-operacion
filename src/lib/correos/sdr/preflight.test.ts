import { beforeEach, describe, expect, it, vi } from "vitest";
import { preflightSdrSend } from "@/lib/correos/sdr/preflight";
import type { DirectLaneClaim } from "@/lib/correos/client";
import type { RuntimeConfig } from "@/lib/runtime/config";
const mock = vi.hoisted(() => ({ command: vi.fn(), thread: vi.fn() }));
vi.mock("@/lib/correos/sdr/client", async original => ({ ...await original<typeof import("@/lib/correos/sdr/client")>(), sdrCommand: mock.command }));
vi.mock("@/lib/correos/sdr/runner", () => ({ readSdrThread: mock.thread }));
const id = "61000000-0000-4000-8000-000000000001";
const context = { status: "SEND_CONTEXT", case_id: id, event_id: id, event_kind: "REPLY", body: "Me das contexto", mailbox_id: id, mailbox_email: "sender@example.test", contact_email: "buyer@example.test", owner_id: id, provider_message_id: "incoming", provider_thread_id: "thread", related_outbound_id: id, suppressed: false, followup: false, followups_sent: 0, approved: true, decision: null, own_sdr_message_ids: [] };
const incoming = { id: "incoming", threadId: "thread", internalDate: "1000", payload: { headers: [{ name: "From", value: "buyer@example.test" }, { name: "To", value: "sender@example.test" }], mimeType: "text/plain", body: { data: Buffer.from(context.body).toString("base64url") } } };
const claim = { status: "CLAIMED", kind: "REPLY", from_email: context.mailbox_email, to_email: context.contact_email, thread: { provider_thread_id: "thread", in_reply_to: "<reply@example.test>", references: [] } } satisfies DirectLaneClaim;
beforeEach(() => { vi.resetAllMocks(); mock.command.mockResolvedValue(context); mock.thread.mockResolvedValue({ id: "thread", messages: [incoming] }); });
describe("last check before Gmail POST", () => {
  it("checks the conversation and then suppression a second time", async () => {
    await preflightSdrSend({} as RuntimeConfig, id, id, "synthetic", claim);
    expect(mock.command).toHaveBeenCalledTimes(2);
  });
  it("blocks a different recipient or thread before reading the provider", async () => {
    await expect(preflightSdrSend({} as RuntimeConfig, id, id, "synthetic", { ...claim, to_email: "wrong@example.test" })).rejects.toThrow("SDR_ENVELOPE_MISMATCH");
    expect(mock.thread).not.toHaveBeenCalled();
  });
  it("blocks Paco's manual reply between review and send", async () => {
    mock.thread.mockResolvedValue({ id: "thread", messages: [incoming, { ...incoming, id: "manual", internalDate: "1500", labelIds: ["SENT"] }] });
    await expect(preflightSdrSend({} as RuntimeConfig, id, id, "synthetic", claim)).rejects.toThrow("SDR_SEND_CONVERSATION_CHANGED");
  });
  it("blocks a newly arrived unsubscribe and a late suppression", async () => {
    mock.thread.mockResolvedValueOnce({ id: "thread", messages: [incoming, { ...incoming, id: "unsubscribe", internalDate: "1500" }] });
    await expect(preflightSdrSend({} as RuntimeConfig, id, id, "synthetic", claim)).rejects.toThrow("SDR_SEND_CONVERSATION_CHANGED");
    mock.command.mockResolvedValueOnce(context).mockResolvedValueOnce({ status: "HOLD" });
    await expect(preflightSdrSend({} as RuntimeConfig, id, id, "synthetic", claim)).rejects.toThrow("SDR_SEND_HELD");
  });
});
