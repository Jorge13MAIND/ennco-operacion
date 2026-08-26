import { describe, expect, it, vi } from "vitest";

import { classifyGmailMessage, collectGmailHistory, extractGmailEventContext, GmailHistoryResetRequiredError, type GmailMessageMetadata } from "@/lib/gmail/history";

function message(headers: Array<{ name: string; value: string }>): GmailMessageMetadata {
  return {
    id: "gmail-1",
    threadId: "thread-1",
    internalDate: "1786478400000",
    payload: { headers, mimeType: "text/plain" },
  };
}

describe("Gmail history synchronization", () => {
  it("paginates, deduplicates and advances the cursor only after message retrieval", async () => {
    const listHistory = vi.fn(async (_start: string, page?: string) => page
      ? { status: 200, body: { historyId: "1003", history: [{ id: "1003", messagesAdded: [{ message: { id: "m2", threadId: "t2" } }] }] } }
      : { status: 200, body: { historyId: "1002", nextPageToken: "next", history: [{ id: "1001", messagesAdded: [{ message: { id: "m1", threadId: "t1" } }, { message: { id: "m1", threadId: "t1" } }] }] } });
    const getMessage = vi.fn(async (id: string) => ({ status: 200, body: { ...message([{ name: "In-Reply-To", value: "outbound" }]), id, threadId: `thread-${id}` } }));
    await expect(collectGmailHistory({ transport: { listHistory, getMessage }, startHistoryId: "1000" }))
      .resolves.toMatchObject({ historyId: "1003", messages: [{ id: "m1" }, { id: "m2" }] });
    expect(getMessage).toHaveBeenCalledTimes(2);
  });

  it("requires a quarantined full sync when Gmail rejects a stale cursor", async () => {
    await expect(collectGmailHistory({
      transport: {
        listHistory: async () => ({ status: 404, body: {} }),
        getMessage: async () => ({ status: 500, body: {} }),
      },
      startHistoryId: "1",
    })).rejects.toBeInstanceOf(GmailHistoryResetRequiredError);
  });

  it("classifies deterministic reply, auto reply and DSN bounce signals", () => {
    expect(classifyGmailMessage(message([{ name: "In-Reply-To", value: "outbound" }]))).toBe("REPLY");
    expect(classifyGmailMessage(message([{ name: "Auto-Submitted", value: "auto-replied" }]))).toBe("AUTO_REPLY");
    expect(classifyGmailMessage(message([
      { name: "From", value: "MAILER-DAEMON@example.test" },
      { name: "Content-Type", value: "multipart/report; report-type=delivery-status" },
    ]))).toBe("HARD_BOUNCE");
    expect(classifyGmailMessage(message([
      { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
      { name: "X-Failed-Recipients", value: "buyer@example.test" },
      { name: "In-Reply-To", value: "<msg-29000000-0000-4000-8000-000000000012@ennco.com.mx>" },
    ]))).toBe("HARD_BOUNCE");
    expect(classifyGmailMessage(message([{ name: "From", value: "unknown@example.test" }]))).toBe("UNKNOWN");
  });

  it("extracts the related platform message id and failed recipient from a DSN", () => {
    const context = extractGmailEventContext(message([
      { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
      { name: "X-Failed-Recipients", value: "Buyer@Example.Test" },
      { name: "References", value: "<msg-29000000-0000-4000-8000-000000000012@ennco.com.mx>" },
      { name: "Subject", value: "Delivery Status Notification (Failure)" },
    ]));
    expect(context.relatedOutboundMessageId).toBe("29000000-0000-4000-8000-000000000012");
    expect(context.failedRecipient).toBe("buyer@example.test");
    expect(context.normalizedFrom).toBe("mailer-daemon@googlemail.com");
    expect(context.subject).toContain("Delivery Status Notification");
  });
});
