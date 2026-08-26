import { createHash } from "node:crypto";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeHeaderSchema = z.string().trim().min(1).max(180).refine(
  (value) => !/[\r\n]/u.test(value),
  "GMAIL_OUTBOUND_HEADER_INVALID",
);

const gmailTouchInputSchema = z.object({
  from_name: z.literal("Francisco Cuellar"),
  from_email: z.literal("contacto@ennco.com.mx"),
  to_email: z.email().transform((value) => value.trim().toLowerCase()),
  subject: safeHeaderSchema,
  body_text: z.string().trim().min(1).max(8_000),
  touch_number: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  thread: z.object({
    provider_thread_id: z.string().trim().min(1).max(256),
    previous_provider_message_id: z.string().trim().min(1).max(998),
  }).strict().optional(),
  authorization: z.object({
    external_send_allowed: z.literal(true),
    global_kill_switch: z.literal(false),
    evidence_class: z.literal("live"),
    release_id: z.uuid(),
    message_id: z.uuid(),
    manifest_sha256: sha256Schema,
  }).strict(),
}).strict().superRefine((value, context) => {
  const words = value.body_text.split(/\s+/u).filter(Boolean).length;
  if (words > 100) {
    context.addIssue({ code: "custom", message: "GMAIL_TOUCH_WORD_LIMIT_EXCEEDED" });
  }
  if (value.touch_number === 1 && /(?:https?:\/\/|www\.|mailto:)/iu.test(value.body_text)) {
    context.addIssue({ code: "custom", message: "GMAIL_FIRST_TOUCH_LINK_FORBIDDEN" });
  }
  if (/<(?:a|img|html|body|script|style)\b/iu.test(value.body_text)) {
    context.addIssue({ code: "custom", message: "GMAIL_TOUCH_HTML_FORBIDDEN" });
  }
  if (value.touch_number === 1 && value.thread) {
    context.addIssue({ code: "custom", message: "GMAIL_FIRST_TOUCH_THREAD_FORBIDDEN" });
  }
  if (value.touch_number > 1 && !value.thread) {
    context.addIssue({ code: "custom", message: "GMAIL_FOLLOW_UP_THREAD_REQUIRED" });
  }
});


const gmailSendResponseSchema = z.object({
  id: z.string().trim().min(1).max(256),
  threadId: z.string().trim().min(1).max(256),
  labelIds: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
}).passthrough();

export type GmailTouchInput = z.input<typeof gmailTouchInputSchema>;
export type GmailFirstTouchInput = GmailTouchInput;

export type GmailFirstTouchResult = {
  provider: "GMAIL_API";
  provider_message_id: string;
  provider_thread_id: string;
  release_id: string;
  message_id: string;
  manifest_sha256: string;
  envelope_sha256: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class GmailOutboundError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "GmailOutboundError";
  }
}

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrappedBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/gu)?.join("\r\n") ?? "";
}

export function deterministicMessageId(messageId: string): string {
  return `<msg-${messageId}@ennco.com.mx>`;
}

function buildRawMessage(input: z.infer<typeof gmailTouchInputSchema>): string {
  const headers = [
    `From: ${input.from_name} <${input.from_email}>`,
    `To: ${input.to_email}`,
    `Reply-To: ${input.from_email}`,
    `Subject: ${encodedHeader(input.subject)}`,
    `Message-ID: ${deterministicMessageId(input.authorization.message_id)}`,
  ];
  if (input.thread) {
    headers.push(`In-Reply-To: ${input.thread.previous_provider_message_id}`);
    headers.push(`References: ${input.thread.previous_provider_message_id}`);
  }
  headers.push(
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  );
  return `${headers.join("\r\n")}\r\n\r\n${wrappedBase64(input.body_text)}\r\n`;
}

export class GmailOutboundClient {
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(input: { accessToken: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
    this.accessToken = input.accessToken.trim();
    if (this.accessToken.length < 16 || /\s/u.test(this.accessToken)) {
      throw new GmailOutboundError("GMAIL_ACCESS_TOKEN_INVALID");
    }
    this.timeoutMs = input.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000) {
      throw new GmailOutboundError("GMAIL_API_TIMEOUT_INVALID");
    }
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async sendFirstTouch(rawInput: GmailFirstTouchInput): Promise<GmailFirstTouchResult> {
    try {
      return await this.sendTouch(rawInput);
    } catch (error) {
      if (error instanceof GmailOutboundError && error.code === "GMAIL_TOUCH_INPUT_INVALID") {
        throw new GmailOutboundError("GMAIL_FIRST_TOUCH_INPUT_INVALID");
      }
      throw error;
    }
  }

  async sendTouch(rawInput: GmailTouchInput): Promise<GmailFirstTouchResult> {
    const parsed = gmailTouchInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new GmailOutboundError("GMAIL_TOUCH_INPUT_INVALID");

    const rawMessage = buildRawMessage(parsed.data);
    const raw = Buffer.from(rawMessage, "utf8").toString("base64url");
    const payload: { raw: string; threadId?: string } = { raw };
    if (parsed.data.thread) payload.threadId = parsed.data.thread.provider_thread_id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.accessToken}`,
          "cache-control": "no-store",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new GmailOutboundError("GMAIL_API_TIMEOUT");
      }
      throw new GmailOutboundError("GMAIL_API_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 401) throw new GmailOutboundError("GMAIL_API_UNAUTHORIZED");
      if (response.status === 403) throw new GmailOutboundError("GMAIL_API_SCOPE_FORBIDDEN");
      if (response.status === 429) throw new GmailOutboundError("GMAIL_API_RATE_LIMITED");
      throw new GmailOutboundError(response.status >= 500 ? "GMAIL_API_PROVIDER_ERROR" : "GMAIL_API_REQUEST_REJECTED");
    }

    let responseBody: unknown;
    try {
      const text = await response.text();
      if (text.length > 100_000) throw new GmailOutboundError("GMAIL_API_RESPONSE_TOO_LARGE");
      responseBody = JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof GmailOutboundError) throw error;
      throw new GmailOutboundError("GMAIL_API_RESPONSE_NOT_JSON");
    }
    const result = gmailSendResponseSchema.safeParse(responseBody);
    if (!result.success) throw new GmailOutboundError("GMAIL_API_RESPONSE_INVALID");

    return {
      provider: "GMAIL_API",
      provider_message_id: result.data.id,
      provider_thread_id: result.data.threadId,
      release_id: parsed.data.authorization.release_id,
      message_id: parsed.data.authorization.message_id,
      manifest_sha256: parsed.data.authorization.manifest_sha256,
      envelope_sha256: createHash("sha256").update(rawMessage).digest("hex"),
    };
  }
}
