import { z } from "zod";

const historyPageSchema = z.object({
  history: z.array(z.object({
    id: z.string().regex(/^[0-9]+$/),
    messagesAdded: z.array(z.object({
      message: z.object({ id: z.string().min(1).max(512), threadId: z.string().min(1).max(512) }).passthrough(),
    })).optional(),
  }).passthrough()).optional(),
  nextPageToken: z.string().min(1).optional(),
  historyId: z.string().regex(/^[0-9]+$/),
}).strict();

const messageSchema = z.object({
  id: z.string().min(1).max(512),
  threadId: z.string().min(1).max(512),
  labelIds: z.array(z.string()).optional(),
  payload: z.object({
    headers: z.array(z.object({ name: z.string(), value: z.string() })),
    mimeType: z.string().optional(),
  }).passthrough(),
  internalDate: z.string().regex(/^[0-9]+$/),
}).passthrough();

export type GmailMessageMetadata = z.infer<typeof messageSchema>;
export type GmailProviderEventKind = "REPLY" | "AUTO_REPLY" | "HARD_BOUNCE" | "UNKNOWN";

export class GmailHistoryResetRequiredError extends Error {
  constructor() {
    super("GMAIL_HISTORY_FULL_SYNC_REQUIRED");
    this.name = "GmailHistoryResetRequiredError";
  }
}

export type GmailHistoryTransport = {
  listHistory(startHistoryId: string, pageToken?: string): Promise<{ status: number; body: unknown }>;
  getMessage(messageId: string): Promise<{ status: number; body: unknown }>;
};

export async function collectGmailHistory(input: {
  transport: GmailHistoryTransport;
  startHistoryId: string;
  maxPages?: number;
}): Promise<{ historyId: string; messages: GmailMessageMetadata[] }> {
  const maxPages = input.maxPages ?? 20;
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let currentHistoryId = input.startHistoryId;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const response = await input.transport.listHistory(input.startHistoryId, pageToken);
    if (response.status === 404) throw new GmailHistoryResetRequiredError();
    if (response.status !== 200) throw new Error("GMAIL_HISTORY_UNAVAILABLE");
    const page = historyPageSchema.parse(response.body);
    currentHistoryId = page.historyId;
    for (const history of page.history ?? []) {
      for (const added of history.messagesAdded ?? []) messageIds.add(added.message.id);
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
    if (pageNumber === maxPages - 1) throw new Error("GMAIL_HISTORY_PAGE_LIMIT_EXCEEDED");
  }
  const messages: GmailMessageMetadata[] = [];
  for (const messageId of messageIds) {
    const response = await input.transport.getMessage(messageId);
    if (response.status === 404) continue;
    if (response.status !== 200) throw new Error("GMAIL_MESSAGE_UNAVAILABLE");
    messages.push(messageSchema.parse(response.body));
  }
  return { historyId: currentHistoryId, messages };
}

function headerMap(message: GmailMessageMetadata): Map<string, string> {
  return new Map(message.payload.headers.map((header) => [header.name.toLowerCase(), header.value]));
}

const bounceSenderPattern = /^(?:mailer-daemon|postmaster)@/iu;
const deliveryReportPattern = /multipart\/report.*report-type=delivery-status/iu;
const platformMessageIdPattern = /<msg-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@ennco\.com\.mx>/iu;

export function classifyGmailMessage(message: GmailMessageMetadata): GmailProviderEventKind {
  const headers = headerMap(message);
  const fromHeader = headers.get("from") ?? "";
  const fromEmail = /<([^>]+)>/u.exec(fromHeader)?.[1] ?? fromHeader.trim();
  const contentType = headers.get("content-type") ?? message.payload.mimeType ?? "";
  if (
    bounceSenderPattern.test(fromEmail)
    || deliveryReportPattern.test(contentType)
    || headers.has("x-failed-recipients")
  ) {
    return "HARD_BOUNCE";
  }
  const autoSubmitted = headers.get("auto-submitted")?.toLowerCase();
  const precedence = headers.get("precedence")?.toLowerCase();
  if ((autoSubmitted && autoSubmitted !== "no") || precedence === "auto_reply") return "AUTO_REPLY";
  if (headers.has("in-reply-to") || headers.has("references")) return "REPLY";
  return "UNKNOWN";
}

export type GmailEventContext = {
  relatedOutboundMessageId: string | null;
  failedRecipient: string | null;
  normalizedFrom: string | null;
  subject: string | null;
  internalDateEpoch: number;
};

/**
 * Extrae del mensaje los datos que la RPC de eventos necesita. El Message-ID
 * determinista del despacho (msg-{uuid}@ennco.com.mx) viaja en In-Reply-To y
 * References de replies y DSN, y resuelve el outbound relacionado sin
 * heurísticas de dirección.
 */
export function extractGmailEventContext(message: GmailMessageMetadata): GmailEventContext {
  const headers = headerMap(message);
  const references = `${headers.get("in-reply-to") ?? ""} ${headers.get("references") ?? ""}`;
  const relatedMatch = platformMessageIdPattern.exec(references);
  const fromHeader = headers.get("from") ?? "";
  const fromEmail = /<([^>]+)>/u.exec(fromHeader)?.[1] ?? fromHeader.trim();
  const failedRecipient = headers.get("x-failed-recipients")?.split(",")[0]?.trim().toLowerCase() ?? null;
  return {
    relatedOutboundMessageId: relatedMatch?.[1] ? relatedMatch[1].toLowerCase() : null,
    failedRecipient,
    normalizedFrom: fromEmail ? fromEmail.trim().toLowerCase() : null,
    subject: headers.get("subject") ?? null,
    internalDateEpoch: Math.floor(Number(message.internalDate) / 1000),
  };
}
