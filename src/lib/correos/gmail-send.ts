import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Remitente del carril directo (M041). A diferencia de
 * src/lib/gmail/outbound-client.ts, que sólo acepta el buzón del cliente como
 * literal, éste envía desde CUALQUIER buzón que la base haya conectado al
 * carril: el remitente viene del claim, no del código.
 *
 * Contrato que sí se conserva: texto plano, hilos por In-Reply-To/References.
 *
 * Sobre el Message-ID: la API de Gmail REESCRIBE el que pongamos y emite el
 * suyo (<CA...@mail.gmail.com>; verificado 4-sep-2026 leyendo el mensaje
 * enviado). Por eso, tras el envío se consulta el metadata del mensaje y se
 * persiste el Message-ID REAL: los toques 2-8 lo usan en In-Reply-To para que
 * el cliente del prospecto hile la secuencia, y el sync enlaza respuestas por
 * threadId como red principal. El <msg-uuid@dominio> queda solo de respaldo
 * si el metadata no se puede leer.
 */

const emailSchema = z.email().transform((value) => value.trim().toLowerCase());
const safeHeaderSchema = z.string().trim().min(1).max(180).refine((value) => !/[\r\n]/u.test(value), "DIRECT_LANE_HEADER_INVALID");

export const directLaneSendInputSchema = z.object({
  message_id: z.uuid(),
  from_name: safeHeaderSchema,
  from_email: emailSchema,
  to_email: emailSchema,
  cc_emails: z.array(emailSchema).max(5).default([]),
  subject: safeHeaderSchema,
  body_text: z.string().trim().min(1).max(20_000),
  kind: z.enum(["TOUCH", "REPLY"]),
  touch_number: z.number().int().min(1).max(8).nullable(),
  thread: z.object({
    provider_thread_id: z.string().trim().min(1).max(256),
    in_reply_to: z.string().trim().min(3).max(998),
    references: z.array(z.string().trim().min(3).max(998)).max(20).default([]),
  }).strict().nullable().default(null),
  list_unsubscribe_url: z.url().nullable().default(null),
}).strict().superRefine((value, context) => {
  if (/<(?:a|img|html|body|script|style)\b/iu.test(value.body_text)) {
    context.addIssue({ code: "custom", message: "DIRECT_LANE_HTML_FORBIDDEN" });
  }
  if (value.kind === "TOUCH") {
    const words = value.body_text.split(/\s+/u).filter(Boolean).length;
    if (words > 120) context.addIssue({ code: "custom", message: "DIRECT_LANE_WORD_LIMIT_EXCEEDED" });
    if (value.touch_number === null) context.addIssue({ code: "custom", message: "DIRECT_LANE_TOUCH_NUMBER_REQUIRED" });
    if (value.touch_number === 1 && /(?:https?:\/\/|www\.|mailto:)/iu.test(value.body_text)) {
      context.addIssue({ code: "custom", message: "DIRECT_LANE_FIRST_TOUCH_LINK_FORBIDDEN" });
    }
    if (value.touch_number === 1 && value.thread) {
      context.addIssue({ code: "custom", message: "DIRECT_LANE_FIRST_TOUCH_THREAD_FORBIDDEN" });
    }
    if (value.touch_number !== null && value.touch_number > 1 && !value.thread) {
      context.addIssue({ code: "custom", message: "DIRECT_LANE_FOLLOW_UP_THREAD_REQUIRED" });
    }
  }
  if (value.kind === "REPLY" && !value.thread) {
    context.addIssue({ code: "custom", message: "DIRECT_LANE_REPLY_THREAD_REQUIRED" });
  }
});

export type DirectLaneSendInput = z.input<typeof directLaneSendInputSchema>;

const sendResponseSchema = z.object({
  id: z.string().trim().min(1).max(256),
  threadId: z.string().trim().min(1).max(256),
}).passthrough();

export type DirectLaneSendResult = {
  provider: "GMAIL_API";
  provider_message_id: string;
  provider_thread_id: string;
  rfc_message_id: string;
  envelope_sha256: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class DirectLaneSendError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "DirectLaneSendError";
  }
}

function encodedHeader(value: string): string {
  if (/^[\x20-\x7E]*$/u.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrappedBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/gu)?.join("\r\n") ?? "";
}

/** <msg-<uuid>@<dominio>>: el sync busca exactamente este molde en In-Reply-To/References. */
export function directLaneMessageId(messageId: string, fromEmail: string): string {
  const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "ennco.com.mx";
  return `<msg-${messageId.toLowerCase()}@${domain}>`;
}

export function buildDirectLaneRawMessage(rawInput: DirectLaneSendInput): { raw: string; rfcMessageId: string } {
  const parsed = directLaneSendInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new DirectLaneSendError("DIRECT_LANE_SEND_INPUT_INVALID");
  const input = parsed.data;
  const rfcMessageId = directLaneMessageId(input.message_id, input.from_email);
  const headers = [
    `From: ${encodedHeader(input.from_name)} <${input.from_email}>`,
    `To: ${input.to_email}`,
  ];
  if (input.cc_emails.length > 0) headers.push(`Cc: ${input.cc_emails.join(", ")}`);
  headers.push(
    `Reply-To: ${input.from_email}`,
    `Subject: ${encodedHeader(input.subject)}`,
    `Message-ID: ${rfcMessageId}`,
    `Date: ${new Date().toUTCString()}`,
  );
  if (input.thread) {
    headers.push(`In-Reply-To: ${input.thread.in_reply_to}`);
    const references = [...input.thread.references, input.thread.in_reply_to].filter((value, index, all) => all.indexOf(value) === index);
    headers.push(`References: ${references.join(" ")}`);
  }
  if (input.list_unsubscribe_url) {
    headers.push(`List-Unsubscribe: <${input.list_unsubscribe_url}>`);
    headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  headers.push(
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  );
  return { raw: `${headers.join("\r\n")}\r\n\r\n${wrappedBase64(input.body_text)}\r\n`, rfcMessageId };
}

export class DirectLaneGmailSender {
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(input: { accessToken: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
    this.accessToken = input.accessToken.trim();
    if (this.accessToken.length < 16 || /\s/u.test(this.accessToken)) throw new DirectLaneSendError("GMAIL_ACCESS_TOKEN_INVALID");
    this.timeoutMs = input.timeoutMs ?? 10_000;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async send(rawInput: DirectLaneSendInput): Promise<DirectLaneSendResult> {
    const parsed = directLaneSendInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new DirectLaneSendError("DIRECT_LANE_SEND_INPUT_INVALID");
    const { raw, rfcMessageId } = buildDirectLaneRawMessage(parsed.data);
    const payload: { raw: string; threadId?: string } = { raw: Buffer.from(raw, "utf8").toString("base64url") };
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
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new DirectLaneSendError("GMAIL_API_TIMEOUT");
      throw new DirectLaneSendError("GMAIL_API_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      if (response.status === 401) throw new DirectLaneSendError("GMAIL_API_UNAUTHORIZED");
      if (response.status === 403) throw new DirectLaneSendError("GMAIL_API_SCOPE_FORBIDDEN");
      if (response.status === 429) throw new DirectLaneSendError("GMAIL_API_RATE_LIMITED");
      throw new DirectLaneSendError(response.status >= 500 ? "GMAIL_API_PROVIDER_ERROR" : "GMAIL_API_REQUEST_REJECTED");
    }
    const body: unknown = await response.json().catch(() => null);
    const result = sendResponseSchema.safeParse(body);
    if (!result.success) throw new DirectLaneSendError("GMAIL_API_RESPONSE_INVALID");
    const realMessageId = await this.readRealMessageId(result.data.id);
    return {
      provider: "GMAIL_API",
      provider_message_id: result.data.id,
      provider_thread_id: result.data.threadId,
      rfc_message_id: realMessageId ?? rfcMessageId,
      envelope_sha256: createHash("sha256").update(raw).digest("hex"),
    };
  }

  /**
   * Message-ID REAL del mensaje ya enviado. Gmail ignora el header que
   * mandamos, y este valor es el que el prospecto ve y el que su cliente pone
   * en In-Reply-To al responder. Si la lectura falla no se rompe el envío: el
   * determinista queda como respaldo (peor hilado, mismo despacho).
   */
  private async readRealMessageId(providerMessageId: string): Promise<string | null> {
    try {
      const response = await this.fetchImpl(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=metadata&metadataHeaders=Message-ID`,
        { headers: { accept: "application/json", authorization: `Bearer ${this.accessToken}` }, cache: "no-store" },
      );
      if (!response.ok) return null;
      const body: unknown = await response.json().catch(() => null);
      const parsed = z.object({
        payload: z.object({
          headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
        }).partial().default({}),
      }).passthrough().safeParse(body);
      if (!parsed.success) return null;
      const value = (parsed.data.payload.headers ?? []).find((header) => header.name.toLowerCase() === "message-id")?.value.trim() ?? null;
      return value && /^<[^\s<>]+@[^\s<>]+>$/u.test(value) && value.length <= 998 ? value : null;
    } catch {
      return null;
    }
  }
}
