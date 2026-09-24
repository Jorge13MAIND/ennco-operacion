import { describe, expect, it, vi } from "vitest";
import { sendSdrAlertEmail } from "@/lib/correos/sdr/alert-email";
import { DirectLaneSendError } from "@/lib/correos/gmail-send";
import type { DirectLaneHealth } from "@/lib/correos/client";
import type { RuntimeConfig } from "@/lib/runtime/config";

const alert = { case_id: "61000000-0000-4000-8000-000000000001", stage: "OVERDUE" as const,
  pending_minutes: 130, owner_email: "owner@example.test", backup_email: "backup@example.test" };
const mailboxHealth = { mailboxes: [{ mailbox_id: "61000000-0000-4000-8000-000000000002",
  normalized_email: "contacto@ennco.com.mx", is_client_primary: true, status: "CONNECTED", credential_active: true }] } as DirectLaneHealth;

describe("internal SDR alert email", () => {
  it("uses the connected client mailbox and sends only to the assigned people", async () => {
    const send = vi.fn(async () => ({ provider: "GMAIL_API" as const, provider_message_id: "synthetic",
      provider_thread_id: "synthetic", rfc_message_id: "<synthetic>", envelope_sha256: "a".repeat(64) }));
    const result = await sendSdrAlertEmail({} as RuntimeConfig, alert, {
      health: async () => mailboxHealth,
      token: async () => "synthetic-access-token-32-characters",
      sender: () => ({ send }),
    });
    expect(result).toBe("ACCEPTED");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from_email: "contacto@ennco.com.mx",
      to_email: "backup@example.test", cc_emails: ["owner@example.test"], kind: "TOUCH", thread: null }));
  });

  it("holds ambiguous acceptance and treats an explicit rejection as unavailable", async () => {
    const deps = { health: async () => mailboxHealth, token: async () => "synthetic-access-token-32-characters" };
    expect(await sendSdrAlertEmail({} as RuntimeConfig, alert, {
      ...deps, sender: () => ({ send: async () => { throw new Error("timeout after send"); } }),
    })).toBe("AMBIGUOUS");
    expect(await sendSdrAlertEmail({} as RuntimeConfig, alert, {
      ...deps, sender: () => ({ send: async () => { throw new DirectLaneSendError("GMAIL_API_REQUEST_REJECTED"); } }),
    })).toBe("UNAVAILABLE");
  });
});
