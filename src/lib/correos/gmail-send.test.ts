import { describe, expect, it, vi } from "vitest";

import { buildDirectLaneRawMessage, DirectLaneGmailSender, directLaneMessageId } from "@/lib/correos/gmail-send";

const accessToken = "gmail-access-token-synthetic-never-log";
const touch = {
  message_id: "41000000-0000-4000-8000-000000000101",
  from_name: "Francisco Cuellar",
  from_email: "francisco@enncoindustrial.com",
  to_email: "Compras@Planta.test",
  subject: "Lo que le costó un apagón a un cliente",
  body_text: "Hola Juan,\n\nA un cliente nuestro un apagón le tiró la planta un día. Perdieron 2 millones 180 mil pesos.\n\n¿Me puedes dirigir con quien lleva mantenimiento?\n\nFrancisco",
  kind: "TOUCH" as const,
  touch_number: 1,
};

describe("direct lane gmail sender", () => {
  it("builds a plain-text RFC message with a deterministic Message-ID on the sending domain", () => {
    const { raw, rfcMessageId } = buildDirectLaneRawMessage(touch);
    expect(rfcMessageId).toBe("<msg-41000000-0000-4000-8000-000000000101@enncoindustrial.com>");
    expect(raw).toContain("From: Francisco Cuellar <francisco@enncoindustrial.com>");
    expect(raw).toContain("To: compras@planta.test");
    expect(raw).toContain(`Message-ID: ${rfcMessageId}`);
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).not.toContain("Cc:");
    expect(raw).not.toContain("In-Reply-To");
  });

  it("threads follow-ups and replies, and copies the client only when asked", () => {
    const { raw } = buildDirectLaneRawMessage({
      ...touch,
      kind: "REPLY",
      touch_number: null,
      cc_emails: ["francisco.cuellar@ennco.com.mx"],
      subject: "Re: Lo que le costó un apagón a un cliente",
      body_text: "Gracias, Juan. Te mando el formato para revisar recibo o capacidad instalada.\n\nFrancisco",
      thread: {
        provider_thread_id: "thread-1",
        in_reply_to: "<abc@planta.test>",
        references: ["<msg-41000000-0000-4000-8000-000000000101@enncoindustrial.com>"],
      },
    });
    expect(raw).toContain("Cc: francisco.cuellar@ennco.com.mx");
    expect(raw).toContain("In-Reply-To: <abc@planta.test>");
    expect(raw).toContain("References: <msg-41000000-0000-4000-8000-000000000101@enncoindustrial.com> <abc@planta.test>");
  });

  it.each([
    { ...touch, body_text: "Consulta https://example.test antes" },
    { ...touch, body_text: Array.from({ length: 101 }, () => "palabra").join(" ") },
    { ...touch, body_text: "<a href='x'>hola</a>" },
    { ...touch, touch_number: 2 },
    { ...touch, kind: "REPLY" as const, touch_number: null },
  ])("rejects an invalid envelope before calling Gmail", async (input) => {
    const fetchImpl = vi.fn();
    const sender = new DirectLaneGmailSender({ accessToken, fetchImpl });
    await expect(sender.send(input)).rejects.toMatchObject({ code: "DIRECT_LANE_SEND_INPUT_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the envelope to the Gmail endpoint and maps provider ids", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${accessToken}` });
      const payload = JSON.parse(String(init?.body)) as { raw: string; threadId?: string };
      expect(payload.threadId).toBeUndefined();
      expect(Buffer.from(payload.raw, "base64url").toString("utf8")).toContain("Subject: =?UTF-8?B?");
      return new Response(JSON.stringify({ id: "gm-1", threadId: "th-1" }), { status: 200 });
    });
    const result = await new DirectLaneGmailSender({ accessToken, fetchImpl }).send(touch);
    expect(result).toMatchObject({ provider: "GMAIL_API", provider_message_id: "gm-1", provider_thread_id: "th-1" });
    expect(result.rfc_message_id).toBe(directLaneMessageId(touch.message_id, touch.from_email));
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });

  it("maps Gmail failures to stable codes", async () => {
    const unauthorized = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(new DirectLaneGmailSender({ accessToken, fetchImpl: unauthorized }).send(touch))
      .rejects.toMatchObject({ code: "GMAIL_API_UNAUTHORIZED" });
    const limited = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(new DirectLaneGmailSender({ accessToken, fetchImpl: limited }).send(touch))
      .rejects.toMatchObject({ code: "GMAIL_API_RATE_LIMITED" });
  });
});
